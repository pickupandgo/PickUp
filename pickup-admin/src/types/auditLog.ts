export type AuditAction = 
  | 'Driver Approved' 
  | 'Driver Blocked' 
  | 'Customer Unblocked' 
  | 'Vehicle Approved' 
  | 'Wallet Adjusted' 
  | 'Fare Changed' 
  | 'Booking Cancelled' 
  | 'Driver Reassigned'
  | 'Settings Updated';

export type AuditEntityType = 'Driver' | 'Customer' | 'Vehicle' | 'Booking' | 'Wallet' | 'Pricing' | 'System';

export interface AuditLog {
  id: string;
  timestamp: string;
  adminEmail: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  summary: string;
  previousValue?: string;
  newValue?: string;
  reason?: string;
}
