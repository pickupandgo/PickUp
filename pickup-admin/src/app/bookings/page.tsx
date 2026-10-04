import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import BookingsListPage from '@/features/bookings/BookingsListPage';

export const metadata: Metadata = {
  title: 'Bookings — Pick Up Admin Panel',
};

export default function BookingsRoute() {
  return <ProtectedRoute><BookingsListPage /></ProtectedRoute>;
}
