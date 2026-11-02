'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { X, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Theme Provider (default: dark) ────────────────────────────
type Theme = 'dark' | 'light';
const ThemeCtx = createContext<{ theme: Theme; toggleTheme: () => void }>({
  theme: 'dark',
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const saved = (localStorage.getItem('bb_theme') as Theme | null) || 'dark';
    setTheme(saved);
    document.documentElement.classList.toggle('dark', saved === 'dark');
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('bb_theme', next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      return next;
    });
  }, []);

  return <ThemeCtx.Provider value={{ theme, toggleTheme }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

// ── Toast Notifications ───────────────────────────────────────
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'error';
}

const ToastCtx = createContext<{
  toast: (title: string, opts?: { description?: string; variant?: 'default' | 'success' | 'error' }) => void;
}>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback(
    (title: string, opts?: { description?: string; variant?: 'default' | 'success' | 'error' }) => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { id, title, ...opts }]);
      setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    },
    []
  );

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-xl border p-3.5 shadow-xl backdrop-blur-md transition-all',
              'bg-white/95 border-slate-200 text-slate-900 dark:bg-slate-900/95 dark:border-slate-800 dark:text-slate-100',
              item.variant === 'error' && 'border-red-500/40 dark:border-red-500/40',
              item.variant === 'success' && 'border-emerald-500/40 dark:border-emerald-500/40'
            )}
          >
            {item.variant === 'error' ? (
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            ) : item.variant === 'success' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
            ) : (
              <Info className="h-5 w-5 text-[#0066FF] shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight">{item.title}</p>
              {item.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 break-words">{item.description}</p>
              )}
            </div>
            <button
              onClick={() => setItems((prev) => prev.filter((t) => t.id !== item.id))}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ── Brand Logo ────────────────────────────────────────────────
export function BrandLogo({ collapsed = false, size = 'md' }: { collapsed?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-11 w-11 rounded-2xl' : size === 'sm' ? 'h-7 w-7 rounded-lg' : 'h-9 w-9 rounded-xl';
  return (
    <div className="flex items-center gap-2.5 select-none">
      <div
        className={cn(
          box,
          'bg-gradient-to-br from-[#0066FF] to-[#00A3FF] flex items-center justify-center shadow-lg shadow-[#0066FF]/25 shrink-0'
        )}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M12 3L4 8v8l8 5 8-5V8l-8-5z" />
          <path d="M12 12l8-4M12 12v9M12 12L4 8" />
        </svg>
      </div>
      {!collapsed && (
        <div className="leading-none">
          <span className={cn('font-bold tracking-tight', size === 'lg' ? 'text-xl' : 'text-base')}>
            Blue<span className="text-[#0066FF]">Beakend</span>
          </span>
          <span className="block text-[10px] font-medium uppercase tracking-wider text-slate-400 mt-0.5">
            Self-Hosted BaaS
          </span>
        </div>
      )}
    </div>
  );
}

// ── shadcn/ui Primitives ──────────────────────────────────────
export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800/90 dark:bg-[#0d1526]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4 border-b border-slate-100 dark:border-slate-800/80', className)}>{children}</div>;
}

export function CardTitle({ className, children }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100', className)}>{children}</h3>;
}

export function CardContent({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  const variants = {
    primary: 'bg-[#0066FF] hover:bg-[#0052CC] text-white shadow-sm shadow-[#0066FF]/20',
    secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-900 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100',
    outline: 'border border-slate-200 hover:bg-slate-50 text-slate-700 dark:border-slate-700 dark:hover:bg-slate-800/70 dark:text-slate-200',
    ghost: 'hover:bg-slate-100 text-slate-600 dark:hover:bg-slate-800/70 dark:text-slate-300',
    danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm shadow-red-600/20',
  };
  const sizes = {
    sm: 'h-8 px-3 text-xs rounded-lg gap-1.5',
    md: 'h-9 px-4 text-sm rounded-xl gap-2',
    lg: 'h-11 px-5 text-sm rounded-xl gap-2',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0066FF]/50 focus:border-[#0066FF] dark:border-slate-700/90 dark:bg-slate-900/80 dark:text-slate-100 dark:placeholder:text-slate-500',
        className
      )}
      {...props}
    />
  );
}

export function Badge({
  variant = 'default',
  className,
  children,
}: {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'blue';
  className?: string;
  children: React.ReactNode;
}) {
  const styles = {
    default: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    danger: 'bg-red-500/15 text-red-600 dark:text-red-400',
    blue: 'bg-[#0066FF]/15 text-[#0066FF] dark:text-[#4d94ff]',
  };
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', styles[variant], className)}>
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/80', className)} />;
}

export function Switch({ checked, onChange }: { checked: boolean; onChange: (val: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
        checked ? 'bg-[#0066FF]' : 'bg-slate-300 dark:bg-slate-700'
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition',
          checked ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  maxWidth = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div
        className={cn(
          'w-full rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#0d1526] overflow-hidden',
          maxWidth
        )}
      >
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            {description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
