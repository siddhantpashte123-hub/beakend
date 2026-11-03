'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Database,
  Plus,
  Trash2,
  Filter,
  Download,
  Upload,
  Edit3,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
} from 'lucide-react';
import { Card, Button, Input, Badge, Modal, Skeleton, useToast } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';

interface CollectionInfo {
  name: string;
  count: number;
}

export default function DatabasePage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [activeCol, setActiveCol] = useState<string>('');
  const [docs, setDocs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Query builder state
  const [filterField, setFilterField] = useState('');
  const [filterOp, setFilterOp] = useState('==');
  const [filterValue, setFilterValue] = useState('');
  const [orderByField, setOrderByField] = useState('_createdAt');
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>('desc');
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);

  // Modals
  const [newColOpen, setNewColOpen] = useState(false);
  const [newColName, setNewColName] = useState('');

  const [docModalOpen, setDocModalOpen] = useState(false);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [docJson, setDocJson] = useState('{\n  "title": "Hello BlueBeakend",\n  "done": false\n}');

  // Inline cell edit state
  const [inlineCell, setInlineCell] = useState<{ id: string; key: string; value: string } | null>(null);

  const loadCollections = useCallback(async () => {
    try {
      const res = await apiFetch<{ collections: CollectionInfo[] }>('/api/v1/admin/collections');
      setCollections(res.collections);
      if (!activeCol && res.collections.length > 0) {
        setActiveCol(res.collections[0].name);
      }
    } catch (err: any) {
      toast('Failed to load collections', { description: err.message, variant: 'error' });
    }
  }, [activeCol, toast]);

  const parseTypedValue = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return raw;
      }
    }
    return raw;
  };

  const loadDocs = useCallback(async () => {
    if (!activeCol) {
      setDocs([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const where = filterField.trim() ? [[filterField.trim(), filterOp, parseTypedValue(filterValue)]] : [];
      const res = await apiFetch<{ docs: any[]; total: number }>(`/api/v1/db/${encodeURIComponent(activeCol)}/query`, {
        method: 'POST',
        body: {
          ...(where.length ? { where } : {}),
          orderBy: [[orderByField || '_createdAt', orderDir]],
          limit,
          offset,
        },
      });
      setDocs(res.docs);
      setTotal(res.total);
    } catch (err: any) {
      toast('Query failed', { description: err.message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [activeCol, filterField, filterOp, filterValue, orderByField, orderDir, limit, offset, toast]);

  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ collection: CollectionInfo }>('/api/v1/admin/collections', {
        method: 'POST',
        body: { name: newColName.trim() },
      });
      setNewColOpen(false);
      setNewColName('');
      setActiveCol(res.collection.name);
      setOffset(0);
      await loadCollections();
      toast('Collection created', { description: res.collection.name, variant: 'success' });
    } catch (err: any) {
      toast('Error', { description: err.message, variant: 'error' });
    }
  };

  const handleDropCollection = async (name: string) => {
    if (!confirm(`Delete entire collection "${name}" and all its documents?`)) return;
    try {
      await apiFetch(`/api/v1/admin/collections/${encodeURIComponent(name)}`, { method: 'DELETE' });
      toast('Collection deleted', { description: name, variant: 'success' });
      const remaining = collections.filter((c) => c.name !== name);
      setCollections(remaining);
      setActiveCol(remaining[0]?.name || '');
    } catch (err: any) {
      toast('Delete failed', { description: err.message, variant: 'error' });
    }
  };

  const handleSaveDocJson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCol) return;
    try {
      const parsed = JSON.parse(docJson);
      if (editingDocId) {
        await apiFetch(`/api/v1/db/${encodeURIComponent(activeCol)}/${editingDocId}`, {
          method: 'PUT',
          body: parsed,
        });
        toast('Document updated', { variant: 'success' });
      } else {
        await apiFetch(`/api/v1/db/${encodeURIComponent(activeCol)}`, {
          method: 'POST',
          body: parsed,
        });
        toast('Document created', { variant: 'success' });
      }
      setDocModalOpen(false);
      await Promise.all([loadDocs(), loadCollections()]);
    } catch (err: any) {
      toast('Invalid JSON or save error', { description: err.message, variant: 'error' });
    }
  };

  const handleInlineSave = async () => {
    if (!inlineCell || !activeCol) return;
    try {
      await apiFetch(`/api/v1/db/${encodeURIComponent(activeCol)}/${inlineCell.id}`, {
        method: 'PATCH',
        body: { [inlineCell.key]: parseTypedValue(inlineCell.value) },
      });
      setInlineCell(null);
      toast('Field updated inline', { variant: 'success' });
      loadDocs();
    } catch (err: any) {
      toast('Inline update failed', { description: err.message, variant: 'error' });
    }
  };

  const handleDeleteDoc = async (id: string) => {
    if (!activeCol || !confirm(`Delete document ${id.slice(0, 8)}…?`)) return;
    try {
      await apiFetch(`/api/v1/db/${encodeURIComponent(activeCol)}/${id}`, { method: 'DELETE' });
      toast('Document deleted', { variant: 'success' });
      await Promise.all([loadDocs(), loadCollections()]);
    } catch (err: any) {
      toast('Delete failed', { description: err.message, variant: 'error' });
    }
  };

  const handleExportJson = async () => {
    if (!activeCol) return;
    try {
      const res = await apiFetch(`/api/v1/admin/collections/${encodeURIComponent(activeCol)}/export`);
      const blob = new Blob([JSON.stringify(res.docs, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeCol}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast('Export failed', { description: err.message, variant: 'error' });
    }
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeCol) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const docsArray = Array.isArray(parsed) ? parsed : parsed.docs;
      if (!Array.isArray(docsArray)) throw new Error('Expected JSON array of documents');
      const res = await apiFetch<{ imported: number }>(
        `/api/v1/admin/collections/${encodeURIComponent(activeCol)}/import`,
        { method: 'POST', body: { docs: docsArray } }
      );
      toast('Import succeeded', { description: `Imported ${res.imported} document(s)`, variant: 'success' });
      await Promise.all([loadDocs(), loadCollections()]);
    } catch (err: any) {
      toast('Import failed', { description: err.message, variant: 'error' });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Discover dynamic columns across current page of documents
  const dynamicKeys = Array.from(
    new Set(
      docs.flatMap((d) => Object.keys(d).filter((k) => !k.startsWith('_')))
    )
  ).slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Document Database</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Firestore-style schemaless JSON collections with live queries, inline editing & JSON import/export.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImportJson} />
          <Button size="sm" variant="outline" disabled={!activeCol} onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Import JSON
          </Button>
          <Button size="sm" variant="outline" disabled={!activeCol} onClick={handleExportJson}>
            <Download className="h-3.5 w-3.5" /> Export JSON
          </Button>
          <Button
            size="sm"
            disabled={!activeCol}
            onClick={() => {
              setEditingDocId(null);
              setDocJson('{\n  "title": "Sample item",\n  "done": false\n}');
              setDocModalOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Add Document
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Sidebar: Collections */}
        <Card className="lg:col-span-3 p-3 flex flex-col gap-2 self-start">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Collections</span>
            <Button size="sm" variant="ghost" onClick={() => setNewColOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
          </div>
          {collections.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              No collections yet. Click <b>+ New</b> to create one.
            </div>
          ) : (
            <div className="space-y-1">
              {collections.map((c) => (
                <div
                  key={c.name}
                  onClick={() => {
                    setActiveCol(c.name);
                    setOffset(0);
                  }}
                  className={cn(
                    'group flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium cursor-pointer transition-colors',
                    activeCol === c.name
                      ? 'bg-[#0066FF] text-white'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70'
                  )}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Database className="h-3.5 w-3.5 shrink-0 opacity-80" />
                    <span className="truncate">{c.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'text-xs px-1.5 py-0.5 rounded-md font-mono',
                        activeCol === c.name ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                      )}
                    >
                      {c.count}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDropCollection(c.name);
                      }}
                      title="Delete collection"
                      className={cn(
                        'opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20',
                        activeCol === c.name ? 'text-white' : 'text-red-500'
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Right Panel: Query Builder + Documents Table */}
        <div className="lg:col-span-9 space-y-4">
          {/* Query Builder */}
          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-2.5">
              <div className="flex-1 min-w-[130px]">
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Where Field</label>
                <Input placeholder="e.g. done" value={filterField} onChange={(e) => setFilterField(e.target.value)} />
              </div>
              <div className="w-28">
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Operator</label>
                <select
                  value={filterOp}
                  onChange={(e) => setFilterOp(e.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="==">==</option>
                  <option value="!=">!=</option>
                  <option value=">">&gt;</option>
                  <option value=">=">&gt;=</option>
                  <option value="<">&lt;</option>
                  <option value="<=">&lt;=</option>
                  <option value="contains">contains</option>
                  <option value="exists">exists</option>
                </select>
              </div>
              <div className="flex-1 min-w-[130px]">
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Value</label>
                <Input placeholder="false / 10 / text" value={filterValue} onChange={(e) => setFilterValue(e.target.value)} />
              </div>
              <div className="w-36">
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Order By</label>
                <Input value={orderByField} onChange={(e) => setOrderByField(e.target.value)} />
              </div>
              <div className="w-24">
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Dir</label>
                <select
                  value={orderDir}
                  onChange={(e) => setOrderDir(e.target.value as 'asc' | 'desc')}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="desc">DESC</option>
                  <option value="asc">ASC</option>
                </select>
              </div>
              <div className="w-20">
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Limit</label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value) || 25)}
                />
              </div>
              <Button
                size="md"
                variant="secondary"
                onClick={() => {
                  setOffset(0);
                  loadDocs();
                }}
              >
                <Filter className="h-3.5 w-3.5" /> Run
              </Button>
            </div>
          </Card>

          {/* Documents Table */}
          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
              <span>
                Collection: <strong className="text-slate-900 dark:text-slate-100">{activeCol || '—'}</strong> ({total}{' '}
                documents) • <span className="text-[#0066FF]">Click any cell to inline-edit</span>
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span>
                  {total ? offset + 1 : 0}–{Math.min(offset + docs.length, total)} of {total}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={offset + limit >= total}
                  onClick={() => setOffset(offset + limit)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="p-3.5">_id</th>
                    {dynamicKeys.map((k) => (
                      <th key={k} className="p-3.5">
                        {k}
                      </th>
                    ))}
                    <th className="p-3.5">Updated</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {loading ? (
                    [1, 2, 3].map((i) => (
                      <tr key={i}>
                        <td colSpan={dynamicKeys.length + 3} className="p-4">
                          <Skeleton className="h-7 w-full" />
                        </td>
                      </tr>
                    ))
                  ) : docs.length === 0 ? (
                    <tr>
                      <td colSpan={dynamicKeys.length + 3} className="p-10 text-center text-slate-400">
                        No documents found in this collection.
                      </td>
                    </tr>
                  ) : (
                    docs.map((d) => (
                      <tr key={d._id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30">
                        <td className="p-3.5 font-mono text-xs text-slate-500">{d._id.slice(0, 8)}…</td>
                        {dynamicKeys.map((k) => {
                          const val = d[k];
                          const isEditing = inlineCell?.id === d._id && inlineCell?.key === k;
                          const display =
                            val === undefined
                              ? '—'
                              : typeof val === 'object'
                                ? JSON.stringify(val)
                                : String(val);

                          return (
                            <td
                              key={k}
                              onClick={() => {
                                if (!isEditing) {
                                  setInlineCell({
                                    id: d._id,
                                    key: k,
                                    value: typeof val === 'object' ? JSON.stringify(val) : String(val ?? ''),
                                  });
                                }
                              }}
                              className="p-3.5 max-w-[220px] truncate cursor-pointer hover:bg-[#0066FF]/5"
                            >
                              {isEditing ? (
                                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                  <Input
                                    autoFocus
                                    value={inlineCell.value}
                                    onChange={(e) => setInlineCell({ ...inlineCell, value: e.target.value })}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleInlineSave();
                                      if (e.key === 'Escape') setInlineCell(null);
                                    }}
                                    className="h-7 text-xs px-2"
                                  />
                                  <button onClick={handleInlineSave} className="p-1 text-emerald-500">
                                    <Check className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => setInlineCell(null)} className="p-1 text-slate-400">
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ) : typeof val === 'boolean' ? (
                                <Badge variant={val ? 'success' : 'default'}>{String(val)}</Badge>
                              ) : (
                                <span className="truncate block">{display}</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="p-3.5 text-xs text-slate-400 whitespace-nowrap">{timeAgo(d._updatedAt)}</td>
                        <td className="p-3.5 text-right whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Open JSON editor"
                            onClick={() => {
                              const { _id, _createdAt, _updatedAt, ...clean } = d;
                              setEditingDocId(_id);
                              setDocJson(JSON.stringify(clean, null, 2));
                              setDocModalOpen(true);
                            }}
                          >
                            <Edit3 className="h-3.5 w-3.5 text-[#0066FF]" />
                          </Button>
                          <Button size="sm" variant="ghost" title="Delete document" onClick={() => handleDeleteDoc(d._id)}>
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      {/* New Collection Modal */}
      <Modal
        open={newColOpen}
        onClose={() => setNewColOpen(false)}
        title="Create Collection"
        description="Letters, numbers, hyphens, and underscores (max 64 chars)."
      >
        <form onSubmit={handleCreateCollection} className="space-y-4">
          <Input
            required
            placeholder="e.g. orders, posts, profiles"
            value={newColName}
            onChange={(e) => setNewColName(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setNewColOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create Collection</Button>
          </div>
        </form>
      </Modal>

      {/* JSON Document Editor Modal */}
      <Modal
        open={docModalOpen}
        onClose={() => setDocModalOpen(false)}
        title={editingDocId ? `Edit Document (${editingDocId.slice(0, 8)}…)` : `New Document in "${activeCol}"`}
        description="Edit raw JSON document fields. Metadata (_id, _createdAt, _updatedAt) is managed automatically."
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSaveDocJson} className="space-y-4">
          <textarea
            rows={12}
            value={docJson}
            onChange={(e) => setDocJson(e.target.value)}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#0066FF]"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDocModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">{editingDocId ? 'Save Changes' : 'Create Document'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
