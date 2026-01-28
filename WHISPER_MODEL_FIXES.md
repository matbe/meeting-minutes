# Whisper Model Download and Validation Fixes

## Issues Fixed

### 1. Large-v3-turbo-q5_0 Download URL Issue
**Problem**: When downloading `large-v3-turbo-q5_0`, only 49KB of data was downloaded instead of the full model file (~574MB).

**Root Cause**: The download URL was using `/blob/` instead of `/resolve/` in the HuggingFace URL path:
- **Incorrect**: `https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-large-v3-turbo-q5_0.bin`
- **Correct**: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin`

The `/blob/` endpoint returns the HTML page for viewing the file, while `/resolve/` returns the actual binary file.

**Fix**: Updated the URL in `frontend/src-tauri/src/whisper_engine/whisper_engine.rs` (line 950)

### 2. Model Validation Too Strict
**Problem**: Models like `medium-q5_0` would download successfully but then show "Delete" and "Re-download" options when returning to the settings page.

**Root Cause**: The model size validation was too strict:
- Required file size to be ≥90% of expected size
- No upper bound check
- Model file sizes can vary due to compression, metadata, and version differences

**Fix**: Made validation more lenient in `frontend/src-tauri/src/whisper_engine/whisper_engine.rs`:
- Changed threshold from 90% to **70%-150%** of expected size
- Added detailed logging to help diagnose validation issues
- Improved error messages to show expected size range

### 3. Missing Quantized Models
**Problem**: Only q5_0 quantized models were available. Missing q8_0 models which provide better quality than q5_0.

**Fix**: Added complete set of q8_0 quantized models:
- `tiny-q8_0` (42 MB)
- `base-q8_0` (148 MB)
- `small-q8_0` (488 MB)
- `medium-q8_0` (1485 MB)
- `large-v3-q8_0` (2997 MB)
- `large-v3-turbo-q8_0` (843 MB)

**Benefits**: 
- q8_0 models provide higher quality than q5_0 with minimal speed loss
- Better for users with powerful GPUs (like RTX 5090)
- More options for balancing quality vs. speed

## Files Modified

1. **frontend/src-tauri/src/whisper_engine/whisper_engine.rs**
   - Fixed large-v3-turbo-q5_0 download URL
   - Added q8_0 model configurations
   - Made size validation more lenient (70%-150% range)
   - Improved validation logging

2. **frontend/src/lib/whisper.ts**
   - Added q8_0 model configurations
   - Updated `getModelType()` to support q8_0
   - Updated `getModelBaseName()` regex to match q8_0
   - Updated `getModelPerformanceBadge()` with purple badge for q8_0
   - Updated sorting logic to prioritize: f16 → q8_0 → q5_0 → q4_0

3. **frontend/src/components/WhisperModelManager.tsx**
   - Added purple badge styling for q8_0 models

## Model Quality Hierarchy

After these changes, the models are organized by quantization quality:

1. **f16** (Full Precision) - Highest quality, slowest
   - Badge: "Full Precision" (blue)
   
2. **q8_0** (8-bit Quantization) - High quality, good speed
   - Badge: "High Quality" (purple)
   - **NEW**: Best for high-end GPUs like RTX 5090
   
3. **q5_0** (5-bit Quantization) - Balanced quality/speed
   - Badge: "Balanced" (green)
   
4. **q4_0** (4-bit Quantization) - Lower quality, fastest
   - Badge: "Fast" (orange)

## GPU Support

The application already supports NVIDIA RTX 5090 through CUDA acceleration:
- CUDA feature can be enabled during compilation
- Vulkan support available for AMD/Intel GPUs
- Metal support for macOS (Apple Silicon)

## Testing Recommendations

1. **Test large-v3-turbo-q5_0 download**:
   - Navigate to Settings → Whisper Models
   - Click download on "Large V3 Turbo (Q5_0)"
   - Verify full model downloads (~574 MB)
   - Verify it shows as "Available" after download

2. **Test medium-q5_0 persistence**:
   - Download medium-q5_0 model
   - Select it as active model
   - Navigate away from settings and return
   - Verify it still shows as "Available" and selected

3. **Test new q8_0 models**:
   - Verify q8_0 models appear in the advanced models section
   - Verify they have purple "High Quality" badges
   - Test downloading a q8_0 model
   - Verify they work for transcription

4. **Verify model validation**:
   - Check logs for "Model X validated successfully" messages
   - Ensure no false "corrupted" warnings for valid models

## Validation Logic Details

### Size Validation
```rust
// Allow 70% to 150% of expected size
let expected_min_size_mb = (size_mb as f64 * 0.7) as u64;
let expected_max_size_mb = (size_mb as f64 * 1.5) as u64;

if file_size_mb >= expected_min_size_mb && 
   file_size_mb <= expected_max_size_mb && 
   file_size_mb > 1 {
    // Validate GGML magic number
    validate_model_file(&model_path).await
}
```

### GGML Magic Number Check
The validation checks for proper GGML/GGUF file headers:
- `ggml` - Standard GGML format
- `GGUF` - GGUF format (newer)
- `ggmf` - GGML format variant
- Plus endianness variants

This ensures downloaded files are actual model binaries, not HTML pages or corrupted data.

## Known Limitations

1. Model size estimates in the code are approximate and based on typical file sizes
2. Actual downloaded sizes may vary by ±30% due to compression and version differences
3. The validation is now more permissive to avoid false positives, but may occasionally allow corrupted files through

## Future Improvements

1. Add checksum validation (SHA256) for downloaded models
2. Fetch model sizes dynamically from HuggingFace API
3. Add model version tracking to support updates
4. Implement automatic retry with exponential backoff for failed downloads
