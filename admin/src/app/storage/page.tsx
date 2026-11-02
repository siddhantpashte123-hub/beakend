'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  UploadCloud,
  Folder,
  FolderPlus,
  FileText,
  Image as ImageIcon,
  Link2,
  Trash2,
  Download,
  Search,
} from 'lucide-react';
import { Card, Button, Input, Badge, Modal, Skeleton, useToast } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { cn, formatBytes, timeAgo, copyToClipboard } from '@/lib/utils';

interface FileItem {
  id: string;
  name: string;
  folder: string;
  mime: string;
  size: number;
  isPublic: boolean;
  createdAt: string;
  url: string;
}

export default function StoragePage() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<Array<{ name: string; count: number }>>([]);
  const [activeFolder, setActiveFolder] = useState<string>('all');
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [usedBytes, setUsedBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(10 * 1024 * 1024 * 1024);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Modals
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ all: '1', limit: '100' });
      if (activeFolder !== 'all') params.set('folder', activeFolder);
      if (q) params.set('q', q);
      const res = await apiFetch<{
        files: FileItem[];
        folders: Array<{ name: string; count: number }>;
        usedBytes: number;
        quotaBytes: number;
      }>(`/api/v1/storage/list?${params}`);
      setFiles(res.files);
      setFolders(res.folders);
      setUsedBytes(res.usedBytes);
      setQuotaBytes(res.quotaBytes);
    } catch (err: any) {
      toast('Failed to load storage', { description: err.message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [activeFolder, q, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const uploadFiles = async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (!arr.length) return;
    setUploading(true);
    const targetFolder = activeFolder === 'all' ? '' : activeFolder;
    let uploadedCount = 0;

    try {
      for (const f of arr) {
        const form = new FormData();
        if (targetFolder) form.append('folder', targetFolder);
        form.append('file', f, f.name);
        await apiFetch('/api/v1/storage/upload', { method: 'POST', rawBody: form });
        uploadedCount++;
      }
      toast(`Uploaded ${uploadedCount} file(s)`, {
        description: targetFolder ? `Folder: /${targetFolder}` : 'Root bucket',
        variant: 'success',
      });
      load();
    } catch (err: any) {
      toast('Upload error', { description: err.message, variant: 'error' });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleCopySignedUrl = async (file: FileItem) => {
    try {
      const res = await apiFetch<{ url: string }>(`/api/v1/storage/${file.id}/download`);
      await copyToClipboard(res.url);
      toast('Signed URL copied!', { description: 'Valid for 1 hour', variant: 'success' });
    } catch (err: any) {
      toast('Could not generate signed URL', { description: err.message, variant: 'error' });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch(`/api/v1/storage/${deleteTarget.id}`, { method: 'DELETE' });
      toast('File deleted', { description: deleteTarget.name, variant: 'success' });
      setDeleteTarget(null);
      load();
    } catch (err: any) {
      toast('Delete failed', { description: err.message, variant: 'error' });
    }
  };

  const mergedFolderNames = Array.from(new Set([...folders.map((f) => f.name), ...customFolders]));
  const usagePct = Math.min(100, quotaBytes > 0 ? (usedBytes / quotaBytes) * 100 : 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Object Storage</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            S3/MinIO-backed file bucket with folders, thumbnails & HMAC/presigned URLs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setFolderModalOpen(true)}>
            <FolderPlus className="h-4 w-4" /> New Folder
          </Button>
          <Button size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
            <UploadCloud className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload Files'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && uploadFiles(e.target.files)}
          />
        </div>
      </div>

      {/* Storage Usage Bar */}
      <Card className="p-5">
        <div className="flex items-center justify-between text-xs font-medium mb-2">
          <span>
            Storage Used: <strong className="text-slate-900 dark:text-white">{formatBytes(usedBytes)}</strong> of{' '}
            {formatBytes(quotaBytes)}
          </span>
          <span className="text-[#0066FF] font-semibold">{usagePct.toFixed(2)}%</span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#0066FF] to-cyan-400 transition-all duration-300"
            style={{ width: `${Math.max(usagePct, usedBytes > 0 ? 1.5 : 0)}%` }}
          />
        </div>
      </Card>

      {/* Drag & Drop Multi-file Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition-all',
          dragging
            ? 'border-[#0066FF] bg-[#0066FF]/10'
            : 'border-slate-300/80 hover:border-[#0066FF]/60 dark:border-slate-800 dark:hover:border-[#0066FF]/60 bg-white/50 dark:bg-[#0d1526]/60'
        )}
      >
        <UploadCloud className="h-8 w-8 mx-auto text-[#0066FF] mb-2" />
        <p className="text-sm font-medium">
          Drag & drop files here, or <span className="text-[#0066FF] underline">browse</span>
        </p>
        <p className="text-xs text-slate-400 mt-0.5">
          Uploading into:{' '}
          <span className="font-mono">{activeFolder === 'all' ? '/ (root)' : `/${activeFolder}`}</span>
        </p>
      </div>

      {/* Folder Pills + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveFolder('all')}
            className={cn(
              'px-3 py-1.5 rounded-xl text-xs font-medium transition-colors',
              activeFolder === 'all'
                ? 'bg-[#0066FF] text-white'
                : 'bg-white border border-slate-200 dark:bg-[#0d1526] dark:border-slate-800 text-slate-500'
            )}
          >
            All Files
          </button>
          {mergedFolderNames.map((fname) => (
            <button
              key={fname}
              onClick={() => setActiveFolder(fname)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors',
                activeFolder === fname
                  ? 'bg-[#0066FF] text-white'
                  : 'bg-white border border-slate-200 dark:bg-[#0d1526] dark:border-slate-800 text-slate-600 dark:text-slate-300'
              )}
            >
              <Folder className="h-3.5 w-3.5" /> /{fname}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input placeholder="Search files…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
      </div>

      {/* Files Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <Card className="p-12 text-center text-slate-400 text-sm">
          No files in this view yet. Drag & drop files above to upload.
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {files.map((f) => {
            const isImage = f.mime.startsWith('image/');
            return (
              <Card key={f.id} className="overflow-hidden flex flex-col group hover:border-[#0066FF]/50 transition-all">
                <div className="h-36 bg-slate-100 dark:bg-slate-900/90 flex items-center justify-center overflow-hidden relative">
                  {isImage && f.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.url} alt={f.name} className="h-full w-full object-cover" />
                  ) : isImage ? (
                    <ImageIcon className="h-10 w-10 text-slate-400" />
                  ) : (
                    <FileText className="h-10 w-10 text-[#0066FF]/70" />
                  )}
                  {f.folder && (
                    <Badge variant="blue" className="absolute top-2.5 left-2.5">
                      /{f.folder}
                    </Badge>
                  )}
                </div>
                <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                  <div>
                    <p className="font-semibold text-sm truncate" title={f.name}>
                      {f.name}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {formatBytes(f.size)} • {timeAgo(f.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/80">
                    <Button size="sm" variant="ghost" onClick={() => handleCopySignedUrl(f)} title="Copy signed URL">
                      <Link2 className="h-3.5 w-3.5" /> Signed URL
                    </Button>
                    <div className="flex items-center gap-1">
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                        title="Download"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                      <button
                        onClick={() => setDeleteTarget(f)}
                        className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10"
                        title="Delete file"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* New Folder Modal */}
      <Modal
        open={folderModalOpen}
        onClose={() => setFolderModalOpen(false)}
        title="Create Folder"
        description="Select a folder and upload files directly into it."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const clean = newFolderName.trim().replace(/^\/+|\/+$/g, '');
            if (clean) {
              setCustomFolders((prev) => Array.from(new Set([...prev, clean])));
              setActiveFolder(clean);
            }
            setNewFolderName('');
            setFolderModalOpen(false);
          }}
          className="space-y-4"
        >
          <Input
            required
            placeholder="e.g. avatars, invoices, public"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFolderModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Switch to Folder</Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete File?"
        description={`Permanently remove "${deleteTarget?.name}" from object storage?`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDelete}>
            Delete Permanently
          </Button>
        </div>
      </Modal>
    </div>
  );
}
