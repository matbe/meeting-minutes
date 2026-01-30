"""
Speaker Diarization Service using pyannote.audio

Provides voice-based speaker recognition using pyannote.audio models.
Supports GPU acceleration with automatic fallback to CPU.

Requires:
- pyannote.audio >= 4.0.0 (manages torch, torchaudio, torchcodec versions)
- FFmpeg shared libraries installed on the system (required by torchcodec for audio I/O)
  - On Windows: Download "shared" FFmpeg build from https://ffmpeg.org/download.html
  - On macOS: Install via `brew install ffmpeg`
  - On Linux: Install via package manager (e.g., `apt install ffmpeg`)
- Hugging Face token with access to the diarization model

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
    
    async def diarize_audio(
        self,
        audio_path: str,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None
    ) -> DiarizationResult:
        """
        Perform speaker diarization on an audio file.
        
        Args:
            audio_path: Path to the audio file
            min_speakers: Minimum expected number of speakers
            max_speakers: Maximum expected number of speakers
            
        Returns:
            DiarizationResult with speaker segments
        """
        if not self._model_loaded or self._pipeline is None:
            await self.load_model()
        
        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio file not found: {audio_path}")
        
        logger.info(f"Starting diarization for: {audio_path}")
        
        try:
            # Build kwargs for pipeline
            pipeline_kwargs = {}
            if min_speakers is not None:
                pipeline_kwargs["min_speakers"] = min_speakers
            if max_speakers is not None:
                pipeline_kwargs["max_speakers"] = max_speakers
            
            # Run diarization (CPU-bound, run in thread pool)
            loop = asyncio.get_event_loop()
            output = await loop.run_in_executor(
                None,
                lambda: self._pipeline(audio_path, **pipeline_kwargs)
            )
            
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
    
    @property
    def is_model_loaded(self) -> bool:
        """Check if diarization model is loaded."""
        return self._model_loaded
    
    @property 
    def device(self) -> str:
        """Get current device being used."""
        return self._device or "cpu"


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
