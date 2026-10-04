import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import ReportsPage from '@/features/reports/ReportsPage';

export const metadata: Metadata = {
  title: 'Reports — Pick Up Admin Panel',
};

export default function ReportsRoute() {
  return <ProtectedRoute><ReportsPage /></ProtectedRoute>;
}
