import React, { useState, useEffect } from 'react';

interface ConfirmationModalProps {
  onConfirm: (deleteAllData: boolean) => void;
  onCancel: () => void;
  text: string;
  isOpen: boolean;
  hasAudioFile?: boolean;
}

export function ConfirmationModal({ onConfirm, onCancel, text, isOpen, hasAudioFile = true }: ConfirmationModalProps) {
  const [deleteAllData, setDeleteAllData] = useState(!hasAudioFile);

  // When audio is missing, force checkbox to be checked and disabled
  useEffect(() => {
    if (!hasAudioFile) {
      setDeleteAllData(true);
    } else {
      setDeleteAllData(false);
    }
  }, [hasAudioFile]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-semibold mb-4">Confirm Delete</h2>
        <p className="text-gray-600 mb-4">{text}</p>
        
        <div className="mb-6">
          <label className="flex items-start space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteAllData}
              onChange={(e) => setDeleteAllData(e.target.checked)}
              disabled={!hasAudioFile}
              className="mt-1 h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <div className="flex-1">
              <span className="text-sm font-medium text-gray-900">
                Delete all meeting data (audio, transcripts, metadata)
              </span>
              <p className="text-xs text-gray-500 mt-1">
                {hasAudioFile 
                  ? "If unchecked, only the meeting audio will be removed. The meeting will remain in the list."
                  : "No audio file exists. You must delete all meeting data."}
              </p>
            </div>
          </label>
        </div>

        <div className="flex justify-end space-x-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(deleteAllData)}
            className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-md transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
