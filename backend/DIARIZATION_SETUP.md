# Speaker Diarization Setup Guide

This guide explains how to set up and configure the speaker diarization feature in Meetily.

## Overview

Meetily uses [pyannote.audio](https://github.com/pyannote/pyannote-audio) for speaker diarization, which identifies and separates different speakers in audio recordings.

## Requirements

### Python Version
- Python 3.10 or higher

### Dependencies

The diarization feature requires:
- `pyannote.audio` 4.0.3 (upgraded from 3.3.2)
- `torch` >= 2.2.0 with CUDA support (for GPU acceleration)
- `torchaudio` >= 2.2.0
- `torchcodec` >= 0.1.0 (used by pyannote.audio 4.x for audio I/O)
- `huggingface_hub` for model downloads

### GPU Support (Recommended)

For optimal performance, install PyTorch with CUDA support:

#### Windows / Linux with NVIDIA GPU (CUDA 11.8)
```bash
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118
```

#### Windows / Linux with NVIDIA GPU (CUDA 12.1)
```bash
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
```

#### macOS with Apple Silicon
PyTorch includes MPS (Metal Performance Shaders) support by default:
```bash
pip install torch torchaudio
```

#### CPU Only (No GPU)
```bash
pip install torch torchaudio
```

## Installation Steps

### 1. Install Base Requirements
```bash
cd backend
pip install -r requirements.txt
```

### 2. Upgrade PyTorch for GPU Support (Optional but Recommended)

If you want GPU acceleration and didn't install CUDA-enabled PyTorch in step 1:

```bash
# For NVIDIA GPUs with CUDA 11.8
pip install --upgrade torch torchaudio --index-url https://download.pytorch.org/whl/cu118

# For NVIDIA GPUs with CUDA 12.1
pip install --upgrade torch torchaudio --index-url https://download.pytorch.org/whl/cu121
```

### 3. Configure Hugging Face Token

Diarization models require authentication with Hugging Face:

1. Create an account at [Hugging Face](https://huggingface.co/)
2. Accept the model license at [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1)
3. Generate an access token at [Hugging Face Settings](https://huggingface.co/settings/tokens)
4. Set the token as an environment variable:

**Windows (PowerShell):**
```powershell
$env:HF_TOKEN="your-token-here"
```

**macOS/Linux:**
```bash
export HF_TOKEN="your-token-here"
```

**Or add to `.env` file:**
```bash
echo "HF_TOKEN=your-token-here" >> .env
```

## Model Information

### Default Model
- **Model ID**: `pyannote/speaker-diarization-community-1`
- **Version**: Compatible with pyannote.audio 4.x
- **Size**: ~500 MB
- **Features**: VBx clustering, exclusive diarization, improved speaker assignment
- **Use Case**: Best accuracy for pyannote.audio 4.x with better transcription alignment

### Alternative Models

For legacy compatibility or testing:
- `pyannote/speaker-diarization-3.1` (older model with hierarchical clustering)

To change the model, update the `DEFAULT_DIARIZATION_MODEL` in `app/diarization_service.py` or configure it via the API.

## Verification

Test your installation:

```python
import torch
import torchaudio
import pyannote.audio

print(f"PyTorch version: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"CUDA version: {torch.version.cuda}")
    print(f"GPU: {torch.cuda.get_device_name(0)}")

print(f"TorchAudio version: {torchaudio.__version__}")
print(f"pyannote.audio version: {pyannote.audio.__version__}")
```

## Troubleshooting

### FFmpeg Extension Errors

If you see errors about FFmpeg extensions not loading:

1. **Install FFmpeg** on your system:
   - **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH
   - **macOS**: `brew install ffmpeg`
   - **Linux**: `sudo apt-get install ffmpeg` (Ubuntu/Debian) or `sudo yum install ffmpeg` (CentOS/RHEL)

2. **Reinstall torchcodec**:
   ```bash
   pip uninstall torchcodec
   pip install torchcodec
   ```

### CUDA Not Available

If PyTorch doesn't detect your GPU:

1. Verify NVIDIA drivers are installed: `nvidia-smi`
2. Check CUDA toolkit installation
3. Reinstall PyTorch with correct CUDA version:
   ```bash
   pip uninstall torch torchaudio
   pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118
   ```

### Token Authentication Errors

If you see "Pipeline.from_pretrained() got an unexpected keyword argument 'token'":
- This means pyannote.audio version is outdated (< 4.0)
- Ensure you've installed pyannote.audio 4.0.3: `pip install pyannote.audio==4.0.3`

### AudioDecoder Not Defined Error

If you see "name 'AudioDecoder' is not defined":
- This indicates torchcodec is not properly installed or FFmpeg dependencies are missing
- The service automatically falls back to loading audio with torchaudio
- **Solution**:
  1. Ensure FFmpeg is installed on your system
  2. Reinstall torchcodec: `pip uninstall torchcodec && pip install torchcodec`
  3. If the issue persists, the fallback to torchaudio will work automatically

### Model Download Failures

If models fail to download:
1. Check your internet connection
2. Verify your HF_TOKEN is valid and has accepted the model license
3. Accept the new model license at: https://huggingface.co/pyannote/speaker-diarization-community-1
4. Manually cache the model:
   ```python
   from pyannote.audio import Pipeline
   pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-community-1", token="YOUR_TOKEN")
   ```

## API Usage

### Load Model
```bash
curl -X POST http://localhost:5167/diarization/load-model
```

### Check Model Status
```bash
curl -X GET http://localhost:5167/diarization/model-status
```

### Process Audio
```bash
curl -X POST http://localhost:5167/diarization/process \
  -H "Content-Type: application/json" \
  -d '{
    "audio_path": "/path/to/audio.wav",
    "min_speakers": 2,
    "max_speakers": 5
  }'
```

## Performance Considerations

### GPU vs CPU
- **GPU**: ~10-20x faster than CPU for diarization
- **CPU**: Works but significantly slower, suitable for short audio files

### Memory Requirements
- **Minimum**: 4 GB RAM
- **Recommended**: 8 GB RAM (16 GB for large files)
- **GPU**: 4 GB VRAM minimum

### Model Size Impact
The diarization model (~500 MB) is loaded into memory when first used and remains loaded for faster subsequent processing.

## Changes from Version 3.3.2 to 4.0.3

### Breaking Changes
1. **API Parameter**: Changed from `use_auth_token` to `token` ✅ (already implemented)
2. **Audio I/O**: Now uses `torchcodec` instead of `torchaudio` for audio loading
3. **Python**: Requires Python >= 3.10 (dropped support for 3.8 and 3.9)

### New Features
1. **Better Clustering**: VBx clustering for improved speaker assignment
2. **Exclusive Diarization**: Cleaner timestamps for transcription alignment
3. **Faster Training**: Optimized dataloaders and metadata caching
4. **Offline Support**: Models can be stored locally for air-gapped use

## References

- [pyannote.audio GitHub](https://github.com/pyannote/pyannote-audio)
- [pyannote.audio Documentation](https://github.com/pyannote/pyannote-audio/tree/develop)
- [PyTorch Installation Guide](https://pytorch.org/get-started/locally/)
- [Hugging Face Model Hub](https://huggingface.co/pyannote)
