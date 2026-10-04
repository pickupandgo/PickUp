import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import DriversListPage from '@/features/drivers/DriversListPage';

export const metadata: Metadata = {
  title: 'Drivers — Pick Up Admin Panel',
  description: 'Manage driver accounts, KYC, and eligibility.',
};

export default function DriversRoute() {
  return <ProtectedRoute><DriversListPage /></ProtectedRoute>;
}
