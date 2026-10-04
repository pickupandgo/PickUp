import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import CustomersListPage from '@/features/customers/CustomersListPage';

export const metadata: Metadata = {
  title: 'Customers — Pick Up Admin Panel',
  description: 'Manage customer accounts for the Pick Up logistics platform.',
};

export default function CustomersRoute() {
  return <ProtectedRoute><CustomersListPage /></ProtectedRoute>;
}
