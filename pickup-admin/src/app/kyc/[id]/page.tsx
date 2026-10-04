import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import KYCDetailPage from '@/features/kyc/KYCDetailPage';

export const metadata: Metadata = {
  title: 'KYC Review — Pick Up Admin Panel',
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function KYCDetailRoute({ params }: Props) {
  const { id } = await params;
  return <ProtectedRoute><KYCDetailPage kycId={id} /></ProtectedRoute>;
}
