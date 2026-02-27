"""Speaker diarization using pyannote.audio."""
import logging
import asyncio
import os
import tempfile
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class DiarizationSegment:
    """A single speaker segment."""
    speaker_id: str
    start_time: float
    end_time: float


@dataclass
class DiarizationResult:
    """Result of speaker diarization."""
    segments: List[DiarizationSegment]
    num_speakers: int = 0
    duration: float = 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary format."""
        return {
            "segments": [
                {
                    "speaker_id": seg.speaker_id,
                    "start_time": seg.start_time,
                    "end_time": seg.end_time
                }
                for seg in self.segments
            ],
            "num_speakers": self.num_speakers,
            "duration": self.duration
        }


def _patch_pyannote_audio_decoder():
    """
    Patch pyannote.audio to fix missing AudioDecoder import.
    
    This is a workaround for pyannote/pyannote-audio #1370 where AudioDecoder
    is not imported in the io.py module on certain versions/platforms.
    
    Since we always pass in-memory audio (not file paths), we monkey-patch
    get_audio_metadata to bypass AudioDecoder when not needed.
    """
    try:
        from pyannote.audio.core import io as pyannote_io
        import torch
        
        # Store original function before patching
        original_get_audio_metadata = getattr(pyannote_io, 'get_audio_metadata', None)
        if original_get_audio_metadata is None:
            logger.debug("Original get_audio_metadata not found in pyannote.audio.core.io")
            return
        
        def patched_get_audio_metadata(file):
            """
            Patched version that handles both file paths and in-memory audio.
            For in-memory audio dicts, skip AudioDecoder entirely.
            """
            # If it's a dict with waveform and sample_rate, return minimal metadata
            if isinstance(file, dict) and "waveform" in file:
                waveform = file.get("waveform")
                sample_rate = file.get("sample_rate", 16000)
                
                # Extract dimensions from waveform
                try:
                    if torch.is_tensor(waveform):
                        # PyTorch tensor
                        if waveform.dim() == 1:
                            num_channels = 1
                            num_frames = waveform.shape[0]
                        else:
                            num_channels = waveform.shape[0]
                            num_frames = waveform.shape[-1]
                    else:
                        # Numpy array or list
                        import numpy as np
                        wf = np.asarray(waveform)
                        if wf.ndim == 1:
                            num_channels = 1
                            num_frames = len(wf)
                        else:
                            num_channels = wf.shape[0]
                            num_frames = wf.shape[-1]
                except Exception as e:
                    logger.warning(f"Could not determine waveform dimensions: {e}. Using defaults.")
                    num_channels = 1
                    num_frames = 0
                
                duration = num_frames / sample_rate if sample_rate else 0.0
                
                # Create a minimal metadata object with expected attributes
                class SimpleMetadata:
                    def __init__(self, sr, ch, nf, dur):
                        self.sample_rate = int(sr)
                        self.num_channels = int(ch)
                        self.num_frames = int(nf)
                        self.duration = float(dur)
                
                return SimpleMetadata(sample_rate, num_channels, num_frames, duration)
            
            # Fall back to original for file paths
            if original_get_audio_metadata is not None:
                try:
                    return original_get_audio_metadata(file)
                except NameError as e:
                    if "AudioDecoder" in str(e):
                        logger.error(
                            f"AudioDecoder not available in pyannote.audio. "
                            f"Please ensure audio is provided as in-memory dict. Error: {e}"
                        )
                        raise
                    raise
            else:
                raise NotImplementedError("Cannot process file path - pyannote.audio get_audio_metadata not available")
        
        # Replace the function
        pyannote_io.get_audio_metadata = patched_get_audio_metadata
        logger.debug("Successfully patched pyannote.audio.get_audio_metadata")
    except ImportError as e:
        logger.debug(f"Could not import pyannote.audio for patching (this is OK if pyannote is not installed): {e}")
    except Exception as e:
        logger.debug(f"Warning while applying pyannote patch: {e}")


# Apply patch at module import time
_patch_pyannote_audio_decoder()


class DiarizationEngine:
    """
    Speaker diarization engine using pyannote.audio.
    Identifies different speakers in audio and returns time-stamped speaker turns.

    This complements the existing DiarizationService in app/diarization_service.py
    by providing additional features like cross-chunk speaker tracking.
    """

    def __init__(self, pipeline_name: str, auth_token: Optional[str], device: str = "cpu"):
        """
        Initialize the diarization engine.

        Args:
            pipeline_name: Hugging Face model name (e.g., 'pyannote/speaker-diarization-community-1')
            auth_token: Hugging Face authentication token
            device: Device to run on ('cuda', 'mps', or 'cpu')
        """
        self.pipeline_name = pipeline_name
        self.auth_token = auth_token
        self.device_str = device
        self.pipeline = None
        self._load_pipeline()

    def _load_pipeline(self) -> None:
        """Load the pyannote diarization pipeline."""
        try:
            from pyannote.audio import Pipeline
            import torch

            logger.info(f"Loading diarization pipeline: {self.pipeline_name}")

            if not self.auth_token:
                logger.warning(
                    "No HF auth token provided. Pipeline loading may fail for gated models."
                )

            # pyannote.audio 4.x uses 'token' parameter, 3.x uses 'use_auth_token'
            try:
                self.pipeline = Pipeline.from_pretrained(
                    self.pipeline_name,
                    token=self.auth_token if self.auth_token else None
                )
            except TypeError:
                # Fallback for pyannote.audio 3.x
                self.pipeline = Pipeline.from_pretrained(
                    self.pipeline_name,
                    use_auth_token=self.auth_token if self.auth_token else None
                )

            # Move pipeline to appropriate device
            device = torch.device(self.device_str)
            if device.type in ("cuda", "mps"):
                try:
                    self.pipeline = self.pipeline.to(device)
                    logger.info(f"Diarization pipeline moved to {self.device_str}")
                except Exception as e:
                    logger.warning(f"{self.device_str} not fully supported, falling back to CPU: {e}")
                    self.device_str = "cpu"

            logger.info("Diarization pipeline loaded successfully")

        except ImportError as e:
            logger.error(f"pyannote.audio not installed: {e}")
            self.pipeline = None
        except Exception as e:
            logger.error(f"Failed to load diarization pipeline: {e}")
            self.pipeline = None

    @property
    def is_available(self) -> bool:
        """Check if diarization pipeline is available."""
        return self.pipeline is not None

    def _load_audio(self, audio_path: str) -> Tuple[Any, int]:
        """
        Load audio file into memory, handling various formats.

        Returns:
            Tuple of (waveform tensor, sample_rate)
        """
        import torch

        # Try torchaudio first
        try:
            import torchaudio
            waveform, sample_rate = torchaudio.load(audio_path)
            return waveform, sample_rate
        except Exception:
            pass

        # Try soundfile
        try:
            import soundfile as sf
            import numpy as np
            audio_data, sample_rate = sf.read(audio_path)
            if audio_data.ndim == 1:
                waveform = torch.from_numpy(audio_data).float().unsqueeze(0)
            else:
                waveform = torch.from_numpy(audio_data.T).float()
            return waveform, sample_rate
        except Exception:
            pass

        raise RuntimeError(f"Failed to load audio file: {audio_path}")

    async def get_speaker_turns(
        self,
        audio_path: str,
        num_speakers: Optional[int] = None,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None
    ) -> DiarizationResult:
        """
        Perform speaker diarization on an audio file.

        Args:
            audio_path: Path to the audio file (should be WAV 16kHz mono)
            num_speakers: Optional exact number of speakers
            min_speakers: Optional minimum number of speakers
            max_speakers: Optional maximum number of speakers

        Returns:
            DiarizationResult with speaker segments
        """
        if not self.is_available:
            logger.warning("Diarization pipeline not available")
            return DiarizationResult(segments=[], num_speakers=0, duration=0.0)

        try:
            logger.info(f"Running diarization on: {audio_path}" +
                        (f" (num_speakers={num_speakers})" if num_speakers else ""))

            # Build pipeline kwargs
            pipeline_kwargs = {}
            if num_speakers:
                pipeline_kwargs["num_speakers"] = num_speakers
            if min_speakers is not None:
                pipeline_kwargs["min_speakers"] = min_speakers
            if max_speakers is not None:
                pipeline_kwargs["max_speakers"] = max_speakers

            # Load audio into memory for pyannote
            waveform, sample_rate = self._load_audio(audio_path)
            audio_input = {"waveform": waveform, "sample_rate": sample_rate}

            # Run diarization in thread pool (CPU-bound)
            loop = asyncio.get_event_loop()
            diarization_result = await loop.run_in_executor(
                None,
                lambda: self.pipeline(audio_input, **pipeline_kwargs)
            )

            # Free waveform memory
            del waveform
            del audio_input

            # Handle pyannote.audio 4.x output style
            diarization = getattr(diarization_result, 'speaker_diarization', diarization_result)

            # Extract speaker turns and calculate duration
            segments = []
            speakers_seen = set()
            max_end_time = 0.0
            for turn, _, speaker_label in diarization.itertracks(yield_label=True):
                segments.append(DiarizationSegment(
                    speaker_id=speaker_label,
                    start_time=turn.start,
                    end_time=turn.end
                ))
                speakers_seen.add(speaker_label)
                max_end_time = max(max_end_time, turn.end)

            result = DiarizationResult(
                segments=segments,
                num_speakers=len(speakers_seen),
                duration=max_end_time
            )
            logger.info(f"Diarization complete: {len(segments)} speaker turns found, {len(speakers_seen)} speakers, duration={max_end_time:.2f}s")
            return result

        except Exception as e:
            logger.error(f"Diarization failed: {e}")
            return DiarizationResult(segments=[], num_speakers=0, duration=0.0)

    def unload(self):
        """Unload the pipeline to free memory."""
        if self.pipeline is not None:
            del self.pipeline
            self.pipeline = None
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except ImportError:
                pass
            logger.info("Diarization pipeline unloaded")
