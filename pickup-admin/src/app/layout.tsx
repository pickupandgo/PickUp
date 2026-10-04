import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { Toaster } from 'react-hot-toast';

export const metadata: Metadata = {
  title: 'Pick Up — Admin Panel',
  description: 'Operations and management dashboard for the Pick Up logistics platform, Jodhpur, Rajasthan.',
  robots: 'noindex, nofollow', // Admin panel should not be indexed
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                fontFamily: 'var(--font-family)',
                fontSize: 'var(--font-size-sm)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg)',
                maxWidth: '380px',
              },
              success: {
                style: {
                  background: 'var(--color-success-50)',
                  border: '1px solid var(--color-success-100)',
                  color: 'var(--color-success-700)',
                },
                iconTheme: { primary: 'var(--color-success-600)', secondary: '#fff' },
              },
              error: {
                style: {
                  background: 'var(--color-danger-50)',
                  border: '1px solid var(--color-danger-100)',
                  color: 'var(--color-danger-700)',
                },
                iconTheme: { primary: 'var(--color-danger-600)', secondary: '#fff' },
              },
            }}
          />
        </AuthProvider>
      </body>
    </html>
  );
}
