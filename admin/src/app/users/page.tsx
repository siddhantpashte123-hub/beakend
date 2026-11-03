'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Search,
  Plus,
  Ban,
  CheckCircle,
  Trash2,
  Download,
  X,
  KeyRound,
  Shield,
  Laptop,
} from 'lucide-react';
import { Card, Button, Input, Badge, Modal, Skeleton, useToast } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { formatDate, timeAgo, formatBytes } from '@/lib/utils';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  status: 'active' | 'banned';
  emailVerified: boolean;
  provider: string;
  metadata: Record<string, any>;
  lastLoginAt: string | null;
  createdAt: string;
}

export default function UsersPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Create user modal
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');

  // Detail drawer state
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [metaText, setMetaText] = useState('{}');
  const [resetPwd, setResetPwd] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (q) params.set('q', q);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await apiFetch<{ users: UserRow[]; total: number }>(`/api/v1/admin/users?${params}`);
      setUsers(res.users);
      setTotal(res.total);
    } catch (err: any) {
      toast('Failed to fetch users', { description: err.message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [q, statusFilter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (id: string) => {
    setDetailId(id);
    setDetailData(null);
    try {
      const res = await apiFetch(`/api/v1/admin/users/${id}`);
      setDetailData(res);
      setMetaText(JSON.stringify(res.user.metadata || {}, null, 2));
    } catch (err: any) {
      toast('Error loading user detail', { description: err.message, variant: 'error' });
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ user: UserRow; temporaryPassword?: string }>('/api/v1/admin/users', {
        method: 'POST',
        body: {
          email: newEmail,
          name: newName,
          role: newRole,
          ...(newPassword ? { password: newPassword } : {}),
        },
      });
      toast('User created', {
        description: res.temporaryPassword ? `Temporary password: ${res.temporaryPassword}` : res.user.email,
        variant: 'success',
      });
      setCreateOpen(false);
      setNewEmail('');
      setNewName('');
      setNewPassword('');
      load();
    } catch (err: any) {
      toast('Create failed', { description: err.message, variant: 'error' });
    }
  };

  const toggleBan = async (u: UserRow) => {
    const next = u.status === 'active' ? 'banned' : 'active';
    try {
      await apiFetch(`/api/v1/admin/users/${u.id}`, { method: 'PATCH', body: { status: next } });
      toast(`User ${next === 'banned' ? 'banned' : 'unbanned'}`, { description: u.email, variant: 'success' });
      load();
      if (detailId === u.id) openDetail(u.id);
    } catch (err: any) {
      toast('Action failed', { description: err.message, variant: 'error' });
    }
  };

  const deleteUser = async (u: UserRow) => {
    if (!confirm(`Delete user ${u.email}? This action cannot be undone.`)) return;
    try {
      await apiFetch(`/api/v1/admin/users/${u.id}`, { method: 'DELETE' });
      toast('User deleted', { description: u.email, variant: 'success' });
      if (detailId === u.id) setDetailId(null);
      load();
    } catch (err: any) {
      toast('Delete failed', { description: err.message, variant: 'error' });
    }
  };

  const handleBulk = async (action: 'ban' | 'unban' | 'delete') => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (action === 'delete' && !confirm(`Delete ${ids.length} selected user(s)?`)) return;
    try {
      const res = await apiFetch<{ affected: number }>('/api/v1/admin/users/bulk', {
        method: 'POST',
        body: { action, ids },
      });
      toast(`Bulk ${action} complete`, { description: `${res.affected} user(s) updated`, variant: 'success' });
      setSelected(new Set());
      load();
    } catch (err: any) {
      toast('Bulk action failed', { description: err.message, variant: 'error' });
    }
  };

  const exportCsv = () => {
    const rows = [
      ['id', 'email', 'name', 'provider', 'role', 'status', 'createdAt', 'lastLoginAt'],
      ...users.map((u) => [u.id, u.email, u.name, u.provider, u.role, u.status, u.createdAt, u.lastLoginAt || '']),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bluebeakend-users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveMeta = async () => {
    if (!detailId) return;
    try {
      const parsed = JSON.parse(metaText);
      await apiFetch(`/api/v1/admin/users/${detailId}`, { method: 'PATCH', body: { metadata: parsed } });
      toast('Metadata saved', { variant: 'success' });
      openDetail(detailId);
      load();
    } catch (err: any) {
      toast('Invalid JSON or save failed', { description: err.message, variant: 'error' });
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailId || !resetPwd) return;
    try {
      await apiFetch(`/api/v1/admin/users/${detailId}`, { method: 'PATCH', body: { password: resetPwd } });
      setResetPwd('');
      toast('Password reset & sessions revoked', { variant: 'success' });
      openDetail(detailId);
    } catch (err: any) {
      toast('Password reset failed', { description: err.message, variant: 'error' });
    }
  };

  const allSelected = users.length > 0 && selected.size === users.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Auth & Users</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {total} registered user(s) • Manage accounts, sessions, roles, and metadata
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Create User
          </Button>
        </div>
      </div>

      {/* Search, Filter & Bulk Actions */}
      <Card className="p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              placeholder="Search by email or name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="banned">Banned</option>
          </select>
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">{selected.size} selected:</span>
            <Button size="sm" variant="outline" onClick={() => handleBulk('ban')}>
              Ban
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleBulk('unban')}>
              Unban
            </Button>
            <Button size="sm" variant="danger" onClick={() => handleBulk('delete')}>
              Delete
            </Button>
          </div>
        )}
      </Card>

      {/* Users Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="p-3.5 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(users.map((u) => u.id)) : new Set())
                    }
                    className="rounded"
                  />
                </th>
                <th className="p-3.5">Email</th>
                <th className="p-3.5">Provider</th>
                <th className="p-3.5">Created</th>
                <th className="p-3.5">Last Login</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {loading ? (
                [1, 2, 3].map((i) => (
                  <tr key={i}>
                    <td colSpan={7} className="p-4">
                      <Skeleton className="h-8 w-full" />
                    </td>
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-slate-400">
                    No matching users found.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => openDetail(u.id)}
                    className="hover:bg-slate-50/90 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                  >
                    <td className="p-3.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(u.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(u.id);
                          else next.delete(u.id);
                          setSelected(next);
                        }}
                        className="rounded"
                      />
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-full bg-[#0066FF]/15 text-[#0066FF] dark:text-[#4d94ff] flex items-center justify-center text-xs font-bold uppercase shrink-0">
                          {(u.name || u.email).slice(0, 1)}
                        </div>
                        <div>
                          <div className="font-medium flex items-center gap-1.5">
                            <span>{u.email}</span>
                            {u.role === 'admin' && (
                              <Badge variant="blue" className="text-[10px]">
                                Admin
                              </Badge>
                            )}
                          </div>
                          {u.name && <p className="text-xs text-slate-400">{u.name}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="p-3.5 capitalize">
                      <Badge>{u.provider}</Badge>
                    </td>
                    <td className="p-3.5 text-xs text-slate-500 dark:text-slate-400">{formatDate(u.createdAt)}</td>
                    <td className="p-3.5 text-xs text-slate-500 dark:text-slate-400">{timeAgo(u.lastLoginAt)}</td>
                    <td className="p-3.5">
                      <Badge variant={u.status === 'active' ? 'success' : 'danger'}>{u.status}</Badge>
                    </td>
                    <td className="p-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title={u.status === 'active' ? 'Ban user' : 'Unban user'}
                          onClick={() => toggleBan(u)}
                        >
                          {u.status === 'active' ? (
                            <Ban className="h-4 w-4 text-amber-500" />
                          ) : (
                            <CheckCircle className="h-4 w-4 text-emerald-500" />
                          )}
                        </Button>
                        <Button size="sm" variant="ghost" title="Delete user" onClick={() => deleteUser(u)}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create User Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create User"
        description="Provision a new user account in BlueBeakend Auth."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Email *</label>
            <Input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="user@domain.com" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Name</label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Password</label>
              <Input
                type="password"
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Auto-generate if empty"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as 'user' | 'admin')}
                className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create User</Button>
          </div>
        </form>
      </Modal>

      {/* User Detail Slide-over Drawer */}
      {detailId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-xl bg-white dark:bg-[#0d1526] h-full shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold">{detailData?.user?.email || 'Loading user…'}</h2>
                <p className="text-xs text-slate-400 font-mono">{detailId}</p>
              </div>
              <button onClick={() => setDetailId(null)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            {!detailData ? (
              <div className="p-6 space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Summary badges */}
                <div className="flex flex-wrap gap-2">
                  <Badge variant={detailData.user.status === 'active' ? 'success' : 'danger'}>
                    {detailData.user.status}
                  </Badge>
                  <Badge variant="blue">
                    <Shield className="h-3 w-3 mr-1" /> {detailData.user.role}
                  </Badge>
                  <Badge>Provider: {detailData.user.provider}</Badge>
                  <Badge>Storage: {formatBytes(detailData.storageUsed || 0)}</Badge>
                </div>

                {/* Reset Password */}
                <form onSubmit={handleResetPassword} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <label className="text-xs font-semibold flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5 text-[#0066FF]" /> Reset User Password
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      minLength={6}
                      placeholder="New password (min 6 chars)"
                      value={resetPwd}
                      onChange={(e) => setResetPwd(e.target.value)}
                    />
                    <Button type="submit" size="sm">
                      Set Password
                    </Button>
                  </div>
                </form>

                {/* Editable Metadata */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      User Metadata (JSON)
                    </label>
                    <Button size="sm" variant="secondary" onClick={handleSaveMeta}>
                      Save Metadata
                    </Button>
                  </div>
                  <textarea
                    rows={5}
                    value={metaText}
                    onChange={(e) => setMetaText(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#0066FF]"
                  />
                </div>

                {/* Active Sessions */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Active Sessions ({detailData.sessions?.length || 0})
                  </h3>
                  {detailData.sessions?.length ? (
                    <div className="space-y-2">
                      {detailData.sessions.map((s: any) => (
                        <div
                          key={s.id}
                          className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Laptop className="h-4 w-4 text-slate-400 shrink-0" />
                            <div className="truncate">
                              <p className="font-medium truncate">{s.userAgent || 'API / SDK Client'}</p>
                              <p className="text-slate-400">
                                IP {s.ip || 'local'} • Created {timeAgo(s.createdAt)}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">No active refresh sessions.</p>
                  )}
                </div>

                {/* Recent Activity */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">User Activity</h3>
                  {detailData.activity?.length ? (
                    <div className="space-y-1.5">
                      {detailData.activity.map((ev: any) => (
                        <div
                          key={ev.id}
                          className="px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between text-xs"
                        >
                          <span>{ev.message}</span>
                          <span className="text-slate-400 shrink-0 ml-2">{timeAgo(ev.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">No recorded events for this user.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
