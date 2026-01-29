"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sparkles, ChevronDown, RefreshCw, Tags } from "lucide-react";

interface EnhanceButtonProps {
  onFullEnhance: () => void;
  onQuickLabel: () => void;
  disabled?: boolean;
}

export function EnhanceButton({
  onFullEnhance,
  onQuickLabel,
  disabled = false,
}: EnhanceButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="gap-1"
          title="Enhance transcript with speaker recognition"
        >
          <Sparkles className="h-4 w-4" />
          <span className="hidden lg:inline">Enhance</span>
          <ChevronDown className="h-3 w-3 ml-0.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          onClick={onFullEnhance}
          className="cursor-pointer"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">Full enhance</span>
            <span className="text-xs text-muted-foreground">
              Re-transcribe with speakers
            </span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onQuickLabel}
          className="cursor-pointer"
        >
          <Tags className="h-4 w-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">Quick label</span>
            <span className="text-xs text-muted-foreground">
              Add speakers to existing text
            </span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
