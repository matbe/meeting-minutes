"""Configuration for the diarization service."""
import os
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


def _detect_device() -> str:
    """Detect the best available compute device."""
    try:
        import torch
        if torch.cuda.is_available():
            logger.info("CUDA available - using GPU for diarization")
            return "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            logger.info("MPS available - using Apple Silicon GPU for diarization")
            return "mps"
    except ImportError:
        logger.warning("PyTorch not installed - defaulting to CPU")
    logger.info("Using CPU for diarization")
    return "cpu"


@dataclass
class DiarizationConfig:
    """Configuration for the diarization service."""

    # Pyannote diarization pipeline model
    diarization_pipeline_name: str = field(
        default_factory=lambda: os.getenv(
            "DIARIZATION_PIPELINE",
            "pyannote/speaker-diarization-3.1"
        )
    )

    # Hugging Face authentication token (required for gated pyannote models)
    hf_auth_token: Optional[str] = field(
        default_factory=lambda: os.getenv("HF_AUTH_TOKEN", "")
    )

    # Audio conversion settings (for diarization input)
    audio_convert_sample_rate: int = 16000
    audio_convert_channels: int = 1

    # Speaker embedding persistence directory (optional, for cross-chunk tracking)
    speaker_embedding_dir: Optional[str] = field(
        default_factory=lambda: os.getenv("SPEAKER_EMBEDDING_DIR", "")
    )

    # Device (auto-detected)
    device_str: str = field(init=False)

    def __post_init__(self):
        """Detect available device after initialization."""
        self.device_str = _detect_device()

        if not self.hf_auth_token:
            logger.warning(
                "HF_AUTH_TOKEN not set. Pyannote models require authentication. "
                "Set HF_AUTH_TOKEN environment variable with your Hugging Face token."
            )
