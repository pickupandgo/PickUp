import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import DashboardPage from '@/features/dashboard/DashboardPage';

export const metadata: Metadata = {
  title: 'Dashboard — Pick Up Admin Panel',
  description: 'Pick Up platform operations overview dashboard.',
};

export default function DashboardRoute() {
  return (
    <ProtectedRoute>
      <DashboardPage />
    </ProtectedRoute>
  );
}
