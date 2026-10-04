import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import CancellationRulesPage from '@/features/cancellation-rules/CancellationRulesPage';

export const metadata: Metadata = {
  title: 'Cancellation Rules — Pick Up Admin Panel',
};

export default function CancellationRulesRoute() {
  return <ProtectedRoute><CancellationRulesPage /></ProtectedRoute>;
}
