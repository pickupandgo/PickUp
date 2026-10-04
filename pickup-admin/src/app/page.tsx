import { redirect } from 'next/navigation';

/**
 * Root route "/" — redirect to /dashboard.
 * The ProtectedRoute guard on /dashboard will redirect
 * unauthenticated users to /login automatically.
 */
export default function RootPage() {
  redirect('/dashboard');
}
