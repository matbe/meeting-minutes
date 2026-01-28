use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;
use anyhow::Result;

/// Storage preferences for database and models directories
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StoragePreferences {
    /// Custom database directory path (optional)
    #[serde(default)]
    pub database_path: Option<PathBuf>,
    
    /// Custom models directory path (optional)
    #[serde(default)]
    pub models_path: Option<PathBuf>,
}

impl Default for StoragePreferences {
    fn default() -> Self {
        Self {
            database_path: None,
            models_path: None,
        }
    }
}

/// Load storage preferences from store
pub async fn load_storage_preferences<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<StoragePreferences> {
    // Try to load from Tauri store
    let store = match app.store("storage_preferences.json") {
        Ok(store) => store,
        Err(e) => {
            warn!("Failed to access store: {}, using defaults", e);
            return Ok(StoragePreferences::default());
        }
    };

    // Try to get the preferences from store
    let prefs = if let Some(value) = store.get("preferences") {
        match serde_json::from_value::<StoragePreferences>(value.clone()) {
            Ok(p) => {
                info!("Loaded storage preferences from store: database_path={:?}, models_path={:?}",
                      p.database_path, p.models_path);
                p
            }
            Err(e) => {
                warn!("Failed to deserialize preferences: {}, using defaults", e);
                StoragePreferences::default()
            }
        }
    } else {
        info!("No stored preferences found, using defaults");
        StoragePreferences::default()
    };

    Ok(prefs)
}

/// Save storage preferences to store
pub async fn save_storage_preferences<R: Runtime>(
    app: &AppHandle<R>,
    preferences: &StoragePreferences,
) -> Result<()> {
    info!("Saving storage preferences: database_path={:?}, models_path={:?}",
          preferences.database_path, preferences.models_path);

    // Get or create store
    let store = app
        .store("storage_preferences.json")
        .map_err(|e| anyhow::anyhow!("Failed to access store: {}", e))?;

    // Serialize preferences to JSON value
    let prefs_value = serde_json::to_value(preferences)
        .map_err(|e| anyhow::anyhow!("Failed to serialize preferences: {}", e))?;

    // Save to store
    store.set("preferences", prefs_value);

    // Persist to disk
    store
        .save()
        .map_err(|e| anyhow::anyhow!("Failed to save store to disk: {}", e))?;

    info!("Successfully persisted storage preferences to disk");

    Ok(())
}

/// Get the effective database directory (custom or default)
pub async fn get_database_directory_path<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<PathBuf> {
    let prefs = load_storage_preferences(app).await?;
    
    if let Some(custom_path) = prefs.database_path {
        info!("Using custom database path: {:?}", custom_path);
        Ok(custom_path)
    } else {
        // Use default app data directory
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| anyhow::anyhow!("Failed to get app data dir: {}", e))?;
        info!("Using default database path: {:?}", app_data_dir);
        Ok(app_data_dir)
    }
}

/// Get the effective models directory (custom or default)
pub async fn get_models_directory_path<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<PathBuf> {
    let prefs = load_storage_preferences(app).await?;
    
    if let Some(custom_path) = prefs.models_path {
        info!("Using custom models path: {:?}", custom_path);
        Ok(custom_path)
    } else {
        // Use default app data directory + models
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| anyhow::anyhow!("Failed to get app data dir: {}", e))?;
        let models_dir = app_data_dir.join("models");
        info!("Using default models path: {:?}", models_dir);
        Ok(models_dir)
    }
}

/// Tauri commands for storage preferences
#[tauri::command]
pub async fn get_storage_preferences<R: Runtime>(
    app: AppHandle<R>,
) -> Result<StoragePreferences, String> {
    load_storage_preferences(&app)
        .await
        .map_err(|e| format!("Failed to load storage preferences: {}", e))
}

#[tauri::command]
pub async fn set_storage_preferences<R: Runtime>(
    app: AppHandle<R>,
    preferences: StoragePreferences,
) -> Result<(), String> {
    save_storage_preferences(&app, &preferences)
        .await
        .map_err(|e| format!("Failed to save storage preferences: {}", e))
}

#[tauri::command]
pub async fn set_database_path<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    
    // Validate path and create if necessary
    if path_buf.exists() && !path_buf.is_dir() {
        return Err("Selected path is not a directory".to_string());
    }
    
    if !path_buf.exists() {
        std::fs::create_dir_all(&path_buf)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    // Load current preferences
    let mut prefs = load_storage_preferences(&app)
        .await
        .map_err(|e| format!("Failed to load preferences: {}", e))?;
    
    // Update database path
    prefs.database_path = Some(path_buf);
    
    // Save preferences
    save_storage_preferences(&app, &prefs)
        .await
        .map_err(|e| format!("Failed to save preferences: {}", e))?;
    
    info!("Database path updated to: {}", path);
    Ok(())
}

#[tauri::command]
pub async fn set_models_path<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    
    // Validate path and create if necessary
    if path_buf.exists() && !path_buf.is_dir() {
        return Err("Selected path is not a directory".to_string());
    }
    
    if !path_buf.exists() {
        std::fs::create_dir_all(&path_buf)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    // Load current preferences
    let mut prefs = load_storage_preferences(&app)
        .await
        .map_err(|e| format!("Failed to load preferences: {}", e))?;
    
    // Update models path
    prefs.models_path = Some(path_buf);
    
    // Save preferences
    save_storage_preferences(&app, &prefs)
        .await
        .map_err(|e| format!("Failed to save preferences: {}", e))?;
    
    info!("Models path updated to: {}", path);
    Ok(())
}
