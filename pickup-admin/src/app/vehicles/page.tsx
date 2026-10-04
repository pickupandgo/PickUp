import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import VehiclesListPage from '@/features/vehicles/VehiclesListPage';

export const metadata: Metadata = {
  title: 'Vehicles — Pick Up Admin Panel',
  description: 'Manage fleet vehicles, verification, and operational status.',
};

export default function VehiclesRoute() {
  return <ProtectedRoute><VehiclesListPage /></ProtectedRoute>;
}
