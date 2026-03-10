'use client';

import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Play, Pause, User } from 'lucide-react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { EnhanceButton } from './EnhanceButton';

interface AudioPlayerProps {
  audioFilePath: string | null;
  onTimeUpdate?: (time: number) => void;
  className?: string;
  /** Callback when "Full enhance" is selected from the dropdown */
  onFullEnhance?: () => void;
  /** Callback when "Quick label" is selected from the dropdown */
  onQuickLabel?: () => void;
  /** Callback when "Tag" button is clicked */
  onTagClick?: () => void;
  /** Whether enhancement is in progress */
  isEnhancing?: boolean;
}

export interface AudioPlayerRef {
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
  play: () => void;
  pause: () => void;
}

// Helper function to format time as MM:SS
function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Helper to convert base64 to Blob using atob and ArrayBuffer (handles large files)
function base64ToBlob(base64: string, mimeType: string): Blob {
  // Decode base64 to binary string
  const binaryString = atob(base64);
  const length = binaryString.length;
  
  // Create a Uint8Array from the binary string
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  // Create blob from the ArrayBuffer (using .buffer property)
  return new Blob([bytes.buffer], { type: mimeType });
}

export const AudioPlayer = forwardRef<AudioPlayerRef, AudioPlayerProps>(
  ({ audioFilePath, onTimeUpdate, className = '', onFullEnhance, onQuickLabel, onTagClick, isEnhancing = false }, ref) => {
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
      play: () => {
        audioRef.current?.play().catch(e => console.error('Play failed:', e));
      },
      pause: () => {
        audioRef.current?.pause();
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

      // Load audio file using Tauri command and create blob URL
      const loadAudioFile = async () => {
        try {
          console.log('🔊 [AudioPlayer] Step 1: Reading file via Tauri command...');
          
          // Read file as base64 using our Tauri command
          const base64Data = await invoke<string>('get_meeting_audio_data', {
            audioPath: audioFilePath
          });
          console.log('🔊 [AudioPlayer] Step 2: Received base64 data, length:', base64Data.length, 'chars');
          
          if (!base64Data || base64Data.length === 0) {
            throw new Error('Received empty data from server');
          }
          
          // Convert base64 to Blob using atob (handles large files better than fetch)
          console.log('🔊 [AudioPlayer] Step 3: Converting base64 to blob...');
          const blob = base64ToBlob(base64Data, 'audio/mp4');
          console.log('🔊 [AudioPlayer] Step 4: Blob created, size:', blob.size, 'bytes');
          
          // Create blob URL
          console.log('🔊 [AudioPlayer] Step 5: Creating blob URL...');
          blobUrl = URL.createObjectURL(blob);
          console.log('🔊 [AudioPlayer] Step 6: Blob URL created:', blobUrl);
          
          // Create audio element
          console.log('🔊 [AudioPlayer] Step 7: Creating Audio element...');
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
          console.error('🔊 [AudioPlayer] ❌ Failed to load audio:', errMsg);
          
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
      <div className={`bg-white border-t border-gray-200 py-3 px-3 ${className}`}>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Tag Button */}
          <button
            className="flex items-center gap-1 px-2 py-1.5 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            type="button"
            disabled={isDisabled}
            onClick={onTagClick}
          >
            <User className="w-4 h-4" />
            <span className="hidden xl:inline">Tag</span>
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
          <span className={`text-xs font-mono min-w-[40px] flex-shrink-0 ${isDisabled ? 'text-gray-300' : 'text-gray-500'}`}>
            {formatTime(currentTime)}
          </span>

          {/* Progress Bar (clickable) */}
          <div 
            className={`flex-1 min-w-[60px] h-1 bg-gray-200 rounded-full relative group ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
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
          <span className={`text-xs font-mono min-w-[40px] flex-shrink-0 ${isDisabled ? 'text-gray-300' : 'text-gray-500'}`}>
            {formatTime(duration)}
          </span>

          {/* Enhance Button */}
          <div className="flex-shrink-0">
            <EnhanceButton
              onFullEnhance={onFullEnhance || (() => {})}
              onQuickLabel={onQuickLabel || (() => {})}
              disabled={isDisabled}
              isEnhancing={isEnhancing}
            />
          </div>
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
