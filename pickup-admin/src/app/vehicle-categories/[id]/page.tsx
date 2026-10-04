import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import VehicleCategoryDetailPage from '@/features/vehicle-categories/VehicleCategoryDetailPage';

export const metadata: Metadata = {
  title: 'Vehicle Category Detail — Pick Up Admin Panel',
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function VehicleCategoryDetailRoute({ params }: Props) {
  const { id } = await params;
  return <ProtectedRoute><VehicleCategoryDetailPage categoryId={id} /></ProtectedRoute>;
}
