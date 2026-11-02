'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Lock, Mail, ArrowRight, KeyRound } from 'lucide-react';
import { BrandLogo, Button, Input, Modal, useToast } from '@/components/ui';
import { apiFetch, setAuthSession, getToken, type AdminUser } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('admin@bluebeakend.local');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  // Forgot / Reset modal state
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('admin@bluebeakend.local');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [step, setStep] = useState<'request' | 'reset'>('request');

  useEffect(() => {
    if (getToken()) {
      router.replace('/');
      return;
    }
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tok = params.get('resetToken');
      if (tok) {
        setResetToken(tok);
        setStep('reset');
        setForgotOpen(true);
      }
    }
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiFetch<{ accessToken: string; user: AdminUser }>('/api/v1/admin/login', {
        method: 'POST',
        body: { email, password },
      });
      setAuthSession(res.accessToken, res.user);
      toast('Welcome back!', { description: `Signed in as ${res.user.email}`, variant: 'success' });
      router.replace('/');
    } catch (err: any) {
      toast('Sign-in failed', { description: err.message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleForgotRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/v1/admin/forgot-password', {
        method: 'POST',
        body: { email: forgotEmail },
      });
      toast('Reset link dispatched', {
        description: 'Check your SMTP inbox (or server logs if SMTP is not configured).',
        variant: 'success',
      });
      setStep('reset');
    } catch (err: any) {
      toast('Error', { description: err.message, variant: 'error' });
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/v1/admin/reset-password', {
        method: 'POST',
        body: { token: resetToken, newPassword },
      });
      toast('Password updated', { description: 'Sign in with your new password.', variant: 'success' });
      setForgotOpen(false);
      setPassword(newPassword);
    } catch (err: any) {
      toast('Reset failed', { description: err.message, variant: 'error' });
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-gradient-to-br from-[#020817] via-[#061a44] to-[#0066FF]">
      {/* Subtle ambient glow */}
      <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-[#0066FF]/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-cyan-400/20 blur-3xl" />

      <div className="relative w-full max-w-md rounded-3xl border border-white/15 bg-slate-950/85 backdrop-blur-xl p-8 shadow-2xl text-slate-100">
        <div className="flex flex-col items-center text-center mb-7">
          <BrandLogo size="lg" />
          <h1 className="mt-5 text-xl font-bold tracking-tight">Sign in to Admin Console</h1>
          <p className="mt-1 text-xs text-slate-400">
            Self-hosted Auth, Firestore-style DB, Storage & Realtime on your VPS
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Admin Email</label>
            <div className="relative">
              <Mail className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@bluebeakend.local"
                className="pl-9 h-10 bg-slate-900/90 border-slate-800 text-white"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-slate-300">Password</label>
              <button
                type="button"
                onClick={() => {
                  setForgotEmail(email || 'admin@bluebeakend.local');
                  setStep('request');
                  setForgotOpen(true);
                }}
                className="text-xs font-medium text-[#4d94ff] hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <Lock className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                type={showPwd ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                className="pl-9 pr-10 h-10 bg-slate-900/90 border-slate-800 text-white"
              />
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button type="submit" size="lg" disabled={loading} className="w-full mt-2">
            {loading ? 'Signing in…' : 'Sign in to Dashboard'}
            {!loading && <ArrowRight className="h-4 w-4" />}
          </Button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
          <span>Credentials saved in /opt/bluebeakend/credentials.txt</span>
          <a href="/docs" className="text-[#4d94ff] hover:underline font-medium">
            API Docs →
          </a>
        </div>
      </div>

      {/* Forgot / Reset Password Modal */}
      <Modal
        open={forgotOpen}
        onClose={() => setForgotOpen(false)}
        title={step === 'request' ? 'Reset Admin Password' : 'Enter Reset Token'}
        description={
          step === 'request'
            ? 'We will send a one-hour password reset token to your admin email.'
            : 'Paste the reset token from your email (or server logs) and choose a new password.'
        }
      >
        {step === 'request' ? (
          <form onSubmit={handleForgotRequest} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1">Admin Email</label>
              <Input type="email" required value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} />
            </div>
            <div className="flex justify-between items-center pt-2">
              <button type="button" onClick={() => setStep('reset')} className="text-xs text-[#0066FF] hover:underline">
                Already have a token?
              </button>
              <Button type="submit">Send Reset Link</Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleResetSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1">Reset Token</label>
              <div className="relative">
                <KeyRound className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  required
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  placeholder="48-character hex token"
                  className="pl-9 font-mono text-xs"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">New Password</label>
              <Input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setStep('request')}>
                Back
              </Button>
              <Button type="submit">Update Password</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
