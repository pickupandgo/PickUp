import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import KYCListPage from '@/features/kyc/KYCListPage';

export const metadata: Metadata = {
  title: 'KYC Verification — Pick Up Admin Panel',
  description: 'Review and verify driver KYC documents.',
};

export default function KYCRoute() {
  return <ProtectedRoute><KYCListPage /></ProtectedRoute>;
}
