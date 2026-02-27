# Diarization Service - Speaker identification for meeting transcription
#
# This microservice wraps whisper.cpp transcription with pyannote.audio
# speaker diarization. It provides cross-chunk speaker tracking using
# voice embeddings for consistent speaker IDs throughout a meeting.

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Apply patches lazily to avoid circular imports
_patches_applied = False

def _apply_patches():
    """Apply compatibility patches for pyannote.audio."""
    global _patches_applied
    if _patches_applied:
        return
    
    _patches_applied = True
    
    # Patch 1: Fix torchaudio.AudioMetaData AttributeError
    # Some pyannote versions expect torchaudio.AudioMetaData which may not exist
    try:
        import torchaudio
        if not hasattr(torchaudio, 'AudioMetaData'):
            logger.debug("Adding missing torchaudio.AudioMetaData compatibility shim")
            # Create a simple namedtuple-like class for AudioMetaData
            from collections import namedtuple
            torchaudio.AudioMetaData = namedtuple(
                'AudioMetaData',
                ['sample_rate', 'num_frames', 'num_channels']
            )
        
        # Patch 1b: Fix torchaudio.list_audio_backends AttributeError
        # This was removed in torchaudio 2.0+ but pyannote may still reference it
        if not hasattr(torchaudio, 'list_audio_backends'):
            logger.debug("Adding missing torchaudio.list_audio_backends compatibility shim")
            def dummy_list_audio_backends():
                """Dummy function for compatibility with older pyannote versions."""
                return ['soundfile']  # Common default backend
            torchaudio.list_audio_backends = dummy_list_audio_backends
    except ImportError:
        logger.debug("torchaudio not available for patching")
    except Exception as e:
        logger.warning(f"Could not patch torchaudio: {e}")
    
    # Patch 2: Fix pyannote AudioDecoder import
    try:
        from .diarization import _patch_pyannote_audio_decoder
        _patch_pyannote_audio_decoder()
        logger.debug("Applied pyannote AudioDecoder patch")
    except Exception as e:
        logger.debug(f"Could not apply AudioDecoder patch: {e}")


def get_diarization_service(hf_token: Optional[str] = None, models_dir: Optional[str] = None):
    """
    Factory function to get a configured diarization service.
    Imports are deferred to avoid circular import issues.
    
    Args:
        hf_token: Hugging Face API token
        models_dir: Directory for model caching
        
    Returns:
        Configured AudioProcessor instance
    """
    # Apply patches before importing service components
    _apply_patches()
    
    from .config import DiarizationConfig
    from .processor import AudioProcessor
    
    config = DiarizationConfig(
        hf_auth_token=hf_token
    )
    return AudioProcessor(config)


# Lazy imports - only import when explicitly requested
def __getattr__(name):
    """Lazy loader for module attributes."""
    if name == 'AudioProcessor':
        _apply_patches()
        from .processor import AudioProcessor
        return AudioProcessor
    elif name == 'DiarizationEngine':
        _apply_patches()
        from .diarization import DiarizationEngine
        return DiarizationEngine
    elif name == 'SpeakerTracker':
        _apply_patches()
        from .speaker_tracker import SpeakerTracker
        return SpeakerTracker
    elif name == 'DiarizationConfig':
        _apply_patches()
        from .config import DiarizationConfig
        return DiarizationConfig
    elif name == 'AudioConverter':
        _apply_patches()
        from .audio_utils import AudioConverter
        return AudioConverter
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    'get_diarization_service',
    'AudioProcessor',
    'DiarizationEngine', 
    'SpeakerTracker',
    'DiarizationConfig',
    'AudioConverter',
]

