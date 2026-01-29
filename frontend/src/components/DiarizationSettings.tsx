'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Eye, EyeOff, Lock, Unlock, Cpu, Zap, AlertCircle, CheckCircle2, Download, Loader2 } from 'lucide-react';

interface DiarizationStatus {
  available: boolean;
  model_loaded: boolean;
  device: string;
  model: {
    model_id: string;
    name: string;
    description: string;
    size_mb: number;
    status: string;
  } | null;
  error?: string;
}

interface DiarizationConfig {
  hf_token_configured: boolean;
  hf_token_masked?: string;
  model_id?: string;
}

export function DiarizationSettings() {
  const [status, setStatus] = useState<DiarizationStatus | null>(null);
  const [config, setConfig] = useState<DiarizationConfig | null>(null);
  const [hfToken, setHfToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isTokenLocked, setIsTokenLocked] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingModel, setIsLoadingModel] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:5167/diarization/status');
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch diarization status:', error);
      setStatus({
        available: false,
        model_loaded: false,
        device: 'cpu',
        model: null,
        error: 'Backend not available'
      });
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:5167/diarization/config');
      if (response.ok) {
        const data = await response.json();
        setConfig(data);
      }
    } catch (error) {
      console.error('Failed to fetch diarization config:', error);
    }
  }, []);

  useEffect(() => {
    const initialize = async () => {
      setIsLoading(true);
      await Promise.all([fetchStatus(), fetchConfig()]);
      setIsLoading(false);
    };
    initialize();
  }, [fetchStatus, fetchConfig]);

  const handleSaveToken = async () => {
    if (!hfToken.trim()) {
      toast.error('Please enter a Hugging Face token');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch('http://localhost:5167/diarization/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hf_token: hfToken })
      });

      if (response.ok) {
        toast.success('Hugging Face token saved successfully');
        setHfToken('');
        setIsTokenLocked(true);
        await fetchConfig();
        await fetchStatus();
      } else {
        const error = await response.json();
        toast.error(`Failed to save token: ${error.detail || 'Unknown error'}`);
      }
    } catch (error) {
      toast.error('Failed to save token: Backend not available');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadModel = async () => {
    setIsLoadingModel(true);
    try {
      const response = await fetch('http://localhost:5167/diarization/load-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const data = await response.json();
        toast.success(`Model loaded successfully on ${data.device.toUpperCase()}`);
        await fetchStatus();
      } else {
        const error = await response.json();
        toast.error(`Failed to load model: ${error.detail || 'Unknown error'}`);
      }
    } catch (error) {
      toast.error('Failed to load model: Backend not available');
    } finally {
      setIsLoadingModel(false);
    }
  };

  const handleUnloadModel = async () => {
    try {
      const response = await fetch('http://localhost:5167/diarization/unload-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        toast.success('Model unloaded successfully');
        await fetchStatus();
      }
    } catch (error) {
      toast.error('Failed to unload model');
    }
  };

  const getDeviceIcon = (device: string) => {
    switch (device.toLowerCase()) {
      case 'cuda':
        return <Zap className="w-4 h-4 text-green-500" />;
      case 'mps':
        return <Zap className="w-4 h-4 text-purple-500" />;
      default:
        return <Cpu className="w-4 h-4 text-gray-500" />;
    }
  };

  const getDeviceLabel = (device: string) => {
    switch (device.toLowerCase()) {
      case 'cuda':
        return 'NVIDIA GPU (CUDA)';
      case 'mps':
        return 'Apple Silicon (Metal)';
      default:
        return 'CPU';
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/4"></div>
          <div className="h-20 bg-gray-100 rounded"></div>
          <div className="h-20 bg-gray-100 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-6">
      {/* Status Card */}
      <div className={`p-4 rounded-lg border ${status?.available ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
        <div className="flex items-start gap-3">
          {status?.available ? (
            <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
          )}
          <div className="flex-1">
            <h3 className="font-medium text-gray-900">
              {status?.available ? 'Speaker Recognition Available' : 'Speaker Recognition Not Available'}
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              {status?.available 
                ? 'pyannote.audio is installed and ready for voice-based speaker diarization.'
                : status?.error || 'Install pyannote.audio dependencies to enable speaker recognition.'}
            </p>
            {status?.available && (
              <div className="flex items-center gap-2 mt-2 text-sm text-gray-600">
                {getDeviceIcon(status.device)}
                <span>Using: {getDeviceLabel(status.device)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hugging Face Token Configuration */}
      <div className="space-y-3">
        <Label className="text-sm font-medium text-gray-700">
          Hugging Face Token
        </Label>
        <p className="text-xs text-gray-500">
          Required to download pyannote.audio models. Get your token at{' '}
          <a 
            href="https://huggingface.co/settings/tokens" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            huggingface.co/settings/tokens
          </a>
          . Accept the model license at{' '}
          <a 
            href="https://huggingface.co/pyannote/speaker-diarization-3.1" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            pyannote/speaker-diarization-3.1
          </a>
        </p>

        {config?.hf_token_configured ? (
          <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <span className="text-sm text-green-700">
              Token configured: {config.hf_token_masked}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsTokenLocked(false)}
              className="ml-auto text-gray-500 hover:text-gray-700"
            >
              Update Token
            </Button>
          </div>
        ) : null}

        <AnimatePresence>
          {(!config?.hf_token_configured || !isTokenLocked) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-3"
            >
              <div className="relative">
                <Input
                  type={showToken ? 'text' : 'password'}
                  value={hfToken}
                  onChange={(e) => setHfToken(e.target.value)}
                  placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="pr-20"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowToken(!showToken)}
                    className="h-8 w-8"
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleSaveToken}
                  disabled={isSaving || !hfToken.trim()}
                  className="flex-1"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Token'
                  )}
                </Button>
                {config?.hf_token_configured && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsTokenLocked(true);
                      setHfToken('');
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Model Management */}
      {status?.available && config?.hf_token_configured && (
        <div className="space-y-3">
          <Label className="text-sm font-medium text-gray-700">
            Diarization Model
          </Label>
          
          <div className={`p-4 rounded-lg border ${status.model_loaded ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium text-gray-900">
                  {status.model?.name || 'speaker-diarization-3.1'}
                </h4>
                <p className="text-sm text-gray-600">
                  {status.model?.description || 'pyannote.audio speaker diarization model'}
                </p>
                <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                  <span>~{status.model?.size_mb || 500}MB</span>
                  {status.model_loaded && (
                    <span className="flex items-center gap-1 text-green-600">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      Loaded
                    </span>
                  )}
                </div>
              </div>
              <div>
                {status.model_loaded ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleUnloadModel}
                  >
                    Unload
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleLoadModel}
                    disabled={isLoadingModel}
                  >
                    {isLoadingModel ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4 mr-2" />
                        Load Model
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-500">
            The model will be downloaded automatically when loading for the first time.
            This requires accepting the model license on Hugging Face.
          </p>
        </div>
      )}

      {/* Usage Instructions */}
      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
        <h4 className="font-medium text-gray-900 mb-2">How to use Speaker Recognition</h4>
        <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
          <li>Configure your Hugging Face token above</li>
          <li>Load the diarization model (downloaded automatically)</li>
          <li>After recording, use the &quot;Full Enhance&quot; button in the transcript panel</li>
          <li>Tag speakers with names using the &quot;Tag&quot; button</li>
          <li>Speaker names will be included in your meeting summary</li>
        </ol>
      </div>
    </div>
  );
}
