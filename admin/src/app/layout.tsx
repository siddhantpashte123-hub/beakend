import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider, ToastProvider } from '@/components/ui';
import { Shell } from '@/components/Shell';

export const metadata: Metadata = {
  title: 'BlueBeakend Admin — Self-Hosted Firebase Alternative',
  description: 'Manage Auth, Document Database, Object Storage, API Keys, Realtime & Logs on your own VPS.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen font-sans">
        <ThemeProvider>
          <ToastProvider>
            <Shell>{children}</Shell>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
