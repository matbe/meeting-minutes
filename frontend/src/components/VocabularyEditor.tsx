'use client';

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { VocabularyEntry, VocabularySetWithCount } from '@/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';
import {
  Plus,
  Trash2,
  Edit2,
  ArrowLeft,
  Search,
  X,
  Check,
  Book,
} from 'lucide-react';
import { VOCABULARY_CATEGORIES, parseAlternatives, formatAlternatives } from '@/lib/vocabularyCorrection';
import { ConfirmationModal } from './ConfirmationModel/confirmation-modal';

interface VocabularyEditorProps {
  vocabularySet: VocabularySetWithCount;
  onBack: () => void;
}

export function VocabularyEditor({ vocabularySet, onBack }: VocabularyEditorProps) {
  const [entries, setEntries] = useState<VocabularyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  
  // Form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<VocabularyEntry | null>(null);
  const [formTerm, setFormTerm] = useState('');
  const [formAlternatives, setFormAlternatives] = useState('');
  const [formCategory, setFormCategory] = useState<string>('');
  const [formPronunciation, setFormPronunciation] = useState('');
  
  // Delete confirmation state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ isOpen: boolean; entryId: string | null }>({
    isOpen: false,
    entryId: null,
  });

  const loadEntries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await invoke<VocabularyEntry[]>('get_vocabulary_entries', {
        setId: vocabularySet.id,
      });
      setEntries(data);
    } catch (err) {
      console.error('Failed to load vocabulary entries:', err);
      setError('Failed to load vocabulary entries');
    } finally {
      setLoading(false);
    }
  }, [vocabularySet.id]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handleAddEntry = async () => {
    if (!formTerm.trim()) return;

    try {
      const alternatives = parseAlternatives(formAlternatives);
      await invoke('add_vocabulary_entry', {
        setId: vocabularySet.id,
        term: formTerm.trim(),
        alternatives,
        category: formCategory || null,
        pronunciation: formPronunciation.trim() || null,
      });
      resetForm();
      await loadEntries();
    } catch (err) {
      console.error('Failed to add vocabulary entry:', err);
      setError('Failed to add vocabulary entry');
    }
  };

  const handleUpdateEntry = async () => {
    if (!editingEntry || !formTerm.trim()) return;

    try {
      const alternatives = parseAlternatives(formAlternatives);
      await invoke('update_vocabulary_entry', {
        id: editingEntry.id,
        term: formTerm.trim(),
        alternatives,
        category: formCategory || null,
        pronunciation: formPronunciation.trim() || null,
        enabled: editingEntry.enabled,
      });
      resetForm();
      await loadEntries();
    } catch (err) {
      console.error('Failed to update vocabulary entry:', err);
      setError('Failed to update vocabulary entry');
    }
  };

  const confirmDeleteEntry = async () => {
    if (!deleteConfirmation.entryId) return;
    
    try {
      await invoke('delete_vocabulary_entry', { entryId: deleteConfirmation.entryId });
      setDeleteConfirmation({ isOpen: false, entryId: null });
      await loadEntries();
    } catch (err) {
      console.error('Failed to delete vocabulary entry:', err);
      setError('Failed to delete vocabulary entry');
      setDeleteConfirmation({ isOpen: false, entryId: null });
    }
  };

  const handleDeleteEntry = (entryId: string) => {
    setDeleteConfirmation({ isOpen: true, entryId });
  };

  const handleToggleEnabled = async (entryId: string, enabled: boolean) => {
    try {
      await invoke('toggle_vocabulary_entry', { entryId, enabled });
      await loadEntries();
    } catch (err) {
      console.error('Failed to toggle vocabulary entry:', err);
      setError('Failed to toggle vocabulary entry');
    }
  };

  const startEditing = (entry: VocabularyEntry) => {
    setEditingEntry(entry);
    setFormTerm(entry.term);
    setFormAlternatives(formatAlternatives(entry.alternatives || []));
    setFormCategory(entry.category || '');
    setFormPronunciation(entry.pronunciation || '');
    setShowAddForm(false);
  };

  const startAdding = () => {
    resetForm();
    setShowAddForm(true);
  };

  const resetForm = () => {
    setShowAddForm(false);
    setEditingEntry(null);
    setFormTerm('');
    setFormAlternatives('');
    setFormCategory('');
    setFormPronunciation('');
  };

  // Filter entries based on search and category
  const filteredEntries = entries.filter((entry) => {
    const matchesSearch =
      searchQuery === '' ||
      entry.term.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (entry.alternatives || []).some(alt =>
        alt.toLowerCase().includes(searchQuery.toLowerCase())
      );
    const matchesCategory =
      categoryFilter === 'all' || entry.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Get unique categories from entries
  const usedCategories = [...new Set(entries.map(e => e.category).filter(Boolean))] as string[];

  return (
    <div className="space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Book className="w-5 h-5 text-blue-500" />
            {vocabularySet.name}
          </h3>
          {vocabularySet.description && (
            <p className="text-sm text-gray-500">{vocabularySet.description}</p>
          )}
        </div>
        <Button onClick={startAdding} className="flex items-center gap-2" disabled={showAddForm}>
          <Plus className="w-4 h-4" />
          Add Term
        </Button>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
          {error}
        </div>
      )}

      {/* Search and Filter */}
      <div className="flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search terms or alternatives..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {usedCategories.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Add/Edit Form */}
      {(showAddForm || editingEntry) && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-4">
          <h4 className="font-medium text-gray-900">
            {editingEntry ? 'Edit Term' : 'Add New Term'}
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="term" className="text-sm font-medium text-gray-700">
                Term (correct spelling) *
              </Label>
              <Input
                id="term"
                value={formTerm}
                onChange={(e) => setFormTerm(e.target.value)}
                placeholder="e.g., Kubernetes"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="alternatives" className="text-sm font-medium text-gray-700">
                Common Misrecognitions (comma-separated)
              </Label>
              <Input
                id="alternatives"
                value={formAlternatives}
                onChange={(e) => setFormAlternatives(e.target.value)}
                placeholder="e.g., Cooper Netties, Kuber Netties"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="category" className="text-sm font-medium text-gray-700">
                Category
              </Label>
              <Select value={formCategory} onValueChange={setFormCategory}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select category..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {VOCABULARY_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="pronunciation" className="text-sm font-medium text-gray-700">
                Pronunciation (optional)
              </Label>
              <Input
                id="pronunciation"
                value={formPronunciation}
                onChange={(e) => setFormPronunciation(e.target.value)}
                placeholder="e.g., koo-ber-NET-eez"
                className="mt-1"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={editingEntry ? handleUpdateEntry : handleAddEntry}
              disabled={!formTerm.trim()}
            >
              <Check className="w-4 h-4 mr-2" />
              {editingEntry ? 'Save Changes' : 'Add Term'}
            </Button>
            <Button variant="outline" onClick={resetForm}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="text-center py-8 text-gray-500">Loading vocabulary entries...</div>
      )}

      {/* Empty state */}
      {!loading && entries.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <Book className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <h4 className="text-lg font-medium text-gray-900 mb-2">No Terms Yet</h4>
          <p className="text-gray-500 mb-4">
            Add your first term to start improving transcription accuracy.
          </p>
          <Button onClick={startAdding}>
            <Plus className="w-4 h-4 mr-2" />
            Add First Term
          </Button>
        </div>
      )}

      {/* Entries List */}
      {!loading && filteredEntries.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-700">
                  Enabled
                </th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-700">
                  Term
                </th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-700">
                  Alternatives
                </th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-700">
                  Category
                </th>
                <th className="text-right px-4 py-3 text-sm font-medium text-gray-700">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredEntries.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Switch
                      checked={entry.enabled}
                      onCheckedChange={(checked) => handleToggleEnabled(entry.id, checked)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900">{entry.term}</span>
                    {entry.pronunciation && (
                      <span className="text-xs text-gray-500 ml-2">({entry.pronunciation})</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-600">
                      {(entry.alternatives || []).join(', ') || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {entry.category ? (
                      <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full">
                        {entry.category}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => startEditing(entry)}
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteEntry(entry.id)}
                        title="Delete"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* No results message */}
      {!loading && entries.length > 0 && filteredEntries.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No entries match your search criteria.
        </div>
      )}

      {/* Stats */}
      {!loading && entries.length > 0 && (
        <div className="text-sm text-gray-500">
          {filteredEntries.length} of {entries.length} entries
          {searchQuery || categoryFilter !== 'all' ? ' (filtered)' : ''}
        </div>
      )}

      {/* Delete confirmation modal */}
      <ConfirmationModal
        isOpen={deleteConfirmation.isOpen}
        text="Are you sure you want to delete this vocabulary entry?"
        onConfirm={confirmDeleteEntry}
        onCancel={() => setDeleteConfirmation({ isOpen: false, entryId: null })}
      />
    </div>
  );
}
