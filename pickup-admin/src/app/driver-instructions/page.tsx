import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import DriverInstructionsPage from '@/features/driverInstructions/DriverInstructionsPage';

export const metadata: Metadata = {
  title: 'Driver Instructions — Pick Up Admin Panel',
};

export default function DriverInstructionsRoute() {
  return <ProtectedRoute><DriverInstructionsPage /></ProtectedRoute>;
}
