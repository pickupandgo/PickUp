import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import CommissionPage from '@/features/commission/CommissionPage';

export const metadata: Metadata = {
  title: 'Commission — Pick Up Admin Panel',
};

export default function CommissionRoute() {
  return <ProtectedRoute><CommissionPage /></ProtectedRoute>;
}
