import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import VehicleCategoriesListPage from '@/features/vehicle-categories/VehicleCategoriesListPage';

export const metadata: Metadata = {
  title: 'Vehicle Categories — Pick Up Admin Panel',
};

export default function VehicleCategoriesRoute() {
  return <ProtectedRoute><VehicleCategoriesListPage /></ProtectedRoute>;
}
