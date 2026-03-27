"use client"

import { useEffect, useState, useRef } from "react"
import { Switch } from "./ui/switch"
import { FolderOpen } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import Analytics from "@/lib/analytics"
import AnalyticsConsentSwitch from "./AnalyticsConsentSwitch"
import { useConfig, NotificationSettings } from "@/contexts/ConfigContext"
import { usePlatform } from "@/hooks/usePlatform"

export function PreferenceSettings() {
  const {
    notificationSettings,
    storageLocations,
    isLoadingPreferences,
    loadPreferences,
    updateNotificationSettings,
    disableStartupCommunication,
    toggleDisableStartupCommunication
  } = useConfig();

  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [previousNotificationsEnabled, setPreviousNotificationsEnabled] = useState<boolean | null>(null);
  const hasTrackedViewRef = useRef(false);

  // Teams detection state (Windows only)
  const platform = usePlatform();
  const [teamsDetectionEnabled, setTeamsDetectionEnabled] = useState(false);
  const [teamsUseDetectedTitles, setTeamsUseDetectedTitles] = useState(true);

  // Load Teams detection preferences
  useEffect(() => {
    if (platform !== 'windows') return;
    let cancelled = false;
    const load = async () => {
      try {
        const { Store } = await import('@tauri-apps/plugin-store');
        const store = await Store.load('preferences.json');
        const enabled = (await store.get<boolean>('teams_detection_enabled')) ?? false;
        const useTitles = (await store.get<boolean>('teams_use_detected_titles')) ?? true;
        if (!cancelled) {
          setTeamsDetectionEnabled(enabled);
          setTeamsUseDetectedTitles(useTitles);
        }
      } catch (err) {
        console.error('Failed to load Teams detection prefs:', err);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [platform]);

  const handleTeamsDetectionToggle = async (enabled: boolean) => {
    setTeamsDetectionEnabled(enabled);
    try {
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('preferences.json');
      await store.set('teams_detection_enabled', enabled);
      await store.save();

      if (enabled) {
        await invoke('start_teams_detection');
      } else {
        await invoke('stop_teams_detection');
      }
      await Analytics.track('teams_detection_toggled', { enabled: enabled.toString() });
    } catch (err) {
      console.error('Failed to toggle Teams detection:', err);
      setTeamsDetectionEnabled(!enabled);
    }
  };

  const handleTeamsUseTitlesToggle = async (enabled: boolean) => {
    setTeamsUseDetectedTitles(enabled);
    try {
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('preferences.json');
      await store.set('teams_use_detected_titles', enabled);
      await store.save();
    } catch (err) {
      console.error('Failed to toggle Teams title preference:', err);
      setTeamsUseDetectedTitles(!enabled);
    }
  };

  // Lazy load preferences on mount (only loads if not already cached)
  useEffect(() => {
    loadPreferences();
    // Reset tracking ref on mount (every tab visit)
    hasTrackedViewRef.current = false;
  }, [loadPreferences]);

  // Track preferences viewed analytics on every tab visit (once per mount)
  useEffect(() => {
    if (hasTrackedViewRef.current) return;

    const trackPreferencesViewed = async () => {
      // Wait for notification settings to be available (either from cache or after loading)
      if (notificationSettings) {
        await Analytics.track('preferences_viewed', {
          notifications_enabled: notificationSettings.notification_preferences.show_recording_started ? 'true' : 'false'
        });
        hasTrackedViewRef.current = true;
      } else if (!isLoadingPreferences) {
        // If not loading and no settings available, track with default value
        await Analytics.track('preferences_viewed', {
          notifications_enabled: 'false'
        });
        hasTrackedViewRef.current = true;
      }
    };

    trackPreferencesViewed();
  }, [notificationSettings, isLoadingPreferences]);

  // Update notificationsEnabled when notificationSettings are loaded from global state
  useEffect(() => {
    if (notificationSettings) {
      // Notification enabled means both started and stopped notifications are enabled
      const enabled =
        notificationSettings.notification_preferences.show_recording_started &&
        notificationSettings.notification_preferences.show_recording_stopped;
      setNotificationsEnabled(enabled);
      if (isInitialLoad) {
        setPreviousNotificationsEnabled(enabled);
        setIsInitialLoad(false);
      }
    } else if (!isLoadingPreferences) {
      // If not loading and no settings, use default
      setNotificationsEnabled(true);
      if (isInitialLoad) {
        setPreviousNotificationsEnabled(true);
        setIsInitialLoad(false);
      }
    }
  }, [notificationSettings, isLoadingPreferences, isInitialLoad])

  useEffect(() => {
    // Skip update on initial load or if value hasn't actually changed
    if (isInitialLoad || notificationsEnabled === null || notificationsEnabled === previousNotificationsEnabled) return;
    if (!notificationSettings) return;

    const handleUpdateNotificationSettings = async () => {
      console.log("Updating notification settings to:", notificationsEnabled);

      try {
        // Update the notification preferences
        const updatedSettings: NotificationSettings = {
          ...notificationSettings,
          notification_preferences: {
            ...notificationSettings.notification_preferences,
            show_recording_started: notificationsEnabled,
            show_recording_stopped: notificationsEnabled,
          }
        };

        console.log("Calling updateNotificationSettings with:", updatedSettings);
        await updateNotificationSettings(updatedSettings);
        setPreviousNotificationsEnabled(notificationsEnabled);
        console.log("Successfully updated notification settings to:", notificationsEnabled);

        // Track notification preference change - only fires when user manually toggles
        await Analytics.track('notification_settings_changed', {
          notifications_enabled: notificationsEnabled.toString()
        });
      } catch (error) {
        console.error('Failed to update notification settings:', error);
      }
    };

    handleUpdateNotificationSettings();
  }, [notificationsEnabled, notificationSettings, isInitialLoad, previousNotificationsEnabled, updateNotificationSettings])

  const handleOpenFolder = async (folderType: 'database' | 'models' | 'recordings') => {
    try {
      switch (folderType) {
        case 'database':
          await invoke('open_database_folder');
          break;
        case 'models':
          await invoke('open_models_folder');
          break;
        case 'recordings':
          await invoke('open_recordings_folder');
          break;
      }

      // Track storage folder access
      await Analytics.track('storage_folder_opened', {
        folder_type: folderType
      });
    } catch (error) {
      console.error(`Failed to open ${folderType} folder:`, error);
    }
  };

  const handleChangeFolder = async (folderType: 'database' | 'models' | 'recordings') => {
    try {
      let selectedPath: string | null = null;

      switch (folderType) {
        case 'database':
          selectedPath = await invoke<string | null>('select_database_folder');
          break;
        case 'models':
          selectedPath = await invoke<string | null>('select_models_folder');
          break;
        case 'recordings':
          selectedPath = await invoke<string | null>('select_recording_folder');
          break;
      }

      if (selectedPath) {
        console.log(`Selected new ${folderType} path:`, selectedPath);

        // For recordings, update the preferences
        if (folderType === 'recordings') {
          try {
            const currentPrefs = await invoke('get_recording_preferences') as any;
            const updatedPrefs = {
              ...currentPrefs,
              save_folder: selectedPath
            };
            await invoke('set_recording_preferences', { preferences: updatedPrefs });
            
            // Reload preferences to update UI
            await loadPreferences();

            // Track path change
            await Analytics.track('storage_path_changed', {
              folder_type: folderType
            });

            alert(`Recording path updated successfully to:\n${selectedPath}\n\nNew recordings will be saved to this location.`);
          } catch (error) {
            console.error('Failed to update recording preferences:', error);
            alert('Failed to update recording path. Please try again.');
          }
        } else if (folderType === 'database') {
          // For database, use the new command
          try {
            await invoke('set_database_path', { path: selectedPath });
            
            // Reload preferences to update UI
            await loadPreferences();

            // Track path change
            await Analytics.track('storage_path_changed', {
              folder_type: folderType
            });

            alert(`Database path updated successfully to:\n${selectedPath}\n\nPlease restart the application for this change to take effect.\n\nNote: Existing database files will not be automatically moved. You may need to manually copy them to the new location.`);
          } catch (error) {
            console.error('Failed to update database path:', error);
            alert('Failed to update database path. Please try again.');
          }
        } else if (folderType === 'models') {
          // For models, use the new command
          try {
            await invoke('set_models_path', { path: selectedPath });
            
            // Reload preferences to update UI
            await loadPreferences();

            // Track path change
            await Analytics.track('storage_path_changed', {
              folder_type: folderType
            });

            alert(`Models path updated successfully to:\n${selectedPath}\n\nPlease restart the application for this change to take effect.\n\nNote: Existing model files will not be automatically moved. You may need to manually copy them to the new location.`);
          } catch (error) {
            console.error('Failed to update models path:', error);
            alert('Failed to update models path. Please try again.');
          }
        }
      } else {
        console.log('User cancelled folder selection');
      }
    } catch (error) {
      console.error(`Failed to change ${folderType} folder:`, error);
      alert(`Failed to change ${folderType} path. Please try again.`);
    }
  };

  // Show loading only if we're actually loading and don't have cached data
  if (isLoadingPreferences && !notificationSettings && !storageLocations) {
    return <div className="max-w-2xl mx-auto p-6">Loading Preferences...</div>
  }

  // Show loading if notificationsEnabled hasn't been determined yet
  if (notificationsEnabled === null && !isLoadingPreferences) {
    return <div className="max-w-2xl mx-auto p-6">Loading Preferences...</div>
  }

  // Ensure we have a boolean value for the Switch component
  const notificationsEnabledValue = notificationsEnabled ?? false;

  return (
    <div className="space-y-6">
      {/* Notifications Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Notifications</h3>
            <p className="text-sm text-gray-600">Enable or disable notifications of start and end of meeting</p>
          </div>
          <Switch checked={notificationsEnabledValue} onCheckedChange={setNotificationsEnabled} />
        </div>
      </div>

      {/* Data Storage Locations Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Data Storage Locations</h3>
        <p className="text-sm text-gray-600 mb-6">
          View and change where Meetily stores your data
        </p>

        <div className="space-y-4">
          {/* Database Location */}
          <div className="p-4 border rounded-lg bg-gray-50">
            <div className="font-medium mb-2">Database</div>
            <div className="text-sm text-gray-600 mb-3 break-all font-mono text-xs">
              {storageLocations?.database || 'Loading...'}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleOpenFolder('database')}
                className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 transition-colors"
              >
                <FolderOpen className="w-4 h-4" />
                Open Folder
              </button>
              <button
                onClick={() => handleChangeFolder('database')}
                className="px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Change Path
              </button>
            </div>
          </div>

          {/* Models Location */}
          <div className="p-4 border rounded-lg bg-gray-50">
            <div className="font-medium mb-2">Whisper Models</div>
            <div className="text-sm text-gray-600 mb-3 break-all font-mono text-xs">
              {storageLocations?.models || 'Loading...'}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleOpenFolder('models')}
                className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 transition-colors"
              >
                <FolderOpen className="w-4 h-4" />
                Open Folder
              </button>
              <button
                onClick={() => handleChangeFolder('models')}
                className="px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Change Path
              </button>
            </div>
          </div>

          {/* Recordings Location */}
          <div className="p-4 border rounded-lg bg-gray-50">
            <div className="font-medium mb-2">Meeting Recordings</div>
            <div className="text-sm text-gray-600 mb-3 break-all font-mono text-xs">
              {storageLocations?.recordings || 'Loading...'}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleOpenFolder('recordings')}
                className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 transition-colors"
              >
                <FolderOpen className="w-4 h-4" />
                Open Folder
              </button>
              <button
                onClick={() => handleChangeFolder('recordings')}
                className="px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Change Path
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 p-3 bg-amber-50 rounded-md border border-amber-200">
          <p className="text-xs text-amber-800">
            <strong>Note:</strong> Changing storage paths will require restarting the application. Existing data will not be automatically moved to the new location.
          </p>
        </div>
      </div>

      {/* Startup Communication Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Disable Startup Communication</h3>
            <p className="text-sm text-gray-600">Disable automatic update checks and any other communication to project servers on startup</p>
          </div>
          <Switch checked={disableStartupCommunication} onCheckedChange={toggleDisableStartupCommunication} />
        </div>
      </div>

      {/* Teams Meeting Detection (Windows only) */}
      {platform === 'windows' && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Microsoft Teams Detection</h3>
              <p className="text-sm text-gray-600">
                Automatically detect Microsoft Teams meetings and prompt to start/stop recording
              </p>
            </div>
            <Switch checked={teamsDetectionEnabled} onCheckedChange={handleTeamsDetectionToggle} />
          </div>
          {teamsDetectionEnabled && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-medium text-gray-900">Use detected meeting titles</h4>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Use the Teams meeting name as the recording title instead of a timestamp
                  </p>
                </div>
                <Switch checked={teamsUseDetectedTitles} onCheckedChange={handleTeamsUseTitlesToggle} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Analytics Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <AnalyticsConsentSwitch />
      </div>
    </div>
  )
}
