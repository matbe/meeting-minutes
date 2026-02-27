"""
Import wrapper for diarization_service module.

This file allows imports of the form:
    from diarization_service import DiarizationService
    
while keeping the actual implementation in ../diarization_service/
"""

import sys
import os

# Ensure parent directory is in path so we can import diarization_service module
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

# Re-export from the actual module
from diarization_service import (
    DiarizationService,
    DiarizationResult,
    ModelInfo,
    get_diarization_service
)

__all__ = [
    'DiarizationService',
    'DiarizationResult',
    'ModelInfo',
    'get_diarization_service'
]
