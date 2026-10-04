import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import DriverDetailPage from '@/features/drivers/DriverDetailPage';

export const metadata: Metadata = {
  title: 'Driver Detail — Pick Up Admin Panel',
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DriverDetailRoute({ params }: Props) {
  const { id } = await params;
  return <ProtectedRoute><DriverDetailPage driverId={id} /></ProtectedRoute>;
}
