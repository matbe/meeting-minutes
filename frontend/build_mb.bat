@echo off
REM Meetily Build Script - CPU-only portable build by default
REM GPU builds available as explicit opt-in (gpu, cuda, vulkan)

setlocal enabledelayedexpansion

if "%~1" == "debug" (
    set "DEBUG=true"
) else if "%~1" == "check" (
    set "CHECK=true"
) else if "%~1" == "gpu" (
    set "GPU_AUTO=true"
) else if "%~1" == "cuda" (
    set "GPU_CUDA=true"
) else if "%~1" == "vulkan" (
    set "GPU_VULKAN=true"
) else if "%~1" == "help" (
    call :_print_help
    exit /b 0
) else if "%~1" == "--help" (
    call :_print_help
    exit /b 0
) else if "%~1" == "-h" (
    call :_print_help
    exit /b 0
) else if "%~1" == "/?" (
    call :_print_help
    exit /b 0
) else (
    set "DEBUG=false"
)

echo Building Meetily application...

REM Kill any existing processes on port 3118
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3118 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)

set "LIBCLANG_PATH=C:\Program Files\LLVM\bin"

if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
) else if exist "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat" (
    set "LIBCLANG_PATH=C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Tools\Llvm\x64\lib"
    call "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
) else if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" (
    call "C:\Program Files (x86)\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
) else if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat" (
    call "C:\Program Files (x86)\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
) else if exist "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    call "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
)

echo Environment setup complete.

if "!DEBUG!" == "true" (
    echo Starting development mode ^(CPU-only, portable^)...
    call pnpm run tauri:dev:cpu
    exit /b !errorlevel!
)

if "!CHECK!" == "true" (
    echo Running cargo check ^(CPU-only^)...
    cd src-tauri
    cargo check --no-default-features
    if !errorlevel! neq 0 exit /b 1
    cd ..
    exit /b 0
)

if "!GPU_AUTO!" == "true" (
    echo Building with AUTO-DETECTED GPU support...
    echo WARNING: This binary will ONLY run on machines with the same GPU libraries installed!
    call pnpm run tauri:build
    goto :build_done
)

if "!GPU_CUDA!" == "true" (
    echo Building with NVIDIA CUDA support...
    echo WARNING: This binary will REQUIRE cublas DLLs on the target machine!
    REM Set CUDA arch (CUDA 12+ minimum: 75=Turing, 80/86=Ampere, 89=Ada, 90=Hopper, 100/120=Blackwell/5090)
    set "CMAKE_CUDA_ARCHITECTURES=75;80;86;89;90;100;120"
    set "CUDAARCHS=75;80;86;89;90;100;120"
    set "CMAKE_CUDA_STANDARD=17"
    set "CMAKE_CXX_STANDARD=17"
    set "CUDAFLAGS=-std=c++17
    call pnpm run tauri:build:cuda
    goto :build_done
)

if "!GPU_VULKAN!" == "true" (
    echo Building with Vulkan GPU support...
    echo WARNING: This binary will REQUIRE Vulkan runtime on the target machine!
    call pnpm run tauri:build:vulkan
    goto :build_done
)

echo Building PORTABLE binary ^(CPU-only - works on ANY machine^)...
call pnpm run tauri:build:cpu

:build_done

if !errorlevel! neq 0 (
    echo Error: Build failed
    exit /b 1
)

echo.
echo Build completed!

if "!GPU_AUTO!" == "true" (
    echo NOTE: This is a GPU-accelerated binary. It requires matching GPU libraries on the target machine.
) else if "!GPU_CUDA!" == "true" (
    echo NOTE: This is a CUDA binary. It requires NVIDIA CUDA libraries ^(cublas64_xx.dll^) on the target machine.
) else if "!GPU_VULKAN!" == "true" (
    echo NOTE: This is a Vulkan binary. It requires Vulkan runtime on the target machine.
) else (
    echo This is a PORTABLE binary - runs on ANY machine ^(CPU processing, no GPU dependencies^).
)
exit /b 0

:_print_help
echo Meetily Build Script - Portable CPU build with optional GPU variants
echo Usage: build_mb.bat [debug^|check^|gpu^|cuda^|vulkan^|help]
echo.
echo OPTIONS:
echo   ^(none^)    Build PORTABLE binary ^(CPU-only, works on ANY machine^)
echo   debug     Start development with Tauri serving ^(CPU-only^)
echo   check     Verify code compiles
echo   gpu       Build with auto-detected GPU ^(NOT portable^)
echo   cuda      Build with NVIDIA CUDA ^(requires CUDA on target^)
echo   vulkan    Build with Vulkan GPU ^(requires Vulkan on target^)
echo   help      Show this message
echo.
echo IMPORTANT: GPU builds create binaries that ONLY work on machines
echo with the corresponding GPU libraries installed.
echo The default build ^(no arguments^) creates a portable CPU binary.
exit /b 0