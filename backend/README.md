# Meetily Backend

FastAPI backend for meeting transcription and analysis.

## 📋 Table of Contents
- [⚠️ Important Notes](#️-important-notes)
- [🚀 Quick Start](#-quick-start)
- [💻 Native Development](#-native-development)
- [🔧 Manual Installation](#-manual-installation)
- [📚 API Documentation](#-api-documentation)
- [🛠️ Troubleshooting](#️-troubleshooting)
- [📖 Complete Script Reference](#-complete-script-reference)

---

## ⚠️ Important Notes

### Audio Processing Requirements
Ensure adequate system resources for audio processing:

**Symptoms of insufficient resources:**
- Log messages: "Dropped old audio chunk X due to queue overflow"
- Missing or incomplete transcriptions
- Processing delays

**Prevention:**
- Allocate **8GB+ RAM** for the backend services
- Ensure adequate CPU allocation
- Use appropriate Whisper model size for your hardware
- Monitor system resource usage

---

## 🚀 Quick Start

### Native Development (Best Performance)
```bash
# Navigate to backend directory
cd backend

# Windows - Install dependencies first, then build
.\install_dependancies_for_windows.ps1  # Run as Administrator
build_whisper.cmd small
start_with_output.ps1

# macOS/Linux
./build_whisper.sh small
./clean_start_backend.sh
```

**After startup, access:**
- **Whisper Server**: http://localhost:8178
- **Meeting App**: http://localhost:5167 (with API docs at `/docs`)

### Model Size Guide

| Model | Size | Accuracy | Speed | Best For |
|-------|------|----------|-------|----------|
| tiny | ~39 MB | Basic | Fastest | Testing, low resources |
| base | ~142 MB | Good | Fast | General use (recommended) |
| small | ~244 MB | Better | Medium | Better accuracy needed |
| medium | ~769 MB | High | Slow | High accuracy requirements |
| large-v3 | ~1550 MB | Best | Slowest | Maximum accuracy |

---

## 💻 Native Development

Native deployment offers optimal performance by running directly on the host system.

### Prerequisites

#### Windows
- Python 3.8+ (in PATH)
- Visual Studio Build Tools (C++ workload)
- CMake
- Git
- PowerShell 5.0+

#### macOS
- Xcode Command Line Tools: `xcode-select --install`
- Homebrew: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
- Python 3.8+: `brew install python3`
- Dependencies: `brew install cmake llvm libomp`

### Windows Setup

**📦 Option 1: Pre-built Release (Recommended - Easiest)**

The simplest and fastest way to get started is using the pre-built backend release:

**Prerequisites:**
- No additional dependencies required

**Installation Steps:**
1. Download the latest backend zip file from [releases](https://github.com/Zackriya-Solutions/meeting-minutes/releases/latest)
2. Extract to a folder (e.g., `C:\meetily_backend\`)
3. Open PowerShell and navigate to the extracted folder
4. Unblock all files (Windows security requirement):
   ```powershell
   Get-ChildItem -Path . -Recurse | Unblock-File
   ```
5. Start the backend:
   ```powershell
   .\start_with_output.ps1
   ```

**What it includes:**
- Pre-compiled `whisper-server.exe` binary
- Complete Python application with virtual environment
- All required dependencies pre-installed
- Automatic model download and setup
- Interactive model and language selection

**Features:**
- Automatic whisper-server.exe download from GitHub releases if not present
- Interactive model selection (tiny to large-v3)
- Language selection (40+ supported languages)
- Port configuration with conflict detection
- Virtual environment setup and dependency installation
- Option to download and install the frontend application

✅ **Success Check:** The script will guide you through setup and start both Whisper server (port 8178) and Meeting app (port 5167) automatically.

**�️ Option 2: Local Build (Best Performance)**

For optimal performance, build locally after installing dependencies:

**🔧 Required Dependencies (Install First):**
- **Python 3.9+** with pip (add to PATH)
- **Visual Studio Build Tools** (C++ workload)
- **CMake** (add to PATH)
- **Git** (with submodules support)
- **Visual Studio Redistributables**

**Step 1: Install Dependencies**
```powershell
# Run dependency installer (as Administrator)
Set-ExecutionPolicy Bypass -Scope Process -Force
.\install_dependancies_for_windows.ps1
```
*⚠️ This takes 15-30 minutes and installs all required tools*

**Step 2: Build Whisper**
```cmd
# Build whisper.cpp with model (e.g., 'small', 'base.en', 'large-v3')
build_whisper.cmd small

# Start services interactively
start_with_output.ps1

# Alternative: Clean start
clean_start_backend.cmd
```

**Build Process:**
1. Updates git submodules (`whisper.cpp`)
2. Copies custom server files from `whisper-custom/server/`
3. Compiles whisper.cpp using CMake + Visual Studio
4. Creates Python virtual environment in `venv/`
5. Installs dependencies from `requirements.txt`
6. Downloads specified Whisper model
7. Creates `whisper-server-package/` with all files

**Dependency Installation Details:**
The `install_dependancies_for_windows.ps1` script installs:
- Chocolatey package manager
- Python 3.11 (if not present)
- Visual Studio Build Tools 2022 with C++ workload
- CMake with PATH integration
- Git with submodule support
- Visual Studio Redistributables
- Development tools (bun, if needed)

### macOS Setup

```bash
# Navigate to backend directory
cd backend

# Build whisper.cpp with model
./build_whisper.sh small

# Start services
./clean_start_backend.sh
```

**macOS Optimizations:**
- OpenMP acceleration with `libomp`
- LLVM compiler optimizations for Apple Silicon
- Automatic M1/M2 vs Intel detection
- Optimized thread allocation for Apple Silicon cores

### Service URLs
- **Whisper Server**: http://localhost:8178
  - Health: `GET /`
  - Transcription: `POST /inference`
  - WebSocket: `ws://localhost:8178/`
- **Meeting App**: http://localhost:5167
  - API docs: http://localhost:5167/docs
  - Health: `GET /get-meetings`
  - WebSocket: `ws://localhost:5167/ws`

---

## 🔧 Manual Installation

If you prefer complete manual control over the installation process.

### System Requirements
- Python 3.9+
- FFmpeg
- C++ compiler (Visual Studio Build Tools/Xcode)
- CMake
- Git (with submodules support)
- Ollama (for LLM features)
- ChromaDB
- API Keys (Claude/Groq) if using external LLMs

### Step-by-Step Installation

#### 1. Install System Dependencies

**Windows:**
```cmd
# Python 3.9+ from Python.org (add to PATH)
# Visual Studio Build Tools (Desktop C++ workload)
# CMake from CMake.org (add to PATH)
# FFmpeg (download or: choco install ffmpeg)
# Git from Git-scm.com
# Ollama from Ollama.com
```

**macOS:**
```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install dependencies
brew install python@3.9 cmake llvm libomp ffmpeg git ollama
```

#### 2. Install Python Dependencies
```bash
# Windows
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

# macOS
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements.txt
```

#### 3. Build Whisper Server
```bash
# Windows
./build_whisper.cmd

# macOS (make executable if needed)
chmod +x build_whisper.sh
./build_whisper.sh
```

#### 4. Start Services
```bash
# Windows
./start_with_output.ps1

# macOS
chmod +x clean_start_backend.sh
./clean_start_backend.sh
```

---

## 📚 API Documentation

Once services are running:
- **Swagger UI**: http://localhost:5167/docs
- **ReDoc**: http://localhost:5167/redoc

### Core Services
1. **Whisper.cpp Server** (Port 8178)
   - Real-time audio transcription
   - WebSocket support for streaming
   - Multiple model support

2. **FastAPI Backend** (Port 5167)
   - Meeting management APIs
   - LLM integration (Claude, Groq, Ollama)
   - Data storage and retrieval
   - WebSocket for real-time updates

---

## 🛠️ Troubleshooting

### Common Native Issues

**Windows Build Problems:**
```cmd
# CMake not found - install Visual Studio Build Tools
# PowerShell execution blocked:
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
```

**macOS Build Problems:**
```bash
# Compilation errors
brew install cmake llvm libomp
export CC=/opt/homebrew/bin/clang
export CXX=/opt/homebrew/bin/clang++

# Permission denied
chmod +x build_whisper.sh
chmod +x clean_start_backend.sh

# Port conflicts
lsof -i :5167  # Find process using port
kill -9 PID   # Kill process
```

### General Issues

**Services Won't Start:**
1. Check if ports 8178 (Whisper) and 5167 (Backend) are available
2. Verify all dependencies are installed
3. Check logs for specific error messages
4. Ensure sufficient system resources (8GB+ RAM recommended)

**Model Issues:**
- Verify internet connection for model downloads
- Check available disk space (models can be 1.5GB+)
- Validate model names against supported list

---

## 📖 Complete Script Reference

### Native Scripts

#### build_whisper.cmd / build_whisper.sh
Build whisper.cpp server with custom modifications.

**Usage:**
```bash
build_whisper.cmd [MODEL_NAME]    # Windows
./build_whisper.sh [MODEL_NAME]   # macOS/Linux
```

**Available Models:**
```
tiny, tiny.en, base, base.en, small, small.en, medium, medium.en,
large-v1, large-v2, large-v3, large-v3-turbo, 
*-q5_1 (5-bit quantized), *-q8_0 (8-bit quantized)
```

### Environment Variables

**Service Configuration:**
```bash
WHISPER_MODEL=base.en          # Default model
WHISPER_PORT=8178              # Whisper port
APP_PORT=5167                  # App port
WHISPER_LANGUAGE=auto          # Language
WHISPER_TRANSLATE=false        # Translation
WHISPER_DIARIZE=false          # Diarization
```

### Advanced Features

**Port Conflict Resolution:**
- Automatic detection of port conflicts
- Option to kill processes using required ports
- Suggestion of alternative ports
- Validation of port availability

**GPU Detection:**
- Automatic NVIDIA GPU detection
- Fallback to CPU mode when GPU unavailable

**Model Management:**
- Automatic model downloading
- Size estimation and progress display
- Local model caching
- Model validation and integrity checking

**Interactive Setup:**
- Model selection with guidance
- Language selection (40+ languages)
- Database migration assistance
- Settings persistence and reuse
- Configuration validation

This comprehensive guide covers all deployment options and provides clear instructions for getting the Meetily backend running in any environment.