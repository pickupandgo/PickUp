import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import LiveTripsPage from '@/features/live/LiveTripsPage';

export const metadata: Metadata = {
  title: 'Live Trips — Pick Up Admin Panel',
};

export default function LiveTripsRoute() {
  return <ProtectedRoute><LiveTripsPage /></ProtectedRoute>;
}
