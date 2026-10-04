// ============================================================
// PICK UP ADMIN PANEL — KYC SERVICE
// ============================================================
import type { KYCRecord, KYCFilters } from '@/types/kyc';
import { MOCK_KYC_RECORDS } from '@/mock/kyc';

const DELAY = 400;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

let kycRecords: KYCRecord[] = [...MOCK_KYC_RECORDS];

// FUTURE: apiClient.get('/admin/kyc', { params })
export async function getKYCRecords(filters?: Partial<KYCFilters>): Promise<KYCRecord[]> {
  await delay(DELAY);
  let result = [...kycRecords];

  if (filters?.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (r) =>
        r.driverName.toLowerCase().includes(q) ||
        r.driverId.toLowerCase().includes(q) ||
        r.vehicleNumber.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q)
    );
  }
  if (filters?.status && filters.status !== 'all') {
    result = result.filter((r) => r.status === filters.status);
  }

  return result;
}

// FUTURE: apiClient.get(`/admin/kyc/${id}`)
export async function getKYCById(id: string): Promise<KYCRecord | null> {
  await delay(DELAY);
  return kycRecords.find((r) => r.id === id) ?? null;
}

// FUTURE: apiClient.post(`/admin/kyc/${id}/approve`)
export async function approveKYC(id: string, adminName: string): Promise<void> {
  await delay(DELAY);
  kycRecords = kycRecords.map((r) =>
    r.id === id
      ? {
          ...r,
          status: 'approved',
          reviewedAt: new Date().toISOString().split('T')[0],
          reviewedBy: adminName,
          documents: r.documents.map((d) => ({ ...d, status: 'verified' as const, verifiedAt: new Date().toISOString().split('T')[0] })),
        }
      : r
  );
}

// FUTURE: apiClient.post(`/admin/kyc/${id}/reject`)
export async function rejectKYC(id: string, reason: string, adminName: string): Promise<void> {
  await delay(DELAY);
  kycRecords = kycRecords.map((r) =>
    r.id === id
      ? {
          ...r,
          status: 'rejected',
          rejectionReason: reason,
          reviewedAt: new Date().toISOString().split('T')[0],
          reviewedBy: adminName,
        }
      : r
  );
}

// FUTURE: apiClient.post(`/admin/kyc/${id}/request-correction`)
export async function requestKYCCorrection(id: string, reason: string): Promise<void> {
  await delay(DELAY);
  kycRecords = kycRecords.map((r) =>
    r.id === id
      ? { ...r, correctionRequested: true, rejectionReason: reason }
      : r
  );
}
