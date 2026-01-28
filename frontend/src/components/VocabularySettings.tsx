'use client';

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { VocabularySetWithCount, VocabularyEntry } from '@/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Plus, Trash2, Edit2, FileDown, FileUp, Book, ChevronRight } from 'lucide-react';
import { VocabularyEditor } from './VocabularyEditor';

interface VocabularySettingsProps {
  onClose?: () => void;
}

export function VocabularySettings({ onClose }: VocabularySettingsProps) {
  const [vocabularySets, setVocabularySets] = useState<VocabularySetWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSetName, setNewSetName] = useState('');
  const [newSetDescription, setNewSetDescription] = useState('');
  const [editingSet, setEditingSet] = useState<VocabularySetWithCount | null>(null);
  const [selectedSet, setSelectedSet] = useState<VocabularySetWithCount | null>(null);

  const loadVocabularySets = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const sets = await invoke<VocabularySetWithCount[]>('get_vocabulary_sets');
      setVocabularySets(sets);
    } catch (err) {
      console.error('Failed to load vocabulary sets:', err);
      setError('Failed to load vocabulary sets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVocabularySets();
  }, [loadVocabularySets]);

  const handleCreateSet = async () => {
    if (!newSetName.trim()) return;

    try {
      await invoke('create_vocabulary_set', {
        name: newSetName.trim(),
        description: newSetDescription.trim() || null,
      });
      setNewSetName('');
      setNewSetDescription('');
      setShowCreateForm(false);
      await loadVocabularySets();
    } catch (err) {
      console.error('Failed to create vocabulary set:', err);
      setError('Failed to create vocabulary set');
    }
  };

  const handleUpdateSet = async () => {
    if (!editingSet || !newSetName.trim()) return;

    try {
      await invoke('update_vocabulary_set', {
        id: editingSet.id,
        name: newSetName.trim(),
        description: newSetDescription.trim() || null,
        isDefault: editingSet.is_default,
      });
      setEditingSet(null);
      setNewSetName('');
      setNewSetDescription('');
      await loadVocabularySets();
    } catch (err) {
      console.error('Failed to update vocabulary set:', err);
      setError('Failed to update vocabulary set');
    }
  };

  const handleDeleteSet = async (setId: string) => {
    if (!confirm('Are you sure you want to delete this vocabulary set? All entries will be removed.')) {
      return;
    }

    try {
      await invoke('delete_vocabulary_set', { setId });
      await loadVocabularySets();
    } catch (err) {
      console.error('Failed to delete vocabulary set:', err);
      setError('Failed to delete vocabulary set');
    }
  };

  const handleExport = async (setId: string, setName: string) => {
    try {
      const csvContent = await invoke<string>('export_vocabulary', { setId });
      
      // Create download link
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `${setName.replace(/\s+/g, '_')}_vocabulary.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Failed to export vocabulary:', err);
      setError('Failed to export vocabulary');
    }
  };

  const handleImport = async (setId: string) => {
    // Create file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const content = await file.text();
        const count = await invoke<number>('import_vocabulary', {
          setId,
          csvContent: content,
        });
        alert(`Successfully imported ${count} vocabulary entries`);
        await loadVocabularySets();
      } catch (err) {
        console.error('Failed to import vocabulary:', err);
        setError('Failed to import vocabulary');
      }
    };

    input.click();
  };

  const startEditing = (set: VocabularySetWithCount) => {
    setEditingSet(set);
    setNewSetName(set.name);
    setNewSetDescription(set.description || '');
  };

  const cancelEditing = () => {
    setEditingSet(null);
    setNewSetName('');
    setNewSetDescription('');
    setShowCreateForm(false);
  };

  // If a set is selected, show the editor
  if (selectedSet) {
    return (
      <VocabularyEditor
        vocabularySet={selectedSet}
        onBack={() => {
          setSelectedSet(null);
          loadVocabularySets();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Custom Vocabulary</h3>
          <p className="text-sm text-gray-500 mt-1">
            Add custom terms to improve transcription accuracy for technical words, names, and acronyms.
          </p>
        </div>
        <Button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-2"
          disabled={showCreateForm}
        >
          <Plus className="w-4 h-4" />
          New Set
        </Button>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
          {error}
        </div>
      )}

      {/* Create/Edit Form */}
      {(showCreateForm || editingSet) && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-4">
          <h4 className="font-medium text-gray-900">
            {editingSet ? 'Edit Vocabulary Set' : 'Create Vocabulary Set'}
          </h4>
          <div className="space-y-3">
            <div>
              <Label htmlFor="set-name" className="text-sm font-medium text-gray-700">
                Name
              </Label>
              <Input
                id="set-name"
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                placeholder="e.g., Tech Terms, Company Glossary"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="set-description" className="text-sm font-medium text-gray-700">
                Description (optional)
              </Label>
              <Input
                id="set-description"
                value={newSetDescription}
                onChange={(e) => setNewSetDescription(e.target.value)}
                placeholder="A brief description of this vocabulary set"
                className="mt-1"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={editingSet ? handleUpdateSet : handleCreateSet}
              disabled={!newSetName.trim()}
            >
              {editingSet ? 'Save Changes' : 'Create Set'}
            </Button>
            <Button variant="outline" onClick={cancelEditing}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="text-center py-8 text-gray-500">
          Loading vocabulary sets...
        </div>
      )}

      {/* Empty state */}
      {!loading && vocabularySets.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <Book className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <h4 className="text-lg font-medium text-gray-900 mb-2">No Vocabulary Sets</h4>
          <p className="text-gray-500 mb-4">
            Create your first vocabulary set to start improving transcription accuracy.
          </p>
          <Button onClick={() => setShowCreateForm(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Vocabulary Set
          </Button>
        </div>
      )}

      {/* Vocabulary Sets List */}
      {!loading && vocabularySets.length > 0 && (
        <div className="space-y-3">
          {vocabularySets.map((set) => (
            <div
              key={set.id}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div
                  className="flex-1 cursor-pointer"
                  onClick={() => setSelectedSet(set)}
                >
                  <div className="flex items-center gap-2">
                    <Book className="w-5 h-5 text-blue-500" />
                    <h4 className="font-medium text-gray-900">{set.name}</h4>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {set.entry_count} {set.entry_count === 1 ? 'term' : 'terms'}
                    </span>
                  </div>
                  {set.description && (
                    <p className="text-sm text-gray-500 mt-1 ml-7">{set.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleImport(set.id);
                    }}
                    title="Import CSV"
                  >
                    <FileUp className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExport(set.id, set.name);
                    }}
                    title="Export CSV"
                  >
                    <FileDown className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditing(set);
                    }}
                    title="Edit"
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSet(set.id);
                    }}
                    title="Delete"
                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSelectedSet(set)}
                    title="Open"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info about vocabulary usage */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 mb-2">How it works</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Add technical terms, product names, and acronyms that are often misrecognized</li>
          <li>• Include common misrecognitions (e.g., &quot;Kubernetes&quot; → &quot;Cooper Netties&quot;)</li>
          <li>• Vocabulary is automatically applied to correct transcriptions</li>
          <li>• Import/export vocabulary sets as CSV for easy sharing</li>
        </ul>
      </div>
    </div>
  );
}
