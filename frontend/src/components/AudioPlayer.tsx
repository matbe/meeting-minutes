'use client';

import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Play, Pause, User } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';

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
        console.log('🔊 [AudioPlayer] No audio file path provided');
        setIsLoading(false);
        setError('No audio file available');
        return;
      }

      console.log('🔊 [AudioPlayer] Starting audio load for:', audioFilePath);
      setIsLoading(true);
      setError(null);
      
      let blobUrl: string | null = null;

      // Load audio file using Tauri fs plugin and create blob URL
      const loadAudioFile = async () => {
        try {
          console.log('🔊 [AudioPlayer] Step 1: Reading file with Tauri fs plugin...');
          
          // Read file as binary using Tauri's fs plugin
          const fileData = await readFile(audioFilePath);
          console.log('🔊 [AudioPlayer] Step 2: File read successfully, size:', fileData.length, 'bytes');
          
          if (fileData.length === 0) {
            throw new Error('File is empty (0 bytes)');
          }
          
          // Create a blob from the file data
          console.log('🔊 [AudioPlayer] Step 3: Creating blob...');
          const blob = new Blob([fileData], { type: 'audio/mp4' });
          blobUrl = URL.createObjectURL(blob);
          console.log('🔊 [AudioPlayer] Step 4: Blob URL created:', blobUrl);
          
          // Create audio element
          console.log('🔊 [AudioPlayer] Step 5: Creating Audio element...');
          const audio = new Audio();
          audio.src = blobUrl;

          audio.onloadedmetadata = () => {
            console.log('🔊 [AudioPlayer] ✅ Audio loaded successfully!');
            console.log('🔊 [AudioPlayer]   Duration:', audio.duration, 'seconds');
            console.log('🔊 [AudioPlayer]   Ready state:', audio.readyState);
            setDuration(audio.duration);
            setIsLoading(false);
          };

          audio.onerror = (e) => {
            const errorDetails = audio.error 
              ? `Code: ${audio.error.code}, Message: ${audio.error.message}`
              : 'Unknown error';
            console.error('🔊 [AudioPlayer] ❌ Audio element error:', errorDetails);
            console.error('🔊 [AudioPlayer] Event:', e);
            setError(`Audio decode error: ${errorDetails}`);
            setIsLoading(false);
          };

          audio.ontimeupdate = () => {
            setCurrentTime(audio.currentTime);
            onTimeUpdateRef.current?.(audio.currentTime);
          };

          audio.onended = () => {
            setIsPlaying(false);
          };

          audio.onplay = () => setIsPlaying(true);
          audio.onpause = () => setIsPlaying(false);

          audioRef.current = audio;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('🔊 [AudioPlayer] ❌ Failed to read file with fs plugin:', errMsg);
          
          // Fallback: try using convertFileSrc (asset protocol)
          console.log('🔊 [AudioPlayer] Trying fallback with asset protocol...');
          try {
            const assetUrl = convertFileSrc(audioFilePath);
            console.log('🔊 [AudioPlayer] Fallback asset URL:', assetUrl);
            
            const audio = new Audio();
            audio.src = assetUrl;

            audio.onloadedmetadata = () => {
              console.log('🔊 [AudioPlayer] ✅ Audio loaded via asset protocol!');
              console.log('🔊 [AudioPlayer]   Duration:', audio.duration, 'seconds');
              setDuration(audio.duration);
              setIsLoading(false);
            };

            audio.onerror = (e) => {
              const errorDetails = audio.error 
                ? `Code: ${audio.error.code}, Message: ${audio.error.message}`
                : 'Unknown error';
              console.error('🔊 [AudioPlayer] ❌ Asset protocol also failed:', errorDetails);
              setError(`Failed to load audio: ${errMsg}`);
              setIsLoading(false);
            };

            audio.ontimeupdate = () => {
              setCurrentTime(audio.currentTime);
              onTimeUpdateRef.current?.(audio.currentTime);
            };

            audio.onended = () => {
              setIsPlaying(false);
            };

            audio.onplay = () => setIsPlaying(true);
            audio.onpause = () => setIsPlaying(false);

            audioRef.current = audio;
          } catch (fallbackErr) {
            const fallbackErrMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
            console.error('🔊 [AudioPlayer] ❌ Fallback also failed:', fallbackErrMsg);
            setError(`Failed to load audio: ${errMsg}`);
            setIsLoading(false);
          }
        }
      };

      loadAudioFile();

      return () => {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = '';
          audioRef.current = null;
        }
        if (blobUrl) {
          URL.revokeObjectURL(blobUrl);
        }
      };
    }, [audioFilePath]);

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

    // Handle click on progress bar
    const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percentage = clickX / rect.width;
      const newTime = percentage * duration;
      if (audioRef.current) {
        audioRef.current.currentTime = Math.max(0, Math.min(newTime, duration));
        setCurrentTime(newTime);
      }
    }, [duration]);

    // Calculate progress percentage for progress bar
    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

    // Determine if audio controls should be disabled
    const isDisabled = !audioFilePath || isLoading || !!error;

    return (
      <div className={`bg-white border-t border-gray-200 py-3 px-4 ${className}`}>
        <div className="flex items-center gap-4">
          {/* Tag Button */}
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            type="button"
            disabled={isDisabled}
          >
            <User className="w-4 h-4" />
            <span>Tag</span>
          </button>

          {/* Play/Pause Button */}
          <button
            onClick={togglePlayPause}
            disabled={isDisabled}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-gray-700 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            type="button"
          >
            {isLoading && audioFilePath ? (
              <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5" fill="currentColor" />
            )}
          </button>

          {/* Time Display - Current */}
          <span className={`text-sm font-mono min-w-[45px] ${isDisabled ? 'text-gray-300' : 'text-gray-500'}`}>
            {formatTime(currentTime)}
          </span>

          {/* Progress Bar (clickable) */}
          <div 
            className={`flex-1 h-1 bg-gray-200 rounded-full relative group ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            onClick={isDisabled ? undefined : handleProgressClick}
          >
            <div 
              className={`h-full rounded-full transition-all ${isDisabled ? 'bg-gray-300' : 'bg-gray-400'}`}
              style={{ width: `${progressPercent}%` }}
            />
            {/* Hidden range input for keyboard accessibility */}
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={handleSliderChange}
              disabled={isDisabled}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              aria-label="Audio progress"
            />
          </div>

          {/* Time Display - Duration */}
          <span className={`text-sm font-mono min-w-[45px] ${isDisabled ? 'text-gray-300' : 'text-gray-500'}`}>
            {formatTime(duration)}
          </span>

          {/* Enhance Button */}
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 border border-gray-200 rounded-md text-sm text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            type="button"
            disabled={isDisabled}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.636 5.636l2.121 2.121m8.486 8.486l2.121 2.121M5.636 18.364l2.121-2.121m8.486-8.486l2.121-2.121" />
            </svg>
            <span>Enhance</span>
            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 4.5l3 3 3-3" />
            </svg>
          </button>
        </div>

        {/* Error Message - only show if there's an error AND we have an audio file */}
        {error && audioFilePath && (
          <p className="text-xs text-red-500 mt-2">{error}</p>
        )}
      </div>
    );
  }
);

AudioPlayer.displayName = 'AudioPlayer';
