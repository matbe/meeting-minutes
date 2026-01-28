'use client';

import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Play, Pause, Volume2 } from 'lucide-react';

interface AudioPlayerProps {
  audioFilePath: string | null;
  onTimeUpdate?: (time: number) => void;
  className?: string;
}

export interface AudioPlayerRef {
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
}

// Helper function to format time as MM:SS
function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Convert file path to Tauri asset URL
// The asset protocol expects the path without encoding directory separators
function buildAssetUrl(filePath: string): string {
  // On Windows, convert backslashes to forward slashes
  const normalizedPath = filePath.replace(/\\/g, '/');
  // Remove leading slash if present (Windows paths start with drive letter)
  const cleanPath = normalizedPath.startsWith('/') ? normalizedPath : '/' + normalizedPath;
  return `asset://localhost${cleanPath}`;
}

export const AudioPlayer = forwardRef<AudioPlayerRef, AudioPlayerProps>(
  ({ audioFilePath, onTimeUpdate, className = '' }, ref) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    
    // Store the latest onTimeUpdate callback in a ref to avoid re-creating audio element
    const onTimeUpdateRef = useRef(onTimeUpdate);
    useEffect(() => {
      onTimeUpdateRef.current = onTimeUpdate;
    }, [onTimeUpdate]);

    // Expose seekTo method via ref
    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        if (audioRef.current) {
          audioRef.current.currentTime = Math.max(0, Math.min(seconds, duration));
        }
      },
      getCurrentTime: () => {
        return audioRef.current?.currentTime ?? 0;
      },
    }));

    // Handle audio file loading
    useEffect(() => {
      if (!audioFilePath) {
        setIsLoading(false);
        setError('No audio file available');
        return;
      }

      setIsLoading(true);
      setError(null);

      // Create audio element with the file path
      const audio = new Audio();
      
      // Convert file path to Tauri asset URL (handles path separators correctly)
      const assetUrl = buildAssetUrl(audioFilePath);
      audio.src = assetUrl;

      audio.onloadedmetadata = () => {
        setDuration(audio.duration);
        setIsLoading(false);
      };

      audio.onerror = (e) => {
        console.error('Audio loading error:', e);
        setError('Failed to load audio file');
        setIsLoading(false);
      };

      audio.ontimeupdate = () => {
        setCurrentTime(audio.currentTime);
        onTimeUpdateRef.current?.(audio.currentTime);
      };

      audio.onended = () => {
        setIsPlaying(false);
        // Keep currentTime at duration to show "finished" state
      };

      audio.onplay = () => setIsPlaying(true);
      audio.onpause = () => setIsPlaying(false);

      audioRef.current = audio;

      return () => {
        audio.pause();
        audio.src = '';
        audioRef.current = null;
      };
    }, [audioFilePath]); // Removed onTimeUpdate from dependencies

    // Handle play/pause toggle
    const togglePlayPause = useCallback(async () => {
      if (!audioRef.current) return;

      try {
        if (isPlaying) {
          audioRef.current.pause();
        } else {
          await audioRef.current.play();
        }
      } catch (err) {
        console.error('Playback error:', err);
        setError('Playback failed');
      }
    }, [isPlaying]);

    // Handle slider change (seeking)
    const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const newTime = parseFloat(e.target.value);
      if (audioRef.current) {
        audioRef.current.currentTime = newTime;
        setCurrentTime(newTime);
      }
    }, []);

    // Calculate progress percentage for slider styling
    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

    if (error && !audioFilePath) {
      return null; // Don't show anything if there's no audio file
    }

    return (
      <div className={`bg-white border border-gray-200 rounded-lg shadow-sm p-3 ${className}`}>
        <div className="flex items-center gap-3">
          {/* Play/Pause Button */}
          <button
            onClick={togglePlayPause}
            disabled={isLoading || !!error}
            className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-full transition-colors shadow-sm"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isLoading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5 ml-0.5" />
            )}
          </button>

          {/* Time Display - Current */}
          <span className="text-sm text-gray-600 font-mono min-w-[45px]">
            {formatTime(currentTime)}
          </span>

          {/* Progress Slider */}
          <div className="flex-1 relative">
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={handleSliderChange}
              disabled={isLoading || !!error}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:cursor-not-allowed
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 
                         [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md
                         [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform
                         [&::-webkit-slider-thumb]:hover:scale-110
                         [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:bg-blue-500
                         [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:shadow-md"
              style={{
                background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${progressPercent}%, #e5e7eb ${progressPercent}%, #e5e7eb 100%)`,
              }}
            />
          </div>

          {/* Time Display - Duration */}
          <span className="text-sm text-gray-600 font-mono min-w-[45px]">
            {formatTime(duration)}
          </span>

          {/* Volume Icon (visual indicator) */}
          <Volume2 className="w-5 h-5 text-gray-400 flex-shrink-0" />
        </div>

        {/* Error Message */}
        {error && (
          <p className="text-xs text-red-500 mt-2">{error}</p>
        )}
      </div>
    );
  }
);

AudioPlayer.displayName = 'AudioPlayer';
