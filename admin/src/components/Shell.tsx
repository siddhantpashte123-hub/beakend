'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Database,
  HardDrive,
  KeyRound,
  Radio,
  ScrollText,
  Settings,
  BookOpen,
  Sun,
  Moon,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  ExternalLink,
} from 'lucide-react';
import { BrandLogo, useTheme, Skeleton } from '@/components/ui';
import { getToken, getSavedUser, clearAuthSession, apiFetch, type AdminUser } from '@/lib/api';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/users', label: 'Auth / Users', icon: Users },
  { href: '/database', label: 'Database', icon: Database },
  { href: '/storage', label: 'Storage', icon: HardDrive },
  { href: '/apikeys', label: 'API Keys', icon: KeyRound },
  { href: '/realtime', label: 'Realtime', icon: Radio },
  { href: '/logs', label: 'Logs', icon: ScrollText },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/docs', label: 'Docs & SDKs', icon: BookOpen },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [ready, setReady] = useState(false);
  const [healthy, setHealthy] = useState(true);

  const isLoginPage = pathname === '/login' || pathname === '/login/';

  useEffect(() => {
    if (isLoginPage) {
      setReady(true);
      return;
    }
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    const cached = getSavedUser();
    if (cached) setUser(cached);
    setReady(true);

    apiFetch<{ user: AdminUser }>('/api/v1/admin/me')
      .then((res) => setUser(res.user))
      .catch(() => {});

    fetch('/health')
      .then((r) => setHealthy(r.ok))
      .catch(() => setHealthy(false));
  }, [isLoginPage, router]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#070d19]">
        <div className="space-y-3 w-64">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-2/3 mx-auto" />
        </div>
      </div>
    );
  }

  const handleLogout = () => {
    clearAuthSession();
    router.replace('/login');
  };

  const normalizedPath = pathname.replace(/\/+$/, '') || '/';

  const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => (
    <div className="flex flex-col h-full">
      <div className="h-16 px-4 flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800/80">
        <Link href="/" onClick={() => setMobileOpen(false)}>
          <BrandLogo collapsed={!mobile && collapsed} />
        </Link>
        {mobile && (
          <button onClick={() => setMobileOpen(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.href === '/' ? normalizedPath === '/' : normalizedPath.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              title={!mobile && collapsed ? item.label : undefined}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                active
                  ? 'bg-[#0066FF] text-white shadow-md shadow-[#0066FF]/25'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100',
                !mobile && collapsed && 'justify-center px-2'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {(mobile || !collapsed) && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-200/80 dark:border-slate-800/80 space-y-2">
        {(mobile || !collapsed) && (
          <a
            href="/docs"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/70"
          >
            <span>Swagger OpenAPI</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <button
          onClick={handleLogout}
          title="Sign out"
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400',
            !mobile && collapsed && 'justify-center px-2'
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {(mobile || !collapsed) && <span>Sign out</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#070d19]">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col shrink-0 border-r border-slate-200/80 bg-white dark:border-slate-800/90 dark:bg-[#0b1221] transition-all duration-200 sticky top-0 h-screen',
          collapsed ? 'w-[72px]' : 'w-60'
        )}
      >
        <SidebarContent />
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-64 max-w-[80vw] bg-white dark:bg-[#0b1221] h-full shadow-2xl z-10">
            <SidebarContent mobile />
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 px-4 sm:px-6 border-b border-slate-200/80 bg-white/80 dark:border-slate-800/90 dark:bg-[#0b1221]/80 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="hidden lg:inline-flex p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className={cn('h-2 w-2 rounded-full', healthy ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500')} />
              <span>{healthy ? 'All services healthy' : 'Degraded'}</span>
              <span className="text-slate-300 dark:text-slate-700">•</span>
              <span className="font-mono text-[11px]">v1.0.0</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-600 dark:border-slate-800 dark:hover:bg-slate-800 dark:text-slate-300"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {user && (
              <div className="flex items-center gap-2.5 pl-2 border-l border-slate-200 dark:border-slate-800">
                <div className="h-8 w-8 rounded-full bg-[#0066FF]/15 text-[#0066FF] dark:text-[#4d94ff] flex items-center justify-center text-xs font-bold uppercase">
                  {(user.name || user.email || 'A').slice(0, 1)}
                </div>
                <div className="hidden sm:block text-left leading-tight">
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[160px]">
                    {user.email}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-[#0066FF] dark:text-[#4d94ff] font-semibold">
                    Super Admin
                  </p>
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
