import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import CustomerDetailPage from '@/features/customers/CustomerDetailPage';

export const metadata: Metadata = {
  title: 'Customer Detail — Pick Up Admin Panel',
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CustomerDetailRoute({ params }: Props) {
  const { id } = await params;
  return <ProtectedRoute><CustomerDetailPage customerId={id} /></ProtectedRoute>;
}
