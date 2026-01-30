'use client';

import React from 'react';
import { Sparkles, ChevronDown, RefreshCw, Tag, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface EnhanceButtonProps {
  /** Callback when "Full enhance" (re-transcribe with speakers) is selected */
  onFullEnhance: () => void;
  /** Callback when "Quick label" (add speakers to existing text) is selected */
  onQuickLabel: () => void;
  /** Whether the button should be disabled */
  disabled?: boolean;
  /** Whether enhancement is in progress */
  isEnhancing?: boolean;
  /** Optional className for additional styling */
  className?: string;
}

export function EnhanceButton({
  onFullEnhance,
  onQuickLabel,
  disabled = false,
  isEnhancing = false,
  className = '',
}: EnhanceButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 border border-gray-200 rounded-md text-sm text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
          type="button"
          disabled={disabled || isEnhancing}
        >
          {isEnhancing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Analyzing...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>Enhance</span>
              <ChevronDown className="w-3 h-3 ml-0.5" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          onClick={onFullEnhance}
          className="flex items-center gap-2 cursor-pointer"
          disabled={isEnhancing}
        >
          <RefreshCw className="w-4 h-4 text-gray-500" />
          <div className="flex flex-col">
            <span className="font-medium">Full enhance</span>
            <span className="text-xs text-gray-500">Re-transcribe with speakers</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onQuickLabel}
          className="flex items-center gap-2 cursor-pointer"
          disabled={isEnhancing}
        >
          <Tag className="w-4 h-4 text-gray-500" />
          <div className="flex flex-col">
            <span className="font-medium">Quick label</span>
            <span className="text-xs text-gray-500">Add speakers to existing text</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
