import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import BookingDetailPage from '@/features/bookings/BookingDetailPage';

export const metadata: Metadata = {
  title: 'Booking Detail — Pick Up Admin Panel',
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function BookingDetailRoute({ params }: Props) {
  const { id } = await params;
  return <ProtectedRoute><BookingDetailPage bookingId={id} /></ProtectedRoute>;
}
