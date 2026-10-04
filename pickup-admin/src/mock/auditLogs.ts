import { AuditLog } from '@/types/auditLog';

export const MOCK_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'AUD-001',
    timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    adminEmail: 'admin@pickupjodhpur.in',
    action: 'Driver Reassigned',
    entityType: 'Booking',
    entityId: 'BKG-1002',
    summary: 'Reassigned driver from DRV-001 to DRV-004',
    previousValue: 'DRV-001',
    newValue: 'DRV-004',
    reason: 'Vehicle broke down'
  },
  {
    id: 'AUD-002',
    timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    adminEmail: 'ops@pickupjodhpur.in',
    action: 'Booking Cancelled',
    entityType: 'Booking',
    entityId: 'BKG-1005',
    summary: 'Exceptionally cancelled trip BKG-1005',
    reason: 'Customer requested via support'
  },
  {
    id: 'AUD-003',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    adminEmail: 'admin@pickupjodhpur.in',
    action: 'Fare Changed',
    entityType: 'Pricing',
    entityId: 'TATA_ACE',
    summary: 'Updated base fare for Tata Ace',
    previousValue: '₹25/km',
    newValue: '₹28/km',
    reason: 'Business pricing update'
  },
  {
    id: 'AUD-004',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    adminEmail: 'support@pickupjodhpur.in',
    action: 'Driver Approved',
    entityType: 'Driver',
    entityId: 'DRV-003',
    summary: 'Approved KYC and onboarded driver',
  },
  {
    id: 'AUD-005',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    adminEmail: 'finance@pickupjodhpur.in',
    action: 'Wallet Adjusted',
    entityType: 'Wallet',
    entityId: 'DRV-002',
    summary: 'Credited manual bonus',
    newValue: '+₹500',
    reason: 'Diwali performance bonus'
  }
];
