'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Loader } from '@/components/ui/Loader/Loader';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * ProtectedRoute — wraps pages that require authentication.
 * Redirects unauthenticated users to /login.
 * Shows a loading state while rehydrating session.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return <Loader fullPage label="Loading..." />;
  }

  if (!isAuthenticated) {
    // Will redirect via effect — show nothing
    return null;
  }

  return <>{children}</>;
}
