import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn, emit } from '@tauri-apps/api/event';
import { toast } from 'sonner';

/** Desired overlay dimensions and screen-edge margin */
const OVERLAY_WIDTH = 370;
const OVERLAY_HEIGHT = 160;
const OVERLAY_MARGIN = 16;

/**
 * Show a small always-on-top overlay popup in the bottom-right corner of the
 * screen. The overlay is a separate Tauri WebviewWindow so it renders on top
 * of every other window (including Teams).
 *
 * Communication with the overlay:
 *  • Main → Overlay:  'teams-overlay-show' event with payload
 *  • Overlay → Main:  'teams-overlay-action' event with the chosen action
 */
async function showOverlayWindow(payload: {
  mode: 'meeting-detected' | 'meeting-ended';
  title: string;
  subtitle: string;
}) {
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const { currentMonitor } = await import('@tauri-apps/api/window');

    // Destroy previous overlay if it still exists
    const existing = await WebviewWindow.getByLabel('teams-overlay');
    if (existing) {
      try { await existing.destroy(); } catch { /* already gone */ }
      // Brief pause so the OS finishes tearing down the window
      await new Promise((r) => setTimeout(r, 100));
    }

    // Get monitor bounds so we can position bottom-right
    const monitor = await currentMonitor();
    let x = 1200;
    let y = 600;
    if (monitor) {
      const { width, height } = monitor.size;
      const scale = monitor.scaleFactor ?? 1;
      const logicalW = width / scale;
      const logicalH = height / scale;
      x = Math.round(logicalW - OVERLAY_WIDTH - OVERLAY_MARGIN);
      y = Math.round(logicalH - OVERLAY_HEIGHT - OVERLAY_MARGIN - 48); // 48px for taskbar
    }

    const overlay = new WebviewWindow('teams-overlay', {
      url: '/teams-overlay.html',
      title: 'Meetily',
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      x,
      y,
      resizable: false,
      decorations: false,
      alwaysOnTop: true,
      focus: true,
      skipTaskbar: true,
      transparent: true,
    });

    // Wait until the webview content is ready, then push data
    overlay.once('tauri://created', () => {
      // Small delay to let the vanilla JS in the overlay initialise
      setTimeout(() => {
        emit('teams-overlay-show', payload);
      }, 150);
    });

    // If window creation fails, log and move on
    overlay.once('tauri://error', (e) => {
      console.error('Overlay window error:', e);
    });
  } catch (err) {
    console.error('Failed to create overlay window:', err);
  }
}

/** Destroy any open overlay window */
async function closeOverlayWindow() {
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const overlay = await WebviewWindow.getByLabel('teams-overlay');
    if (overlay) await overlay.destroy();
  } catch { /* ignore */ }
}

interface DetectedMeeting {
  title: string | null;
  detectedAt: string;
}

interface MeetingEndedPayload {
  ended_at: string;
  duration_seconds: number;
}

interface MeetingDetectedPayload {
  meeting_title: string | null;
  detected_at: string;
}

interface UseTeamsMeetingDetectionProps {
  isRecording: boolean;
  onStartRecording: (meetingTitle?: string) => Promise<void>;
  onStopRecording: () => Promise<void>;
}

interface UseTeamsMeetingDetectionReturn {
  detectedMeeting: DetectedMeeting | null;
  isDetectionActive: boolean;
  startDetection: () => Promise<void>;
  stopDetection: () => Promise<void>;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function useTeamsMeetingDetection({
  isRecording,
  onStartRecording,
  onStopRecording,
}: UseTeamsMeetingDetectionProps): UseTeamsMeetingDetectionReturn {
  const [detectedMeeting, setDetectedMeeting] = useState<DetectedMeeting | null>(null);
  const [isDetectionActive, setIsDetectionActive] = useState(false);

  // Refs to keep latest values inside event callbacks
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;

  const startDetection = useCallback(async () => {
    try {
      await invoke('start_teams_detection');
      setIsDetectionActive(true);
    } catch (err) {
      console.error('Failed to start Teams detection:', err);
    }
  }, []);

  const stopDetection = useCallback(async () => {
    try {
      await invoke('stop_teams_detection');
      setIsDetectionActive(false);
      setDetectedMeeting(null);
    } catch (err) {
      console.error('Failed to stop Teams detection:', err);
    }
  }, []);

  // On mount: check preference and auto-start
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const { Store } = await import('@tauri-apps/plugin-store');
        const store = await Store.load('preferences.json');
        const enabled = (await store.get<boolean>('teams_detection_enabled')) ?? false;
        if (enabled && !cancelled) {
          await startDetection();
        }
      } catch (err) {
        console.error('Failed to load Teams detection preference:', err);
      }
    };

    init();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for events
  useEffect(() => {
    if (!isDetectionActive) return;

    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      const unlistenDetected = await listen<MeetingDetectedPayload>(
        'teams-meeting-detected',
        (event) => {
          const { meeting_title, detected_at } = event.payload;
          setDetectedMeeting({ title: meeting_title, detectedAt: detected_at });

          if (!isRecordingRef.current) {
            const displayTitle = meeting_title || 'Unknown Meeting';

            // Show always-on-top overlay popup (visible over Teams)
            showOverlayWindow({
              mode: 'meeting-detected',
              title: `Teams: ${displayTitle}`,
              subtitle: 'Would you like to start recording?',
            });

            // Also show in-app toast as fallback
            toast.info(`Teams meeting detected: ${displayTitle}`, {
              description: (
                <div className="space-y-2 mt-1">
                  <p className="text-sm text-gray-700">Would you like to start recording?</p>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        toast.dismiss('teams-meeting-prompt');
                        try {
                          await onStartRecording(meeting_title ?? undefined);
                        } catch (err) {
                          console.error('Failed to start recording from Teams prompt:', err);
                        }
                      }}
                      className="px-3 py-1.5 bg-red-600 text-white text-xs rounded hover:bg-red-700 transition-colors font-medium"
                    >
                      Start Recording
                    </button>
                    <button
                      onClick={() => toast.dismiss('teams-meeting-prompt')}
                      className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300 transition-colors font-medium"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ),
              id: 'teams-meeting-prompt',
              duration: 30000,
              position: 'bottom-right',
            });
          }
        },
      );
      unlisteners.push(unlistenDetected);

      const unlistenEnded = await listen<MeetingEndedPayload>(
        'teams-meeting-ended',
        (event) => {
          const { duration_seconds } = event.payload;
          setDetectedMeeting(null);

          if (isRecordingRef.current) {
            const durationStr = formatDuration(duration_seconds);

            // Show always-on-top overlay popup (visible over Teams)
            showOverlayWindow({
              mode: 'meeting-ended',
              title: `Teams meeting ended (${durationStr})`,
              subtitle: 'Would you like to stop recording?',
            });

            // Also show in-app toast as fallback
            toast.info(`Teams meeting ended (${durationStr})`, {
              description: (
                <div className="space-y-2 mt-1">
                  <p className="text-sm text-gray-700">Would you like to stop recording?</p>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        toast.dismiss('teams-meeting-ended-prompt');
                        try {
                          await onStopRecording();
                        } catch (err) {
                          console.error('Failed to stop recording from Teams prompt:', err);
                        }
                      }}
                      className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded hover:bg-gray-800 transition-colors font-medium"
                    >
                      Stop Recording
                    </button>
                    <button
                      onClick={() => toast.dismiss('teams-meeting-ended-prompt')}
                      className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300 transition-colors font-medium"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              ),
              id: 'teams-meeting-ended-prompt',
              duration: 30000,
              position: 'bottom-right',
            });
          }
        },
      );
      unlisteners.push(unlistenEnded);

      // Listen for actions from the overlay window
      const unlistenOverlayAction = await listen<{ action: string; meetingTitle?: string }>(
        'teams-overlay-action',
        async (event) => {
          const { action, meetingTitle } = event.payload;

          // Destroy overlay FIRST and wait for it to complete before proceeding.
          // This avoids racing with the overlay's own self-destruct fallback.
          await closeOverlayWindow();

          if (action === 'start-recording') {
            toast.dismiss('teams-meeting-prompt');
            try {
              await onStartRecording(meetingTitle);
            } catch (err) {
              console.error('Failed to start recording from overlay:', err);
            }
          } else if (action === 'stop-recording') {
            toast.dismiss('teams-meeting-ended-prompt');
            try {
              await onStopRecording();
            } catch (err) {
              console.error('Failed to stop recording from overlay:', err);
            }
          } else if (action === 'dismiss') {
            toast.dismiss('teams-meeting-prompt');
            toast.dismiss('teams-meeting-ended-prompt');
          }
        },
      );
      unlisteners.push(unlistenOverlayAction);
    };

    setup();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [isDetectionActive, onStartRecording, onStopRecording]);

  // Cleanup on unmount — stop detection and destroy any leftover overlay
  useEffect(() => {
    const onBeforeUnload = () => {
      closeOverlayWindow();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      closeOverlayWindow();
      if (isDetectionActive) {
        invoke('stop_teams_detection').catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    detectedMeeting,
    isDetectionActive,
    startDetection,
    stopDetection,
  };
}
