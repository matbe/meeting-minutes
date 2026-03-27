import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';

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
    };

    setup();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [isDetectionActive, onStartRecording, onStopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
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
