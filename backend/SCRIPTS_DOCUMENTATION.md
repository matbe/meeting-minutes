# Backend Scripts Documentation

This comprehensive document details all the `.cmd`, `.ps1`, and `.sh` scripts in the backend directory, their purposes, usage patterns, interactions, and available options.

## Overview

The backend contains two categories of deployment approaches:

1. **Native Development Scripts** - Direct execution on the host system
2. **Legacy/Utility Scripts** - Supporting utilities and older approaches

## Quick Start Guide: Building and Running the Backend

### Native Approach (Recommended for best transcription speed)

#### Windows

**Prerequisites:**
- Python 3.8+ installed and in PATH
- Git with submodules support
- CMake and Visual Studio Build Tools
- PowerShell 5.0+ (for advanced scripts)

**Build Process:**
```cmd
# 1. Navigate to backend directory
cd backend

# 2. Build whisper.cpp and setup environment
build_whisper.cmd small

# 3. Start services (interactive mode)
start_with_output.ps1

# Alternative: Use clean_start_backend.cmd
clean_start_backend.cmd

```

**What happens during build:**
- Git submodules are updated (`whisper.cpp`)
- Custom server files are copied from `whisper-custom/server/`
- whisper.cpp is compiled using CMake and Visual Studio
- Python virtual environment is created in `venv/`
- Dependencies are installed from `requirements.txt`
- Whisper model is downloaded (e.g., `ggml-small.bin` ~244MB)
- `whisper-server-package/` is created with all necessary files

#### macOS

**Prerequisites:**
- Xcode Command Line Tools: `xcode-select --install`
- Homebrew: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
- Python 3.8+: `brew install python3`
- Dependencies: `brew install cmake llvm libomp`

**Build Process:**
```bash
# 1. Navigate to backend directory
cd backend

# 2. Build whisper.cpp and setup environment
./build_whisper.sh small

# 3. Start services (interactive mode)
./clean_start_backend.sh
```

**macOS-Specific Optimizations:**
- Uses `libomp` for OpenMP acceleration
- LLVM compiler optimizations for Apple Silicon
- Automatic detection of M1/M2 vs Intel architecture
- Optimized thread allocation for Apple Silicon cores

### Service URLs and Endpoints

After successful startup, services are available at:

- **Whisper Server**: http://localhost:8178
  - Health check: `GET /`
  - Transcription: `POST /inference`
  - WebSocket: `ws://localhost:8178/`

- **Meeting App**: http://localhost:5167
  - API docs: http://localhost:5167/docs
  - Health check: `GET /get-meetings`
  - WebSocket: `ws://localhost:5167/ws`

### Troubleshooting Common Issues

#### Native Build Issues
```bash
# Windows: CMake not found
# Solution: Install Visual Studio Build Tools

# macOS: Compilation errors
brew install cmake llvm libomp
export CC=/opt/homebrew/bin/clang
export CXX=/opt/homebrew/bin/clang++

# Python dependency issues
python -m pip install --upgrade pip
pip install -r requirements.txt --force-reinstall
```

## Native Development Scripts (.cmd, .sh)

### Core Build Scripts

#### `build_whisper.cmd` / `build_whisper.sh`
**Purpose**: Primary build script that compiles whisper.cpp, sets up Python environment, and creates the whisper-server package.

**Key Features**:
- Updates git submodules for whisper.cpp
- Copies custom server files from `whisper-custom/server/`
- Compiles whisper.cpp with CMake (Windows) or make (Unix)
- Creates whisper-server-package with executable and models
- Sets up Python virtual environment and installs dependencies
- Supports interactive model selection

**Usage**:
```bash
# With specific model
./build_whisper.sh small

# Interactive mode (prompts for model)
./build_whisper.sh
```

**Options**:
- `MODEL_NAME`: First argument specifies whisper model to download (tiny, base, small, medium, large-v1, large-v2, large-v3, etc.)
- Auto-downloads models if not present
- Creates executable run scripts in the package

#### `clean_start_backend.cmd` / `clean_start_backend.sh`
**Purpose**: Complete environment cleanup and service startup script that ensures clean state before launching.

**Key Features**:
- Kills existing whisper-server and Python backend processes
- Validates all required directories and files exist
- Interactive model selection with fallback downloading
- Port configuration and conflict resolution
- Starts both whisper server and Python backend
- Comprehensive error handling and logging

**Usage**:
```bash
# With specific model
./clean_start_backend.sh large-v3

# Interactive mode
./clean_start_backend.sh
```

**Options**:
- `MODEL_NAME`: First argument for model selection
- Interactive prompts for model, language, and port selection
- Automatic port conflict detection and resolution
- Process cleanup with user confirmation

#### `start_python_backend.cmd`
**Purpose**: Standalone Python backend launcher for Windows.

**Features**:
- Activates virtual environment
- Validates FastAPI installation
- Configurable port (default: 5167)
- Error checking for all dependencies

**Usage**:
```cmd
start_python_backend.cmd [PORT]
```

#### `start_whisper_server.cmd`
**Purpose**: Standalone whisper server launcher for Windows.

**Features**:
- Validates whisper-server-package structure
- Model validation and listing
- Configurable model selection
- Host and port configuration

**Usage**:
```cmd
start_whisper_server.cmd [MODEL_NAME]
```

### Model Management Scripts

#### `download-ggml-model.cmd` / `download-ggml-model.sh`
**Purpose**: Downloads pre-converted whisper models from HuggingFace.

**Features**:
- Comprehensive model catalog (39 different models)
- Multiple model sizes: tiny (~39MB) to large-v3-turbo (~1550MB)
- Quantized variants (q5_1, q8_0) for smaller file sizes
- Special tdrz models for speaker diarization
- Automatic source URL switching based on model type
- PowerShell BITS transfer (Windows) or curl/wget (Unix)

**Usage**:
```bash
# Download specific model
./download-ggml-model.sh base.en

# View available models
./download-ggml-model.sh
```

**Available Models**:
- **tiny series**: tiny, tiny.en, tiny-q5_1, tiny.en-q5_1, tiny-q8_0
- **base series**: base, base.en, base-q5_1, base.en-q5_1, base-q8_0
- **small series**: small, small.en, small-q5_1, small.en-q5_1, small-q8_0, small.en-tdrz
- **medium series**: medium, medium.en, medium-q5_0, medium.en-q5_0, medium-q8_0
- **large series**: large-v1, large-v2, large-v3, large-v3-turbo (with quantized variants)

## Script Interactions and Dependencies

### Build Process Flow

1. **`build_whisper.sh/.cmd`** →
   - Initializes git submodules
   - Copies custom server files
   - Compiles whisper.cpp
   - Calls **`download-ggml-model.sh/.cmd`** for model acquisition
   - Sets up Python virtual environment
   - Creates whisper-server-package

2. **`clean_start_backend.sh/.cmd`** →
   - Validates build output from step 1
   - Manages process cleanup
   - Calls **`download-ggml-model.sh/.cmd`** if models missing
   - Starts both whisper server and Python backend

### Preference and State Management

#### State Validation Chain
1. **Environment Check**: Validates required directories and files
2. **Process Check**: Identifies and handles conflicting processes
3. **Model Check**: Ensures models are available or downloadable
4. **Port Check**: Validates port availability and resolves conflicts
5. **Service Check**: Monitors startup and health status

## Platform-Specific Considerations

### Windows (.cmd, .ps1)
- **Process Management**: Uses `tasklist`, `taskkill` for process control
- **Port Detection**: `netstat -ano` for port monitoring
- **PowerShell Features**: Rich UI, BITS transfer, advanced error handling
- **Batch File Limitations**: Simple syntax, limited error handling

### Unix/Linux/macOS (.sh)
- **Process Management**: Uses `ps`, `kill`, `pkill` for process control
- **Port Detection**: `lsof`, `netstat` for port monitoring
- **Signal Handling**: Proper SIGTERM/SIGINT handling for graceful shutdown
- **Permission Management**: Executable permissions, file ownership

## Error Handling and Recovery

### Graceful Degradation
1. **Missing Models**: Auto-download → Local copy → Fallback model → Error
2. **GPU Unavailable**: GPU requested → CPU fallback → Warning notification
3. **Port Conflicts**: Kill existing → Alternative port → User prompt → Error
4. **Build Failures**: Detailed diagnostics → Cleanup → Recovery suggestions

### Logging and Diagnostics
- **Structured Logging**: Color-coded output with severity levels
- **Progress Tracking**: Real-time feedback for long operations
- **Health Checks**: Service connectivity and readiness validation
- **Debug Mode**: Verbose logging for troubleshooting

### User Guidance
- **Error Messages**: Specific, actionable error descriptions
- **Recovery Steps**: Clear instructions for problem resolution
- **Alternative Approaches**: Multiple deployment options for different scenarios
- **Documentation**: Inline help and comprehensive documentation

## Usage Recommendations

### For Development
1. Use **native scripts** (`build_whisper.sh`, `clean_start_backend.sh`) for fastest iteration
2. Enable debug mode for troubleshooting
3. Use interactive modes for configuration discovery

### For Production
1. Use **native scripts** with pre-downloaded models
2. Pre-download models to avoid startup delays
3. Use service managers (systemd, PM2) for automatic restarts

### For Distribution
1. Use packaged releases with all dependencies
2. Include model management in deployment process
3. Provide database migration path for existing users

This documentation provides comprehensive coverage of all script functionality, interactions, and usage patterns for the Meeting Minutes backend system.