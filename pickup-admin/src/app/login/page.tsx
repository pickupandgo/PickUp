import type { Metadata } from 'next';
import LoginPage from '@/features/auth/LoginPage';

export const metadata: Metadata = {
  title: 'Sign In — Pick Up Admin Panel',
  description: 'Admin sign in for the Pick Up logistics management platform.',
};

export default function LoginRoute() {
  return <LoginPage />;
}
