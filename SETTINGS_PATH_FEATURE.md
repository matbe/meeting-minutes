# Settings Storage Path Feature

## Overview
This feature allows users to customize where Meetily stores different types of data through the Settings UI.

## UI Changes

### Settings → General Tab

The "Data Storage Locations" section now displays all three storage types:

```
┌─────────────────────────────────────────────────────────────┐
│  Data Storage Locations                                      │
│  View and change where Meetily stores your data              │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Database                                              │   │
│  │ /Users/username/Library/Application Support/Meetily  │   │
│  │ [Open Folder]  [Change Path]                         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Whisper Models                                        │   │
│  │ /Users/username/Library/Application Support/         │   │
│  │   Meetily/models                                      │   │
│  │ [Open Folder]  [Change Path]                         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Meeting Recordings                                    │   │
│  │ /Users/username/Movies/meetily-recordings            │   │
│  │ [Open Folder]  [Change Path]                         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ⚠️ Note: Changing storage paths will require restarting   │
│  the application. Existing data will not be automatically   │
│  moved to the new location.                                 │
└─────────────────────────────────────────────────────────────┘
```

## Button Behaviors

### "Open Folder" Button
- Opens the current storage location in the system file explorer
- Works for all three storage types
- Creates directory if it doesn't exist

### "Change Path" Button
- Opens a native folder selection dialog
- Validates selected path
- Different behavior for each storage type:

#### Recordings
- ✅ Changes take effect immediately
- ✅ New recordings saved to new location
- Alert: "Recording path updated successfully to: [path]. New recordings will be saved to this location."

#### Database
- ⚠️ Requires application restart
- Alert: "Database path updated successfully to: [path]. Please restart the application for this change to take effect. Note: Your existing database files will remain in the old location and must be manually moved if you want to use them."

#### Models
- ⚠️ Requires application restart  
- Alert: "Models path updated successfully to: [path]. Please restart the application for this change to take effect. Note: Your existing model files will remain in the old location and must be manually moved if you want to use them."

## Technical Implementation

### Frontend (TypeScript)
- **Component**: `frontend/src/components/PreferenceSettings.tsx`
- **Functions**:
  - `handleOpenFolder(folderType)` - Opens folder in system explorer
  - `handleChangeFolder(folderType)` - Handles path change with proper validation and feedback

### Backend (Rust)

#### Commands
1. **Folder Selection**:
   - `select_recording_folder()` - Recording folder picker
   - `select_database_folder()` - Database folder picker
   - `select_models_folder()` - Models folder picker

2. **Path Management**:
   - `get_storage_preferences()` - Get custom paths
   - `set_storage_preferences()` - Set custom paths
   - `set_database_path(path)` - Set database path
   - `set_models_path(path)` - Set models path

3. **Path Retrieval** (Updated to respect custom paths):
   - `get_database_directory()` - Returns custom or default database path
   - `whisper_get_models_directory()` - Returns custom or default models path
   - `get_default_recordings_folder_path()` - Returns custom or default recordings path

#### Storage
- **File**: `storage_preferences.json` (Tauri store)
- **Location**: Application data directory
- **Format**:
```json
{
  "preferences": {
    "database_path": "/custom/path/to/database",
    "models_path": "/custom/path/to/models"
  }
}
```

## User Workflow

### Changing Recording Path
1. Navigate to Settings → General
2. Find "Meeting Recordings" section
3. Click "Change Path"
4. Select new folder in dialog
5. ✅ Immediate: New recordings use new path

### Changing Database/Models Path
1. Navigate to Settings → General
2. Find "Database" or "Whisper Models" section
3. Click "Change Path"
4. Select new folder in dialog
5. See restart notification
6. **Manually move existing files** (if needed)
7. Restart application
8. ✅ Application uses new path

## Analytics Tracking

The following events are tracked:
- `storage_folder_opened` - When "Open Folder" is clicked
- `storage_path_changed` - When path is successfully changed

Both events include `folder_type` parameter: `'database'`, `'models'`, or `'recordings'`

## Edge Cases Handled

1. **Directory doesn't exist**: Automatically created
2. **Invalid path**: User notified with error message
3. **User cancels dialog**: No changes made
4. **Path already in use**: Allowed (user responsibility)
5. **No custom path set**: Defaults to standard locations
6. **Preferences file missing**: Uses defaults

## Platform-Specific Defaults

### macOS
- **Database**: `~/Library/Application Support/Meetily`
- **Models**: `~/Library/Application Support/Meetily/models`
- **Recordings**: `~/Movies/meetily-recordings`

### Windows
- **Database**: `%APPDATA%\Meetily`
- **Models**: `%APPDATA%\Meetily\models`
- **Recordings**: `%USERPROFILE%\Music\meetily-recordings`

### Linux
- **Database**: `~/.local/share/Meetily`
- **Models**: `~/.local/share/Meetily/models`
- **Recordings**: `~/Documents/meetily-recordings`

## Known Limitations

1. **No automatic data migration**: Users must manually move existing data
2. **Restart required**: Database and models path changes need restart
3. **No validation of existing data**: App doesn't check if data exists in new location
4. **Single path per type**: Can't have multiple recordings locations

## Future Enhancements (Out of Scope)

- [ ] Automatic data migration wizard
- [ ] Path validation with existing data check
- [ ] Multiple recordings locations
- [ ] Cloud storage integration
- [ ] Symbolic link detection and handling
