# Diarization Service Fix - Complete AudioDecoder & Compatibility Patch

## Problem
The diarization service was failing with the following error:
```
NameError: name 'AudioDecoder' is not defined
```

And also:
```
AttributeError: module 'torchaudio' has no attribute 'AudioMetaData'
```

Both errors prevented the diarization/"Enhance" feature from working.

### Root Causes

1. **AudioDecoder NameError**: Pyannote.audio 4.x on Windows (especially when torchcodec is not properly installed) has a missing import for `AudioDecoder` in its `io.py` module. This is a known issue (pyannote/pyannote-audio #1370).

2. **torchaudio.AudioMetaData AttributeError**: A version mismatch between pyannote.audio and torchaudio where pyannote expects an `AudioMetaData` class that doesn't exist in the installed torchaudio version.

## Solution
A comprehensive compatibility patch system has been implemented that:
1. Patches torchaudio to provide a missing `AudioMetaData` class
2. Patches pyannote's `get_audio_metadata` to handle in-memory audio without using AudioDecoder
3. Applies patches at module initialization time before any pyannote code runs

### Changes Made

#### 1. **[diarization_service/__init__.py](diarization_service/__init__.py)** (MAIN FIX)
   - **Patch 1 - torchaudio.Audio': Added a compatibility shim for missing `AudioMetaData`
     - Creates a namedtuple-compatible class if torchaudio doesn't provide it
     - Executed immediately when the module is imported
   - **Patch 2 - pyannote AudioDecoder**: Applied after torchaudio patch
     - Calls the `_patch_pyannote_audio_decoder()` function from diarization.py
   - Implements lazy loading via `__getattr__` to avoid circular imports
   - Maintains `get_diarization_service()` factory function for backward compatibility

#### 2. **[diarization_service/diarization.py](diarization_service/diarization.py)**
   - Added `_patch_pyannote_audio_decoder()` function at module level
   - Patches `pyannote.audio.core.io.get_audio_metadata` to handle in-memory audio
   - For in-memory audio dicts (with "waveform" and "sample_rate" keys):
     - Creates minimal metadata object without using AudioDecoder
     - Correctly calculates sample_rate, num_channels, num_frames, and duration
     - Handles both PyTorch tensors and numpy arrays
   - Falls back to original implementation for file paths (if AudioDecoder works)
   - Gracefully handles missing imports and version differences

#### 3. **[diarization_service/audio_utils.py](diarization_service/audio_utils.py)**
   - No changes needed - AudioConverter class was already properly implemented
   - Converts audio to WAV format for diarization processing

## How It Works

### Patch Application Flow
```
Import diarization_service package
    ↓
__init__.py executes
    ↓
Patch 1: Add torchaudio.AudioMetaData compatibility shim
    ↓
Patch 2: Import _patch_pyannote_audio_decoder and apply it
    ↓
This fixes pyannote.audio.core.io.get_audio_metadata
    ↓
Any subsequent pyannote imports work without errors
```

### Audio Processing Flow with Patches
1. User uploads audio file  
2. Audio converted to WAV (16kHz mono) via AudioConverter
3. Audio file loaded into memory as tensor/array  
4. Audio passed to pyannote as in-memory dict: `{"waveform": tensor, "sample_rate": 16000}`
5. **Patched `get_audio_metadata`** recognizes the dict and creates metadata directly
   - No AudioDecoder invocation for in-memory audio
   - Metadata object is created from tensor dimensions
6. Diarization proceeds normally
7. Speaker segments returned to user

## Testing

### Quick Test
```bash
# Navigate to backend directory
cd backend

# Run validation tests
python test_diarization_fix.py
```

Expected output: `Results: 3/3 tests passed`

### Full Integration Test
1. Start backend: `clean_start_backend.sh` (macOS) or `clean_start_backend.cmd` (Windows)
2. Upload an audio file via the enhance/diarization endpoint
3. Diarization should complete without errors
4. Speaker segments should be returned in the response

## Important Notes

### How the Patches Work
1. **torchaudio patch**: Creates a simple namedtuple if AudioMetaData doesn't exist. This allows pyannote to import without errors even if torchaudio is incomplete.

2. **AudioDecoder patch**: Intercepts metadata requests and handles in-memory audio directly, bypassing the need for AudioDecoder. File paths still attempt to use the original function.

### Backward Compatibility
- Existing code that uses the diarization service doesn't need to change
- Patches are applied transparently when `diarization_service` is imported
- Service gracefully degrades if optional components are missing

### Version Compatibility
- Works with pyannote.audio 4.x on Windows
- Handles partial/incomplete torchaudio installations
- Gracefully handles missing imports

## Related Issues
- **pyannote/pyannote-audio #1370**: AudioDecoder missing import on Windows
- **Version mismatch**: torchaudio not providing AudioMetaData class
- **Windows environment**: FFmpeg and torchcodec issues handled separately

## Files Modified
- `backend/diarization_service/__init__.py` (MAIN FIX)
- `backend/diarization_service/diarization.py`
- `backend/test_diarization_fix.py` (validation script)

## Running the Tests
```bash
cd backend
python test_diarization_fix.py
```

All 3 tests should pass:
- ✓ Import diarization_service
- ✓ Verify pyannote patch  
- ✓ Initialize service



