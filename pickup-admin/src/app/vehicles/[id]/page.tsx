import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import VehicleDetailPage from '@/features/vehicles/VehicleDetailPage';

export const metadata: Metadata = {
  title: 'Vehicle Detail — Pick Up Admin Panel',
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function VehicleDetailRoute({ params }: Props) {
  const { id } = await params;
  return <ProtectedRoute><VehicleDetailPage vehicleId={id} /></ProtectedRoute>;
}
