import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import SurchargesPage from '@/features/surcharges/SurchargesPage';

export const metadata: Metadata = {
  title: 'Surcharges — Pick Up Admin Panel',
};

export default function SurchargesRoute() {
  return <ProtectedRoute><SurchargesPage /></ProtectedRoute>;
}
