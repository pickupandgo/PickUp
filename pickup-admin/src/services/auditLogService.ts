import { AuditLog, AuditAction, AuditEntityType } from '@/types/auditLog';
import { MOCK_AUDIT_LOGS } from '@/mock/auditLogs';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let logs = [...MOCK_AUDIT_LOGS];

export async function getAuditLogs(filters?: {
  search?: string;
  admin?: string;
  action?: AuditAction | 'all';
  entityType?: AuditEntityType | 'all';
}): Promise<AuditLog[]> {
  await delay(300);
  
  let result = [...logs];
  
  if (filters) {
    if (filters.action && filters.action !== 'all') {
      result = result.filter(l => l.action === filters.action);
    }
    if (filters.entityType && filters.entityType !== 'all') {
      result = result.filter(l => l.entityType === filters.entityType);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(l => 
        l.entityId.toLowerCase().includes(q) || 
        l.adminEmail.toLowerCase().includes(q) ||
        l.summary.toLowerCase().includes(q)
      );
    }
  }
  
  return result;
}

export async function logAction(log: Omit<AuditLog, 'id' | 'timestamp' | 'adminEmail'>): Promise<void> {
  // Mock internal function to add logs when actions happen across the app
  const newLog: AuditLog = {
    ...log,
    id: `AUD-${Math.floor(Math.random() * 100000)}`,
    timestamp: new Date().toISOString(),
    adminEmail: 'admin@pickupjodhpur.in'
  };
  logs.unshift(newLog);
}
