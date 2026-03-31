"""
Speaker Diarization Service using pyannote.audio

Provides voice-based speaker recognition using pyannote.audio models.
Supports GPU acceleration with automatic fallback to CPU.

Requires:
- pyannote.audio >= 4.0.0 (manages torch, torchaudio, torchcodec versions)
- Hugging Face token with access to the diarization model

Note: This implementation uses torchaudio for audio loading (bypassing torchcodec)
to avoid FFmpeg dependency issues on Windows. Audio is pre-loaded and passed to
pyannote.audio as in-memory waveform.

See: https://github.com/pyannote/pyannote-audio/releases/tag/4.0.0
"""

import os
import logging
import asyncio
from pathlib import Path
from typing import List, Dict, Optional, Tuple, Any
from dataclasses import dataclass
from functools import lru_cache
import tempfile
import json

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Default model for diarization (pyannote.audio 4.x uses community-1 as the open-source model)
# See: https://huggingface.co/pyannote/speaker-diarization-community-1
DEFAULT_DIARIZATION_MODEL = "pyannote/speaker-diarization-community-1"
DEFAULT_EMBEDDING_MODEL = "pyannote/wespeaker-voxceleb-resnet34-LM"


@dataclass
class SpeakerSegment:
    """Represents a speaker segment from diarization"""
    speaker_id: str
    start_time: float
    end_time: float
    
    def to_dict(self) -> Dict:
        return {
            "speaker_id": self.speaker_id,
            "start_time": self.start_time,
            "end_time": self.end_time
        }


@dataclass
class DiarizationResult:
    """Result of speaker diarization"""
    segments: List[SpeakerSegment]
    num_speakers: int
    duration: float
    
    def to_dict(self) -> Dict:
        return {
            "segments": [s.to_dict() for s in self.segments],
            "num_speakers": self.num_speakers,
            "duration": self.duration
        }


@dataclass 
class DiarizationModelInfo:
    """Information about a diarization model"""
    model_id: str
    name: str
    description: str
    size_mb: int
    status: str  # "available", "missing", "downloading"
    download_progress: float = 0.0


class DiarizationService:
    """
    Service for speaker diarization using pyannote.audio.
    
    Handles model loading, GPU/CPU device selection, and diarization processing.
    """
    
    def __init__(self, hf_token: Optional[str] = None, models_dir: Optional[str] = None):
        """
        Initialize the diarization service.
        
        Args:
            hf_token: Hugging Face API token for model access
            models_dir: Directory to cache downloaded models
        """
        self.hf_token = hf_token or os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_TOKEN")
        self.models_dir = models_dir or os.path.join(
            os.getenv("APP_DATA_DIR", str(Path.home() / ".meetily")), 
            "models", 
            "diarization"
        )
        self._pipeline = None
        self._device = None
        self._model_loaded = False
        self._loading = False
        self._speaker_tracker = None
        
        # Ensure models directory exists
        Path(self.models_dir).mkdir(parents=True, exist_ok=True)
        
        logger.info(f"DiarizationService initialized with models dir: {self.models_dir}")
    
    def _get_device(self) -> str:
        """
        Detect and return the best available device for inference.
        
        Returns:
            Device string: "cuda", "mps", or "cpu"
        """
        if self._device is not None:
            return self._device
            
        try:
            import torch
            
            # Check for CUDA (NVIDIA GPU)
            if torch.cuda.is_available():
                self._device = "cuda"
                logger.info(f"Using CUDA device: {torch.cuda.get_device_name(0)}")
                return self._device
            
            # Check for MPS (Apple Silicon)
            if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
                self._device = "mps"
                logger.info("Using Apple Metal Performance Shaders (MPS)")
                return self._device
            
            # Fallback to CPU
            self._device = "cpu"
            logger.info("Using CPU for diarization (no GPU detected)")
            return self._device
            
        except ImportError:
            logger.warning("PyTorch not available, using CPU")
            self._device = "cpu"
            return self._device
    
    async def check_model_status(self, model_id: str = DEFAULT_DIARIZATION_MODEL) -> DiarizationModelInfo:
        """
        Check the status of a diarization model.
        
        Args:
            model_id: Hugging Face model ID
            
        Returns:
            DiarizationModelInfo with current status
        """
        try:
            from huggingface_hub import scan_cache_dir, HfFolder
            
            # Check if model is in cache
            cache_info = scan_cache_dir()
            model_cached = any(
                model_id in str(repo.repo_id) 
                for repo in cache_info.repos
            )
            
            status = "available" if model_cached else "missing"
            
            return DiarizationModelInfo(
                model_id=model_id,
                name=model_id.split("/")[-1],
                description="pyannote.audio speaker diarization model",
                size_mb=500 if "diarization" in model_id else 200,
                status=status
            )
            
        except Exception as e:
            logger.error(f"Error checking model status: {e}")
            return DiarizationModelInfo(
                model_id=model_id,
                name=model_id.split("/")[-1],
                description="pyannote.audio speaker diarization model",
                size_mb=500,
                status="missing"
            )
    
    async def load_model(self, model_id: str = DEFAULT_DIARIZATION_MODEL) -> bool:
        """
        Load the diarization pipeline model.
        
        Args:
            model_id: Hugging Face model ID for the pipeline
            
        Returns:
            True if model loaded successfully
        """
        if self._loading:
            logger.warning("Model is already loading")
            return False
            
        if self._model_loaded and self._pipeline is not None:
            logger.info("Model already loaded")
            return True
        
        self._loading = True
        
        try:
            # Import pyannote here to allow graceful handling if not installed
            from pyannote.audio import Pipeline
            import torch
            
            if not self.hf_token:
                raise ValueError(
                    "Hugging Face token required for pyannote.audio models. "
                    "Please set HF_TOKEN environment variable or configure in settings."
                )
            
            device = self._get_device()
            
            logger.info(f"Loading diarization model: {model_id} on {device}")
            
            # Load pipeline with token (pyannote.audio 4.x uses 'token' parameter)
            self._pipeline = Pipeline.from_pretrained(
                model_id,
                token=self.hf_token
            )
            
            # Move to appropriate device
            if device == "cuda":
                self._pipeline = self._pipeline.to(torch.device("cuda"))
            elif device == "mps":
                # MPS support may vary by pyannote version
                try:
                    self._pipeline = self._pipeline.to(torch.device("mps"))
                except Exception as e:
                    logger.warning(f"MPS not fully supported, falling back to CPU: {e}")
                    self._device = "cpu"
            
            self._model_loaded = True
            logger.info(f"Diarization model loaded successfully on {self._device}")
            return True
            
        except ImportError as e:
            logger.error(f"pyannote.audio not installed: {e}")
            raise RuntimeError(
                "pyannote.audio is not installed. "
                "Please install with: pip install pyannote.audio"
            )
        except Exception as e:
            logger.error(f"Failed to load diarization model: {e}")
            raise
        finally:
            self._loading = False
    
    def unload_model(self):
        """Unload the diarization model to free memory."""
        if self._pipeline is not None:
            del self._pipeline
            self._pipeline = None
            self._model_loaded = False
            
            # Clear GPU memory if available
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except ImportError:
                pass
                
            logger.info("Diarization model unloaded")
    
    def _load_audio_file(self, audio_path: str) -> Tuple[Any, int]:
        """
        Load an audio file into a tensor, handling various formats including MP4/AAC.
        
        This method tries multiple approaches to load the audio:
        1. torchaudio (default backend, works for WAV, FLAC, and supported formats)
        2. FFmpeg subprocess to convert MP4/AAC to WAV, then load with soundfile
        3. soundfile directly (fallback for WAV/FLAC files)
        
        Args:
            audio_path: Path to the audio file
            
        Returns:
            Tuple of (waveform tensor, sample_rate)
        """
        import torch
        import subprocess
        import shutil
        
        # Try loading with torchaudio first
        try:
            import torchaudio
            logger.debug("Attempting to load audio with torchaudio...")
            waveform, sample_rate = torchaudio.load(audio_path)
            logger.debug(f"Successfully loaded with torchaudio: shape={waveform.shape}, sr={sample_rate}")
            return waveform, sample_rate
        except Exception as e:
            logger.debug(f"torchaudio.load() failed: {e}")
        
        # If torchaudio fails, try converting with FFmpeg to WAV
        # This handles MP4/AAC and other formats that torchaudio may not support directly
        ffmpeg_path = shutil.which("ffmpeg")
        if ffmpeg_path:
            logger.debug("Attempting to convert audio with FFmpeg...")
            try:
                # Create a temporary WAV file
                temp_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
                temp_wav_path = temp_wav.name
                temp_wav.close()
                
                try:
                    # Convert to WAV using FFmpeg, preserving original sample rate
                    # -y: overwrite output file
                    # -i: input file
                    # -vn: no video
                    # -acodec pcm_s16le: PCM 16-bit little-endian (standard WAV)
                    # -ac 1: mono (pyannote.audio handles mono better)
                    cmd = [
                        ffmpeg_path,
                        "-y",
                        "-i", audio_path,
                        "-vn",
                        "-acodec", "pcm_s16le",
                        "-ac", "1",
                        temp_wav_path
                    ]
                    
                    logger.debug("Running FFmpeg conversion to WAV...")
                    
                    # Run FFmpeg with hidden console on Windows
                    creationflags = 0
                    if os.name == 'nt':
                        # CREATE_NO_WINDOW prevents console popup on Windows
                        creationflags = subprocess.CREATE_NO_WINDOW
                    
                    result = subprocess.run(
                        cmd,
                        capture_output=True,
                        text=True,
                        creationflags=creationflags
                    )
                    
                    if result.returncode != 0:
                        logger.warning(f"FFmpeg conversion failed: {result.stderr}")
                    else:
                        # Load the converted WAV file
                        import soundfile as sf
                        audio_data, sample_rate = sf.read(temp_wav_path)
                        
                        # Convert to torch tensor with shape (channels, samples)
                        # soundfile returns (samples,) for mono or (samples, channels) for stereo
                        if audio_data.ndim == 1:
                            waveform = torch.from_numpy(audio_data).float().unsqueeze(0)
                        else:
                            waveform = torch.from_numpy(audio_data.T).float()
                        
                        logger.debug(f"Successfully converted with FFmpeg: shape={waveform.shape}, sr={sample_rate}")
                        return waveform, sample_rate
                        
                finally:
                    # Clean up temp file
                    if os.path.exists(temp_wav_path):
                        os.unlink(temp_wav_path)
                        
            except Exception as e:
                logger.warning(f"FFmpeg conversion failed: {e}")
        else:
            logger.debug("FFmpeg not found in PATH")
        
        # Try loading with soundfile directly (works for WAV, FLAC, etc.)
        try:
            import soundfile as sf
            logger.debug("Attempting to load audio with soundfile...")
            audio_data, sample_rate = sf.read(audio_path)
            
            # Convert to torch tensor with shape (channels, samples)
            if audio_data.ndim == 1:
                waveform = torch.from_numpy(audio_data).float().unsqueeze(0)
            else:
                waveform = torch.from_numpy(audio_data.T).float()
            
            logger.debug(f"Successfully loaded with soundfile: shape={waveform.shape}, sr={sample_rate}")
            return waveform, sample_rate
        except Exception as e:
            logger.debug(f"soundfile.read() failed: {e}")
        
        # All methods failed
        raise RuntimeError(
            f"Failed to load audio file: {audio_path}\n"
            "Ensure FFmpeg is installed and in PATH for MP4/AAC support.\n"
            "Supported formats: WAV, FLAC (native); MP4/AAC (requires FFmpeg)"
        )
    
    async def diarize_audio(
        self,
        audio_path: str,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None
    ) -> DiarizationResult:
        """
        Perform speaker diarization on an audio file.
        
        Args:
            audio_path: Path to the audio file (supports WAV, FLAC, MP4/AAC with FFmpeg)
            min_speakers: Minimum expected number of speakers
            max_speakers: Maximum expected number of speakers
            
        Returns:
            DiarizationResult with speaker segments
            
        Note:
            Audio is loaded entirely into memory. For very large audio files (>1 hour),
            this may consume significant memory. MP4/AAC files require FFmpeg in PATH.
        """
        if not self._model_loaded or self._pipeline is None:
            await self.load_model()
        
        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio file not found: {audio_path}")
        
        logger.info(f"Starting diarization for: {audio_path}")
        
        try:
            import torch
            
            # Build kwargs for pipeline
            pipeline_kwargs = {}
            if min_speakers is not None:
                pipeline_kwargs["min_speakers"] = min_speakers
            if max_speakers is not None:
                pipeline_kwargs["max_speakers"] = max_speakers
            
            # Load audio file - handles various formats including MP4/AAC
            logger.debug(f"Loading audio file: {audio_path}")
            waveform, sample_rate = self._load_audio_file(audio_path)
            
            # Create audio input dict for pyannote.audio (in-memory waveform format)
            # pyannote.audio accepts {"waveform": tensor, "sample_rate": int} as input
            audio_input = {
                "waveform": waveform,
                "sample_rate": sample_rate
            }
            
            logger.debug(f"Audio loaded: {waveform.shape}, sample_rate={sample_rate}")
            
            # Run diarization (CPU-bound, run in thread pool)
            loop = asyncio.get_event_loop()
            output = await loop.run_in_executor(
                None,
                lambda: self._pipeline(audio_input, **pipeline_kwargs)
            )
            
            # Free waveform memory after pipeline completes
            del waveform
            del audio_input
            
            # Convert pyannote output to our format
            # pyannote.audio 4.x returns output with .speaker_diarization attribute
            # which is an Annotation object that can be iterated with itertracks()
            segments = []
            speaker_set = set()
            duration = 0.0
            
            # Get the diarization annotation (4.x style: output.speaker_diarization)
            diarization = getattr(output, 'speaker_diarization', output)
            
            for turn, _, speaker in diarization.itertracks(yield_label=True):
                segments.append(SpeakerSegment(
                    speaker_id=speaker,
                    start_time=turn.start,
                    end_time=turn.end
                ))
                speaker_set.add(speaker)
                duration = max(duration, turn.end)
            
            result = DiarizationResult(
                segments=segments,
                num_speakers=len(speaker_set),
                duration=duration
            )
            
            logger.info(
                f"Diarization complete: {len(segments)} segments, "
                f"{result.num_speakers} speakers, {result.duration:.2f}s duration"
            )
            
            return result
            
        except Exception as e:
            logger.error(f"Diarization failed: {e}")
            raise
    
    def assign_speakers_to_transcripts(
        self,
        diarization_result: DiarizationResult,
        transcripts: List[Dict]
    ) -> List[Dict]:
        """
        Assign speaker IDs to transcript segments based on diarization results.
        
        Uses temporal alignment to match transcript segments with speaker segments.
        
        Args:
            diarization_result: Result from diarize_audio()
            transcripts: List of transcript dicts with audio_start_time and audio_end_time
            
        Returns:
            Updated transcripts with speaker_id assigned
        """
        if not diarization_result.segments:
            return transcripts
        
        updated_transcripts = []
        
        for transcript in transcripts:
            t_start = transcript.get("audio_start_time")
            t_end = transcript.get("audio_end_time")
            
            if t_start is None:
                # No timing info, skip
                updated_transcripts.append(transcript)
                continue
            
            if t_end is None:
                t_end = t_start + 3.0  # Default segment duration
            
            # Find overlapping speaker segments
            speaker_durations: Dict[str, float] = {}
            
            for segment in diarization_result.segments:
                # Calculate overlap
                overlap_start = max(t_start, segment.start_time)
                overlap_end = min(t_end, segment.end_time)
                overlap = max(0, overlap_end - overlap_start)
                
                if overlap > 0:
                    speaker_durations[segment.speaker_id] = (
                        speaker_durations.get(segment.speaker_id, 0) + overlap
                    )
            
            # Assign speaker with most overlap
            if speaker_durations:
                best_speaker = max(speaker_durations, key=speaker_durations.get)
                transcript_copy = transcript.copy()
                transcript_copy["speaker_id"] = best_speaker
                updated_transcripts.append(transcript_copy)
            else:
                updated_transcripts.append(transcript)
        
        return updated_transcripts
    
    def _init_speaker_tracker(self):
        """
        Lazily initialize the speaker tracker for cross-chunk speaker consistency.
        
        This is the key improvement from the reference implementation:
        uses voice embeddings to maintain consistent speaker IDs across audio chunks.
        """
        if self._speaker_tracker is not None:
            return

        try:
            # Import from the diarization_service package
            import sys
            backend_dir = str(Path(__file__).parent.parent)
            if backend_dir not in sys.path:
                sys.path.insert(0, backend_dir)

            from diarization_service.speaker_tracker import SpeakerTracker

            persist_dir = os.path.join(self.models_dir, "speaker_embeddings")
            self._speaker_tracker = SpeakerTracker(
                auth_token=self.hf_token,
                device=self._device or "cpu",
                persist_dir=persist_dir
            )
            logger.info(f"Speaker tracker initialized (available: {self._speaker_tracker.is_available})")
        except ImportError as e:
            logger.warning(f"Speaker tracker not available (pyannote embedding model not installed): {e}")
            self._speaker_tracker = None
        except Exception as e:
            logger.warning(f"Failed to initialize speaker tracker: {e}")
            self._speaker_tracker = None

    async def diarize_audio_with_tracking(
        self,
        audio_path: str,
        session_id: str,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None
    ) -> DiarizationResult:
        """
        Perform speaker diarization with cross-chunk speaker tracking.
        
        This extends diarize_audio() by using voice embeddings to maintain
        consistent speaker IDs across multiple audio chunks within the same session.
        
        Args:
            audio_path: Path to the audio file
            session_id: Session/meeting ID for cross-chunk tracking
            min_speakers: Minimum expected number of speakers
            max_speakers: Maximum expected number of speakers
            
        Returns:
            DiarizationResult with session-consistent speaker IDs
        """
        # Run standard diarization first
        result = await self.diarize_audio(
            audio_path=audio_path,
            min_speakers=min_speakers,
            max_speakers=max_speakers
        )

        # Apply cross-chunk speaker tracking if available
        self._init_speaker_tracker()
        if self._speaker_tracker and self._speaker_tracker.is_available and result.segments:
            try:
                # Convert DiarizationResult segments to turns format
                turns = [
                    {"speaker": seg.speaker_id, "start": seg.start_time, "end": seg.end_time}
                    for seg in result.segments
                ]

                # Assign consistent speaker IDs
                updated_turns = self._speaker_tracker.assign_speakers(
                    session_id=session_id,
                    audio_path=audio_path,
                    diarization_turns=turns,
                    num_speakers=max_speakers
                )

                # Convert back to SpeakerSegment format
                updated_segments = [
                    SpeakerSegment(
                        speaker_id=turn["speaker"],
                        start_time=turn["start"],
                        end_time=turn["end"]
                    )
                    for turn in updated_turns
                ]

                speaker_set = set(seg.speaker_id for seg in updated_segments)
                result = DiarizationResult(
                    segments=updated_segments,
                    num_speakers=len(speaker_set),
                    duration=result.duration
                )

                logger.info(
                    f"Speaker tracking applied: {len(updated_segments)} segments, "
                    f"{result.num_speakers} consistent speakers for session {session_id}"
                )

            except Exception as e:
                logger.warning(f"Speaker tracking failed, using original diarization: {e}")

        return result

    def get_session_speakers(self, session_id: str) -> List[Dict]:
        """Get summary of speakers in a session."""
        self._init_speaker_tracker()
        if self._speaker_tracker and self._speaker_tracker.is_available:
            return self._speaker_tracker.get_session_speakers(session_id)
        return []

    def clear_session(self, session_id: str):
        """Clear a session's speaker tracking data."""
        self._init_speaker_tracker()
        if self._speaker_tracker and self._speaker_tracker.is_available:
            self._speaker_tracker.clear_session(session_id)

    @property
    def is_model_loaded(self) -> bool:
        """Check if diarization model is loaded."""
        return self._model_loaded
    
    @property 
    def device(self) -> str:
        """Get current device being used."""
        return self._device or "cpu"

    @property
    def speaker_tracking_available(self) -> bool:
        """Check if cross-chunk speaker tracking is available."""
        self._init_speaker_tracker()
        return self._speaker_tracker is not None and self._speaker_tracker.is_available


# Singleton instance
_diarization_service: Optional[DiarizationService] = None


def get_diarization_service(hf_token: Optional[str] = None) -> DiarizationService:
    """
    Get or create the singleton diarization service.
    
    Args:
        hf_token: Optional Hugging Face token to use
        
    Returns:
        DiarizationService instance
    """
    global _diarization_service
    
    if _diarization_service is None:
        _diarization_service = DiarizationService(hf_token=hf_token)
    elif hf_token and hf_token != _diarization_service.hf_token:
        # Token changed, recreate service
        _diarization_service = DiarizationService(hf_token=hf_token)
    
    return _diarization_service
