'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Save, Mail, Shield, Archive, AlertOctagon, RotateCcw, Plus } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Switch, Badge, useToast } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { cn, formatBytes, formatDate } from '@/lib/utils';

type TabKey = 'general' | 'smtp' | 'security' | 'backup' | 'danger';

export default function SettingsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<TabKey>('general');
  const [saving, setSaving] = useState(false);

  // Settings form
  const [siteName, setSiteName] = useState('BlueBeakend');
  const [logoUrl, setLogoUrl] = useState('');
  const [domain, setDomain] = useState('localhost');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('BlueBeakend <no-reply@bluebeakend.local>');
  const [testEmailTo, setTestEmailTo] = useState('admin@bluebeakend.local');

  const [rateLimitRpm, setRateLimitRpm] = useState(600);
  const [maxStorageGb, setMaxStorageGb] = useState(10);
  const [enableSignups, setEnableSignups] = useState(true);
  const [corsOrigins, setCorsOrigins] = useState('*');
  const [ipWhitelist, setIpWhitelist] = useState('');
  const [autoBackupSchedule, setAutoBackupSchedule] = useState<'off' | 'daily' | 'weekly'>('daily');

  // Backups
  const [backups, setBackups] = useState<Array<{ name: string; size: number; createdAt: string }>>([]);

  // Danger confirmations
  const [resetConfirm, setResetConfirm] = useState('');
  const [purgeConfirm, setPurgeConfirm] = useState('');

  const load = useCallback(async () => {
    try {
      const [sRes, bRes] = await Promise.all([
        apiFetch<{ settings: any }>('/api/v1/admin/settings'),
        apiFetch<{ backups: any[] }>('/api/v1/admin/backups'),
      ]);
      const s = sRes.settings;
      setSiteName(s.siteName || 'BlueBeakend');
      setLogoUrl(s.logoUrl || '');
      setDomain(s.domain || 'localhost');
      setSmtpHost(s.smtpHost || '');
      setSmtpPort(Number(s.smtpPort) || 587);
      setSmtpUser(s.smtpUser || '');
      setSmtpPass(s.smtpPass || '');
      setSmtpFrom(s.smtpFrom || '');
      setRateLimitRpm(Number(s.rateLimitRpm) || 600);
      setMaxStorageGb(Math.max(1, Math.round((Number(s.maxStorageBytes) || 10737418240) / (1024 * 1024 * 1024))));
      setEnableSignups(s.enableSignups !== false);
      setCorsOrigins(s.corsOrigins || '*');
      setIpWhitelist(s.ipWhitelist || '');
      setAutoBackupSchedule(s.autoBackupSchedule || 'daily');
      setBackups(bRes.backups || []);
    } catch (err: any) {
      toast('Failed to load settings', { description: err.message, variant: 'error' });
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const saveSettings = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/v1/admin/settings', {
        method: 'PATCH',
        body: {
          siteName,
          logoUrl,
          domain,
          smtpHost,
          smtpPort: Number(smtpPort),
          smtpUser,
          smtpPass,
          smtpFrom,
          rateLimitRpm: Number(rateLimitRpm),
          maxStorageBytes: Number(maxStorageGb) * 1024 * 1024 * 1024,
          enableSignups,
          corsOrigins,
          ipWhitelist,
          autoBackupSchedule,
        },
      });
      toast('Settings saved', { variant: 'success' });
    } catch (err: any) {
      toast('Save failed', { description: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    try {
      const res = await apiFetch<{ delivered: boolean; preview?: any; error?: string }>('/api/v1/admin/settings/test-email', {
        method: 'POST',
        body: { to: testEmailTo },
      });
      toast(res.delivered ? 'Test email delivered via SMTP!' : 'Captured in dev outbox (no SMTP host set)', {
        description: res.error || `Recipient: ${testEmailTo}`,
        variant: res.error ? 'error' : 'success',
      });
    } catch (err: any) {
      toast('Test email failed', { description: err.message, variant: 'error' });
    }
  };

  const handleCreateBackup = async () => {
    try {
      await apiFetch('/api/v1/admin/backups', { method: 'POST' });
      toast('Snapshot backup created!', { variant: 'success' });
      load();
    } catch (err: any) {
      toast('Backup failed', { description: err.message, variant: 'error' });
    }
  };

  const handleRestoreBackup = async (name: string) => {
    if (!confirm(`Restore snapshot "${name}"? Existing documents with matching IDs will be overwritten.`)) return;
    try {
      await apiFetch(`/api/v1/admin/backups/${encodeURIComponent(name)}/restore`, { method: 'POST' });
      toast('Backup restored!', { description: name, variant: 'success' });
    } catch (err: any) {
      toast('Restore failed', { description: err.message, variant: 'error' });
    }
  };

  const handleDangerReset = async () => {
    try {
      await apiFetch('/api/v1/admin/danger/reset', {
        method: 'POST',
        body: { confirm: resetConfirm },
      });
      setResetConfirm('');
      toast('All document collections reset', { variant: 'success' });
    } catch (err: any) {
      toast('Confirmation mismatch', { description: 'Type DELETE ALL DATA exactly', variant: 'error' });
    }
  };

  const handleDangerPurge = async () => {
    try {
      await apiFetch('/api/v1/admin/danger/delete-all', {
        method: 'POST',
        body: { confirm: purgeConfirm },
      });
      setPurgeConfirm('');
      toast('Instance purged', { variant: 'success' });
    } catch (err: any) {
      toast('Confirmation mismatch', { description: 'Type DELETE EVERYTHING exactly', variant: 'error' });
    }
  };

  const tabs: Array<{ id: TabKey; label: string; icon: any }> = [
    { id: 'general', label: 'General', icon: Save },
    { id: 'smtp', label: 'SMTP Mail', icon: Mail },
    { id: 'security', label: 'Security & Limits', icon: Shield },
    { id: 'backup', label: 'Backups', icon: Archive },
    { id: 'danger', label: 'Danger Zone', icon: AlertOctagon },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Platform Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Configure branding, SMTP delivery, security limits, automated backups, and recovery.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors',
                tab === t.id
                  ? t.id === 'danger'
                    ? 'bg-red-600 text-white'
                    : 'bg-[#0066FF] text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              )}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'general' && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>General Instance Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveSettings} className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1">Site / Project Name</label>
                <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Custom Logo URL (optional)</label>
                <Input placeholder="https://…" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Public Domain</label>
                <Input placeholder="api.myapp.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
                <p className="text-[11px] text-slate-400 mt-1">
                  Tip: Use <code className="text-[#0066FF]">bb</code> → [9] Domain &amp; SSL on your VPS to auto-provision Let&apos;s Encrypt HTTPS.
                </p>
              </div>
              <Button type="submit" disabled={saving}>
                <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save General Settings'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {tab === 'smtp' && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>SMTP Transactional Email (Password Resets & Verification)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={saveSettings} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium mb-1">SMTP Host</label>
                  <Input placeholder="smtp.resend.com / smtp.gmail.com" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Port</label>
                  <Input type="number" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">SMTP Username</label>
                  <Input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">SMTP Password</label>
                  <Input type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">From Address</label>
                <Input value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} />
              </div>
              <Button type="submit" disabled={saving}>
                <Save className="h-4 w-4" /> Save SMTP Settings
              </Button>
            </form>

            <div className="pt-5 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <label className="block text-xs font-semibold">Send Test Email</label>
              <div className="flex gap-2">
                <Input value={testEmailTo} onChange={(e) => setTestEmailTo(e.target.value)} placeholder="you@domain.com" />
                <Button type="button" variant="secondary" onClick={handleTestEmail}>
                  <Mail className="h-4 w-4" /> Send Test
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'security' && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Security, Rate Limits & Quotas</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveSettings} className="space-y-5">
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/70">
                <div>
                  <p className="text-sm font-medium">Allow New User Signups</p>
                  <p className="text-xs text-slate-400">Toggle public /api/v1/auth/register endpoint</p>
                </div>
                <Switch checked={enableSignups} onChange={setEnableSignups} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Global Rate Limit (requests / minute)</label>
                  <Input type="number" min={10} value={rateLimitRpm} onChange={(e) => setRateLimitRpm(Number(e.target.value))} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Storage Quota (GB)</label>
                  <Input type="number" min={1} value={maxStorageGb} onChange={(e) => setMaxStorageGb(Number(e.target.value))} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">CORS Allowed Origins (comma-separated or *)</label>
                <Input value={corsOrigins} onChange={(e) => setCorsOrigins(e.target.value)} placeholder="https://myapp.com, https://staging.myapp.com" />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">IP Allowlist (optional, comma-separated)</label>
                <Input value={ipWhitelist} onChange={(e) => setIpWhitelist(e.target.value)} placeholder="Leave empty to allow all IPs" />
              </div>

              <Button type="submit" disabled={saving}>
                <Save className="h-4 w-4" /> Save Security Settings
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {tab === 'backup' && (
        <div className="space-y-6 max-w-3xl">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <CardTitle>Automated Backup Schedule</CardTitle>
                <p className="text-xs text-slate-400 mt-0.5">Snapshots stored in /opt/bluebeakend/backups</p>
              </div>
              <Button size="sm" onClick={handleCreateBackup}>
                <Plus className="h-4 w-4" /> Create Backup Now
              </Button>
            </CardHeader>
            <CardContent className="flex items-center gap-3">
              <select
                value={autoBackupSchedule}
                onChange={(e) => setAutoBackupSchedule(e.target.value as any)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="daily">Daily (03:00 UTC)</option>
                <option value="weekly">Weekly (Sunday 03:00 UTC)</option>
                <option value="off">Disabled</option>
              </select>
              <Button size="sm" variant="secondary" onClick={() => saveSettings()}>
                Save Schedule
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Available Backups ({backups.length})</CardTitle>
            </CardHeader>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {backups.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400">
                  No backups created yet. Click &quot;Create Backup Now&quot; above.
                </div>
              ) : (
                backups.map((b) => (
                  <div key={b.name} className="px-5 py-3.5 flex items-center justify-between text-sm">
                    <div>
                      <p className="font-mono text-xs font-semibold">{b.name}</p>
                      <p className="text-xs text-slate-400">
                        {formatBytes(b.size)} • {formatDate(b.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="success">Verified</Badge>
                      <Button size="sm" variant="outline" onClick={() => handleRestoreBackup(b.name)}>
                        <RotateCcw className="h-3.5 w-3.5" /> Restore
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      {tab === 'danger' && (
        <div className="space-y-4 max-w-2xl">
          <Card className="border-red-500/40 dark:border-red-500/40">
            <CardHeader>
              <CardTitle className="text-red-500">Reset Document Database</CardTitle>
              <p className="text-xs text-slate-400 mt-0.5">
                Drops all document collections while keeping users, API keys, and storage intact.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs">
                Type <code className="font-mono font-bold text-red-500">DELETE ALL DATA</code> to confirm:
              </p>
              <div className="flex gap-2">
                <Input value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} placeholder="DELETE ALL DATA" />
                <Button variant="danger" disabled={resetConfirm !== 'DELETE ALL DATA'} onClick={handleDangerReset}>
                  Reset Collections
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-red-500/40 dark:border-red-500/40">
            <CardHeader>
              <CardTitle className="text-red-500">Purge Entire Instance</CardTitle>
              <p className="text-xs text-slate-400 mt-0.5">
                Deletes all collections, uploaded files, and non-admin user accounts permanently.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs">
                Type <code className="font-mono font-bold text-red-500">DELETE EVERYTHING</code> to confirm:
              </p>
              <div className="flex gap-2">
                <Input value={purgeConfirm} onChange={(e) => setPurgeConfirm(e.target.value)} placeholder="DELETE EVERYTHING" />
                <Button variant="danger" disabled={purgeConfirm !== 'DELETE EVERYTHING'} onClick={handleDangerPurge}>
                  Delete All
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
