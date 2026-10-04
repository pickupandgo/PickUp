import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import AuditLogsPage from '@/features/auditLogs/AuditLogsPage';

export const metadata: Metadata = {
  title: 'Audit Logs — Pick Up Admin Panel',
};

export default function AuditLogsRoute() {
  return <ProtectedRoute><AuditLogsPage /></ProtectedRoute>;
}
