'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { KeyRound, Plus, Copy, Check, Eye, EyeOff, Ban, Code2 } from 'lucide-react';
import { Card, Button, Input, Badge, Modal, Skeleton, useToast } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { formatDate, timeAgo, copyToClipboard } from '@/lib/utils';

interface ApiKeyItem {
  id: string;
  name: string;
  key: string;
  fullKey: string;
  live: boolean;
  status: 'active' | 'revoked';
  rateLimit: number | null;
  requestsCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  config: Record<string, string>;
}

export default function ApiKeysPage() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [rateLimit, setRateLimit] = useState('');
  const [liveMode, setLiveMode] = useState(true);

  // Config viewer modal
  const [configModal, setConfigModal] = useState<ApiKeyItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ apiKeys: ApiKeyItem[] }>('/api/v1/admin/apikeys');
      setKeys(res.apiKeys);
    } catch (err: any) {
      toast('Failed to load API keys', { description: err.message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/v1/admin/apikeys', {
        method: 'POST',
        body: {
          name: projectName,
          live: liveMode,
          ...(rateLimit ? { rateLimit: Number(rateLimit) } : {}),
        },
      });
      setCreateOpen(false);
      setProjectName('');
      setRateLimit('');
      await load();
      setConfigModal({
        id: res.id,
        name: res.name,
        key: res.apiKey,
        fullKey: res.apiKey,
        live: liveMode,
        status: 'active',
        rateLimit: null,
        requestsCount: 0,
        lastUsedAt: null,
        createdAt: res.createdAt,
        config: res.config,
      });
      toast('Project API key created!', { variant: 'success' });
    } catch (err: any) {
      toast('Create failed', { description: err.message, variant: 'error' });
    }
  };

  const getDisplayConfig = (cfg: Record<string, string>) => {
    if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
      return {
        ...cfg,
        ...(cfg.storageBucket ? { storageBucket: cfg.storageBucket.replace(/^http:\/\//i, 'https://') } : {}),
        ...(cfg.realtimeUrl ? { realtimeUrl: cfg.realtimeUrl.replace(/^ws:\/\//i, 'wss://') } : {}),
      };
    }
    return cfg;
  };

  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await apiFetch(`/api/v1/admin/apikeys/${revokeTarget.id}`, { method: 'DELETE' });
      toast('API Key revoked', { description: revokeTarget.name, variant: 'success' });
      setRevokeTarget(null);
      load();
    } catch (err: any) {
      toast('Revoke failed', { description: err.message, variant: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Project API Keys</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Generate Firebase-style SDK configurations and monitor per-key API usage.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Create New Key
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-3.5">Project Name</th>
                <th className="p-3.5">API Key</th>
                <th className="p-3.5">Requests</th>
                <th className="p-3.5">Created</th>
                <th className="p-3.5">Last Used</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {loading ? (
                [1, 2].map((i) => (
                  <tr key={i}>
                    <td colSpan={7} className="p-4">
                      <Skeleton className="h-8 w-full" />
                    </td>
                  </tr>
                ))
              ) : keys.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-slate-400">
                    No API keys yet.
                  </td>
                </tr>
              ) : (
                keys.map((k) => {
                  const isRevealed = Boolean(revealed[k.id]);
                  return (
                    <tr key={k.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30">
                      <td className="p-3.5 font-semibold flex items-center gap-2">
                        <KeyRound className="h-4 w-4 text-[#0066FF]" />
                        <span>{k.name}</span>
                      </td>
                      <td className="p-3.5 font-mono text-xs">
                        <div className="inline-flex items-center gap-1.5 bg-slate-100 dark:bg-slate-900 px-2.5 py-1 rounded-lg">
                          <span>{isRevealed ? k.fullKey : k.key}</span>
                          <button
                            onClick={() => setRevealed((r) => ({ ...r, [k.id]: !isRevealed }))}
                            className="text-slate-400 hover:text-slate-200"
                            title={isRevealed ? 'Hide key' : 'Reveal key'}
                          >
                            {isRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            onClick={async () => {
                              await copyToClipboard(k.fullKey);
                              setCopiedId(k.id);
                              setTimeout(() => setCopiedId(null), 1500);
                              toast('API key copied', { variant: 'success' });
                            }}
                            className="text-slate-400 hover:text-[#0066FF]"
                            title="Copy raw API key"
                          >
                            {copiedId === k.id ? (
                              <Check className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="p-3.5 font-mono text-xs">{(k.requestsCount || 0).toLocaleString()}</td>
                      <td className="p-3.5 text-xs text-slate-500">{formatDate(k.createdAt)}</td>
                      <td className="p-3.5 text-xs text-slate-500">{timeAgo(k.lastUsedAt)}</td>
                      <td className="p-3.5">
                        <Badge variant={k.status === 'active' ? 'success' : 'danger'}>{k.status}</Badge>
                      </td>
                      <td className="p-3.5 text-right whitespace-nowrap space-x-1">
                        <Button size="sm" variant="outline" onClick={() => setConfigModal(k)}>
                          <Code2 className="h-3.5 w-3.5" /> SDK Config
                        </Button>
                        {k.status === 'active' && (
                          <Button size="sm" variant="ghost" onClick={() => setRevokeTarget(k)} title="Revoke key">
                            <Ban className="h-4 w-4 text-red-500" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create Key Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Project API Key"
        description="Use separate keys per Flutter, Web, or Python application."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Project Name *</label>
            <Input
              required
              placeholder="my-flutter-app"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Environment</label>
              <select
                value={liveMode ? 'live' : 'test'}
                onChange={(e) => setLiveMode(e.target.value === 'live')}
                className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="live">Production (bb_live_…)</option>
                <option value="test">Sandbox (bb_test_…)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Custom Rate Limit (RPM)</label>
              <Input
                type="number"
                min={10}
                placeholder="Default (600)"
                value={rateLimit}
                onChange={(e) => setRateLimit(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Generate Key</Button>
          </div>
        </form>
      </Modal>

      {/* Firebase-Style Config Modal */}
      <Modal
        open={Boolean(configModal)}
        onClose={() => setConfigModal(null)}
        title={`Firebase-Style SDK Config — ${configModal?.name || ''}`}
        description="Drop this JSON straight into @bluebeakend/js, Flutter, or Python."
        maxWidth="max-w-xl"
      >
        {configModal && (
          <div className="space-y-4">
            <pre className="p-4 rounded-xl bg-slate-950 text-emerald-400 text-xs font-mono overflow-x-auto border border-slate-800">
              {JSON.stringify(getDisplayConfig(configModal.config), null, 2)}
            </pre>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  await copyToClipboard(JSON.stringify(getDisplayConfig(configModal.config), null, 2));
                  toast('Config JSON copied to clipboard!', { variant: 'success' });
                }}
              >
                <Copy className="h-4 w-4" /> Copy Config JSON
              </Button>
              <Button onClick={() => setConfigModal(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Revoke Confirm Modal */}
      <Modal
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        title="Revoke API Key?"
        description={`Apps using "${revokeTarget?.name}" will immediately receive 403 Forbidden.`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRevokeTarget(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmRevoke}>
            Revoke Key
          </Button>
        </div>
      </Modal>
    </div>
  );
}
