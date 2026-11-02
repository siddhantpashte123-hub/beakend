'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Users,
  FileJson,
  HardDrive,
  Activity,
  Plus,
  KeyRound,
  ScrollText,
  RefreshCw,
  Clock,
  Copy,
  Check,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, Skeleton, Modal, Input, useToast } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { formatBytes, formatUptime, timeAgo, copyToClipboard } from '@/lib/utils';

interface DashboardData {
  stats: {
    users: number;
    documents: number;
    collections: number;
    storageUsed: number;
    storageQuota: number;
    requestsToday: number;
    apiKeys: number;
    version: string;
    uptime: number;
    realtimeConnections: number;
  };
  requestsLast7Days: Array<{ date: string; label: string; requests: number }>;
  topCollections: Array<{ name: string; count: number }>;
  recentActivity: Array<{ id: string; type: string; actor: string; message: string; createdAt: string }>;
}

export default function DashboardPage() {
  const { toast } = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  // Quick-action modals
  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [createdConfig, setCreatedConfig] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const [newUserOpen, setNewUserOpen] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [userPassword, setUserPassword] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<DashboardData>('/api/v1/admin/stats');
      setData(res);
    } catch (err: any) {
      toast('Failed to load dashboard', { description: err.message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  const handleQuickCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/v1/admin/apikeys', {
        method: 'POST',
        body: { name: projectName },
      });
      setCreatedConfig(res.config);
      setProjectName('');
      toast('API Key created', { variant: 'success' });
      load();
    } catch (err: any) {
      toast('Failed to create API key', { description: err.message, variant: 'error' });
    }
  };

  const handleQuickCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/v1/admin/users', {
        method: 'POST',
        body: {
          email: userEmail,
          name: userName,
          ...(userPassword ? { password: userPassword } : {}),
        },
      });
      toast('User created', { description: userEmail, variant: 'success' });
      setNewUserOpen(false);
      setUserEmail('');
      setUserName('');
      setUserPassword('');
      load();
    } catch (err: any) {
      toast('Failed to create user', { description: err.message, variant: 'error' });
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  const s = data?.stats;

  const statCards = [
    {
      label: 'Total Users',
      value: (s?.users ?? 0).toLocaleString(),
      sub: `${s?.apiKeys ?? 0} active API key(s)`,
      icon: Users,
      accent: 'text-[#0066FF] bg-[#0066FF]/15',
    },
    {
      label: 'Total Documents',
      value: (s?.documents ?? 0).toLocaleString(),
      sub: `Across ${s?.collections ?? 0} collection(s)`,
      icon: FileJson,
      accent: 'text-emerald-500 bg-emerald-500/15',
    },
    {
      label: 'Storage Used',
      value: formatBytes(s?.storageUsed ?? 0),
      sub: `of ${formatBytes(s?.storageQuota ?? 10 * 1024 * 1024 * 1024)} quota`,
      icon: HardDrive,
      accent: 'text-violet-500 bg-violet-500/15',
    },
    {
      label: 'Requests Today',
      value: (s?.requestsToday ?? 0).toLocaleString(),
      sub: `Uptime ${formatUptime(s?.uptime ?? 0)} • ${s?.realtimeConnections ?? 0} live WS`,
      icon: Activity,
      accent: 'text-amber-500 bg-amber-500/15',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header + Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard Overview</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Real-time health, usage metrics, and activity for your BlueBeakend instance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              setCreatedConfig(null);
              setNewKeyOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" /> New API Key
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setNewUserOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New User
          </Button>
          <Link href="/logs">
            <Button size="sm" variant="outline">
              <ScrollText className="h-3.5 w-3.5" /> View Logs
            </Button>
          </Link>
          <Button size="sm" variant="ghost" onClick={load} title="Refresh metrics">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* 4 Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label} className="p-5 hover:border-[#0066FF]/40 transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {c.label}
                  </p>
                  <p className="mt-2 text-2xl font-bold tracking-tight">{c.value}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{c.sub}</p>
                </div>
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${c.accent}`}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <div>
              <CardTitle>API Requests — Last 7 Days</CardTitle>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Daily HTTP & SDK traffic processed by BlueBeakend
              </p>
            </div>
            <Badge variant="blue">7-Day Trend</Badge>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.requestsLast7Days || []} margin={{ top: 10, right: 12, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0066FF" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#0066FF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#1e293b',
                    borderRadius: '12px',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="requests"
                  stroke="#0066FF"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#reqGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <CardTitle>Top Collections</CardTitle>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Documents per collection</p>
            </div>
            <Link href="/database" className="text-xs text-[#0066FF] hover:underline font-medium">
              Explore →
            </Link>
          </CardHeader>
          <CardContent className="h-72">
            {data?.topCollections?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.topCollections} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={90}
                    tick={{ fontSize: 12, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#1e293b',
                      borderRadius: '12px',
                      color: '#f8fafc',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="count" fill="#0066FF" radius={[0, 8, 8, 0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-sm text-slate-400">
                <FileJson className="h-8 w-8 mb-2 opacity-50" />
                <p>No collections yet</p>
                <Link href="/database" className="text-xs text-[#0066FF] hover:underline mt-1">
                  Create your first collection →
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity Feed */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <CardTitle>Recent Activity</CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Last 10 platform events across Auth, DB & Storage</p>
          </div>
          <Badge>{data?.recentActivity?.length || 0} events</Badge>
        </CardHeader>
        <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {data?.recentActivity?.length ? (
            data.recentActivity.map((ev) => (
              <div key={ev.id} className="px-5 py-3.5 flex items-center justify-between gap-4 text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="h-2 w-2 rounded-full bg-[#0066FF] shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800 dark:text-slate-200 truncate">{ev.message}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      by <span className="font-mono">{ev.actor}</span> • <span className="font-mono">{ev.type}</span>
                    </p>
                  </div>
                </div>
                <span className="text-xs text-slate-400 shrink-0 flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {timeAgo(ev.createdAt)}
                </span>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-sm text-slate-400">No recent events recorded yet.</div>
          )}
        </div>
      </Card>

      {/* Quick Action Modal: New API Key */}
      <Modal
        open={newKeyOpen}
        onClose={() => setNewKeyOpen(false)}
        title="Create Project API Key"
        description="Generate a new bb_live_ key and Firebase-style SDK configuration."
      >
        {!createdConfig ? (
          <form onSubmit={handleQuickCreateKey} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1">Project Name</label>
              <Input
                required
                placeholder="e.g. my-flutter-app"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setNewKeyOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">
                <KeyRound className="h-4 w-4" /> Generate Key
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <pre className="p-4 rounded-xl bg-slate-950 text-emerald-400 text-xs font-mono overflow-x-auto border border-slate-800">
              {JSON.stringify(createdConfig, null, 2)}
            </pre>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  await copyToClipboard(JSON.stringify(createdConfig, null, 2));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied!' : 'Copy Config JSON'}
              </Button>
              <Button onClick={() => setNewKeyOpen(false)}>Done</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Quick Action Modal: New User */}
      <Modal
        open={newUserOpen}
        onClose={() => setNewUserOpen(false)}
        title="Create New User"
        description="Add an authenticated user directly to BlueBeakend Auth."
      >
        <form onSubmit={handleQuickCreateUser} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Email</label>
            <Input
              type="email"
              required
              placeholder="user@app.com"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Display Name</label>
            <Input placeholder="Optional name" value={userName} onChange={(e) => setUserName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Password (leave blank to auto-generate)</label>
            <Input
              type="password"
              minLength={6}
              placeholder="••••••••"
              value={userPassword}
              onChange={(e) => setUserPassword(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setNewUserOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create User</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
