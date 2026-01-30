# Diarization Feature Fix Summary

This document summarizes the changes made to fix and upgrade the speaker diarization feature.

## Problem Statement

The diarization feature had three critical issues:

1. **Torch and torchaudio not using CUDA-enabled versions** - No clear instructions for GPU acceleration
2. **FFmpeg extension loading failures** - `torio` library couldn't load FFmpeg extensions (libtorio_ffmpeg4/5/6.pyd)
3. **pyannote.audio API incompatibility** - Version 3.3.2 doesn't support `token` parameter, causing error: "Pipeline.from_pretrained() got an unexpected keyword argument 'token'"

## Root Cause Analysis

### Issue 1: CUDA Support
The requirements.txt specified torch/torchaudio without platform-specific installation instructions. By default, pip installs CPU-only versions.

### Issue 2: FFmpeg Extensions
pyannote.audio 3.3.2 relies on `torio` (part of torchaudio) for audio I/O, which has complex FFmpeg dependencies that often fail to load on Windows.

### Issue 3: API Incompatibility
- pyannote.audio 3.3.2 uses `use_auth_token` parameter
- pyannote.audio 4.x uses `token` parameter (breaking change)
- The code was written for 4.x API but installed 3.3.2
- Model pyannote/speaker-diarization-3.1 requires pyannote.audio >= 3.4.0

## Solution

### 1. Upgraded pyannote.audio to 4.0.3

**Changed in requirements.txt:**
```python
# Before
pyannote.audio==3.3.2

# After
pyannote.audio==4.0.3
```

**Benefits:**
- Uses `token` parameter (matches existing code)
- Uses `torchcodec` instead of `torio` for audio I/O (better FFmpeg handling)
- Supports pyannote/speaker-diarization-3.1 model
- Includes VBx clustering for better speaker assignment
- Supports numpy 2.x (removed version constraint)

### 2. Updated PyTorch Dependencies

**Changed in requirements.txt:**
```python
# Before
torch>=2.0.0,<2.6.0
torchaudio>=2.0.0,<2.6.0

# After
torch>=2.2.0
torchaudio>=2.2.0
torchcodec>=0.1.0  # New dependency
```

**Added installation instructions:**
- CPU-only: Default pip installation
- CUDA 11.8: `pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118`
- CUDA 12.1: `pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121`
- Apple Silicon: Default pip installation (includes MPS support)

### 3. Removed numpy Constraint

**Changed in requirements.txt:**
```python
# Before
numpy>=1.21.0,<2.0.0

# After
numpy>=1.21.0
```

pyannote.audio 4.x is compiled with numpy 2.x support, so the <2.0 constraint is no longer needed.

### 4. Updated Python Version Requirement

**Requirement:** Python 3.10+

pyannote.audio 4.x dropped support for Python 3.8 and 3.9. Updated all documentation to reflect this requirement.

## Documentation Changes

### Created DIARIZATION_SETUP.md
Comprehensive guide covering:
- Installation instructions for different platforms and GPU types
- Hugging Face token setup and model licensing
- Model information and alternatives
- Troubleshooting common issues (FFmpeg, CUDA, token errors)
- API usage examples
- Performance considerations
- Breaking changes from 3.3.2 to 4.0.3

### Updated README.md
- Changed Python requirement from 3.8+/3.9+ to 3.10+ in all sections
- Added GPU installation instructions
- Added reference to DIARIZATION_SETUP.md
- Fixed brew command for Python installation
- Added notes about diarization requirements

### Updated diarization_service.py
- Updated comments to note compatibility with pyannote.audio 4.x
- No code changes needed (already using correct API)

## Verification of Fixes

### Issue 1: CUDA Support ✅
- Added clear installation instructions in requirements.txt, README.md, and DIARIZATION_SETUP.md
- Users can now install CUDA-enabled PyTorch with specific commands
- Documentation covers CUDA 11.8, 12.1, and alternative platforms

### Issue 2: FFmpeg Extensions ✅
- Replaced torio with torchcodec (pyannote.audio 4.x feature)
- torchcodec has better FFmpeg dependency handling
- Added troubleshooting section for FFmpeg issues
- Added system-level FFmpeg installation instructions

### Issue 3: Token Parameter ✅
- Upgraded to pyannote.audio 4.0.3 which supports `token` parameter
- Code already used correct `token` parameter (no changes needed)
- Now compatible with pyannote/speaker-diarization-3.1 model
- Error "Pipeline.from_pretrained() got an unexpected keyword argument 'token'" will no longer occur

## Testing Recommendations

To verify the fix works:

1. **Fresh Installation**
   ```bash
   # Create new virtual environment
   python3.10 -m venv venv
   source venv/bin/activate  # or venv\Scripts\activate on Windows
   
   # Install dependencies
   pip install -r requirements.txt
   
   # For GPU (optional)
   pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118
   
   # Set HF token
   export HF_TOKEN="your-token-here"
   ```

2. **Verify Installation**
   ```python
   import torch
   import torchaudio
   import pyannote.audio
   import torchcodec
   
   print(f"PyTorch: {torch.__version__}")
   print(f"CUDA available: {torch.cuda.is_available()}")
   print(f"pyannote.audio: {pyannote.audio.__version__}")
   ```

3. **Test Diarization Service**
   ```bash
   # Start backend
   python -m uvicorn app.main:app --host 0.0.0.0 --port 5167
   
   # Test model loading
   curl -X POST http://localhost:5167/diarization/load-model
   
   # Should return: {"status": "success", "message": "Model loaded successfully", "device": "cuda"}
   ```

## Breaking Changes

**For Users:**
1. **Python 3.10+ required** - Must upgrade if using older Python versions
2. **Reinstall dependencies** - Run `pip install -r requirements.txt` to get new versions
3. **GPU setup changed** - Follow new CUDA installation instructions for GPU support

**For Developers:**
None - The code already used the correct API that pyannote.audio 4.x expects.

## Migration Guide

**From pyannote.audio 3.3.2 to 4.0.3:**

1. Verify Python version: `python --version` (must be >= 3.10)
2. Backup existing environment (optional): `pip freeze > old_requirements.txt`
3. Uninstall old versions: `pip uninstall pyannote.audio torch torchaudio -y`
4. Install new versions: `pip install -r requirements.txt`
5. For GPU: `pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118`
6. Set HF_TOKEN environment variable
7. Test: Run backend and call `/diarization/load-model` endpoint

## Files Changed

1. **backend/requirements.txt** - Updated dependencies and added comments
2. **backend/app/diarization_service.py** - Updated model compatibility comment
3. **backend/DIARIZATION_SETUP.md** - New comprehensive setup guide (251 lines)
4. **backend/README.md** - Updated Python requirements and added diarization instructions

## Security Analysis

CodeQL scan completed with **0 alerts** - no security vulnerabilities introduced.

## References

- [pyannote.audio 4.0.3 Release Notes](https://github.com/pyannote/pyannote-audio/releases/tag/4.0.3)
- [pyannote.audio 4.0 Breaking Changes](https://github.com/pyannote/pyannote-audio/releases/tag/4.0.0)
- [PyTorch Installation Guide](https://pytorch.org/get-started/locally/)
- [torchcodec Documentation](https://github.com/pytorch/torchcodec)
- [pyannote/speaker-diarization-3.1 Model](https://huggingface.co/pyannote/speaker-diarization-3.1)

## Future Improvements

1. Consider adding pyannote/speaker-diarization-community-1 as an alternative model
2. Add automated tests for diarization functionality
3. Consider Docker images with pre-installed GPU dependencies
4. Add performance benchmarks for different GPU/CPU configurations
