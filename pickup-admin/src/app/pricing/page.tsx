import type { Metadata } from 'next';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import PricingPage from '@/features/pricing/PricingPage';

export const metadata: Metadata = {
  title: 'Fare & Pricing — Pick Up Admin Panel',
};

export default function PricingRoute() {
  return <ProtectedRoute><PricingPage /></ProtectedRoute>;
}
