#[path = "build/ffmpeg.rs"]
mod ffmpeg;

use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    prepare_template_resources();

    // GPU Acceleration Detection and Build Guidance
    detect_and_report_gpu_capabilities();

    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=Cocoa");
        println!("cargo:rustc-link-lib=framework=Foundation");

        // Let the enhanced_macos crate handle its own Swift compilation
        // The swift-rs crate build will be handled in the enhanced_macos crate's build.rs
    }

    // Download and bundle FFmpeg binary at build-time
    ffmpeg::ensure_ffmpeg_binary();

    tauri_build::build()
}

fn prepare_template_resources() {
    println!("cargo:rerun-if-changed=templates");
    println!("cargo:rerun-if-changed=templates-optional");

    let manifest_dir = match std::env::var("CARGO_MANIFEST_DIR") {
        Ok(value) => PathBuf::from(value),
        Err(err) => {
            println!(
                "cargo:warning=Could not read CARGO_MANIFEST_DIR for template merge: {}",
                err
            );
            return;
        }
    };

    let base_templates_dir = manifest_dir.join("templates");
    let optional_templates_dir = manifest_dir.join("templates-optional");
    let generated_templates_dir = manifest_dir.join("templates-generated");

    if generated_templates_dir.exists() {
        if let Err(err) = fs::remove_dir_all(&generated_templates_dir) {
            println!(
                "cargo:warning=Failed to clean templates-generated directory: {}",
                err
            );
            return;
        }
    }

    if let Err(err) = fs::create_dir_all(&generated_templates_dir) {
        println!(
            "cargo:warning=Failed to create templates-generated directory: {}",
            err
        );
        return;
    }

    let mut copied = 0usize;
    copied += copy_json_templates(&base_templates_dir, &generated_templates_dir);

    if optional_templates_dir.exists() {
        copied += copy_json_templates(&optional_templates_dir, &generated_templates_dir);
        println!(
            "cargo:warning=Merged optional templates from {}",
            optional_templates_dir.display()
        );
    } else {
        println!(
            "cargo:warning=Optional templates directory not found (skipping): {}",
            optional_templates_dir.display()
        );
    }

    println!(
        "cargo:warning=Prepared {} template resource file(s) in {}",
        copied,
        generated_templates_dir.display()
    );
}

fn copy_json_templates(source_dir: &Path, destination_dir: &Path) -> usize {
    if !source_dir.exists() {
        return 0;
    }

    let mut copied = 0usize;

    let entries = match fs::read_dir(source_dir) {
        Ok(entries) => entries,
        Err(err) => {
            println!(
                "cargo:warning=Failed to read templates directory {}: {}",
                source_dir.display(),
                err
            );
            return 0;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let is_json = path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("json"));

        if !is_json {
            continue;
        }

        let file_name = match path.file_name() {
            Some(name) => name,
            None => continue,
        };

        let destination_path = destination_dir.join(file_name);
        match fs::copy(&path, &destination_path) {
            Ok(_) => copied += 1,
            Err(err) => println!(
                "cargo:warning=Failed to copy template {} to {}: {}",
                path.display(),
                destination_path.display(),
                err
            ),
        }
    }

    copied
}

/// Detects GPU acceleration capabilities and provides build guidance
fn detect_and_report_gpu_capabilities() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

    println!("cargo:warning=🚀 Building Meetily for: {}", target_os);

    match target_os.as_str() {
        "macos" => {
            println!("cargo:warning=✅ macOS: Metal GPU acceleration ENABLED by default");
            #[cfg(feature = "coreml")]
            println!("cargo:warning=✅ CoreML acceleration ENABLED");
        }
        "windows" => {
            if cfg!(feature = "cuda") {
                println!("cargo:warning=✅ Windows: CUDA GPU acceleration ENABLED");
            } else if cfg!(feature = "vulkan") {
                println!("cargo:warning=✅ Windows: Vulkan GPU acceleration ENABLED");
            } else if cfg!(feature = "openblas") {
                println!("cargo:warning=✅ Windows: OpenBLAS CPU optimization ENABLED");
            } else {
                println!("cargo:warning=⚠️  Windows: Using CPU-only mode (no GPU or BLAS acceleration)");
                println!("cargo:warning=💡 For NVIDIA GPU: cargo build --release --features cuda");
                println!("cargo:warning=💡 For AMD/Intel GPU: cargo build --release --features vulkan");
                println!("cargo:warning=💡 For CPU optimization: cargo build --release --features openblas");

                // Try to detect NVIDIA GPU
                if which::which("nvidia-smi").is_ok() {
                    println!("cargo:warning=🎯 NVIDIA GPU detected! Consider rebuilding with --features cuda");
                }
            }
        }
        "linux" => {
            if cfg!(feature = "cuda") {
                println!("cargo:warning=✅ Linux: CUDA GPU acceleration ENABLED");
            } else if cfg!(feature = "vulkan") {
                println!("cargo:warning=✅ Linux: Vulkan GPU acceleration ENABLED");
            } else if cfg!(feature = "hipblas") {
                println!("cargo:warning=✅ Linux: AMD ROCm (HIP) acceleration ENABLED");
            } else if cfg!(feature = "openblas") {
                println!("cargo:warning=✅ Linux: OpenBLAS CPU optimization ENABLED");
            } else {
                println!("cargo:warning=⚠️  Linux: Using CPU-only mode (no GPU or BLAS acceleration)");
                println!("cargo:warning=💡 For NVIDIA GPU: cargo build --release --features cuda");
                println!("cargo:warning=💡 For AMD GPU: cargo build --release --features hipblas");
                println!("cargo:warning=💡 For other GPUs: cargo build --release --features vulkan");
                println!("cargo:warning=💡 For CPU optimization: cargo build --release --features openblas");

                // Try to detect NVIDIA GPU
                if which::which("nvidia-smi").is_ok() {
                    println!("cargo:warning=🎯 NVIDIA GPU detected! Consider rebuilding with --features cuda");
                }

                // Try to detect AMD GPU
                if which::which("rocm-smi").is_ok() {
                    println!("cargo:warning=🎯 AMD GPU detected! Consider rebuilding with --features hipblas");
                }
            }
        }
        _ => {
            println!("cargo:warning=ℹ️  Unknown platform: {}", target_os);
        }
    }

    // Performance guidance
    if !cfg!(feature = "cuda") && !cfg!(feature = "vulkan") && !cfg!(feature = "hipblas") && !cfg!(feature = "openblas") && target_os != "macos" {
        println!("cargo:warning=📊 Performance: CPU-only builds are significantly slower than GPU/BLAS builds");
        println!("cargo:warning=📚 See README.md for GPU/BLAS setup instructions");
    }
}
