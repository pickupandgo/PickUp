// ============================================================
// PICK UP ADMIN PANEL — DRIVER SERVICE
// ============================================================
import type { Driver, DriverFilters, DriverStatus } from '@/types/driver';
import { MOCK_DRIVERS } from '@/mock/drivers';

const DELAY = 400;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

let drivers: Driver[] = [...MOCK_DRIVERS];

// FUTURE: apiClient.get('/admin/drivers', { params })
export async function getDrivers(filters?: Partial<DriverFilters>): Promise<Driver[]> {
  await delay(DELAY);
  let result = [...drivers];

  if (filters?.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.phone.includes(q) ||
        d.id.toLowerCase().includes(q) ||
        d.vehicleNumber.toLowerCase().includes(q)
    );
  }
  if (filters?.status && filters.status !== 'all') {
    result = result.filter((d) => d.status === filters.status);
  }
  if (filters?.kycStatus && filters.kycStatus !== 'all') {
    result = result.filter((d) => d.kycStatus === filters.kycStatus);
  }
  if (filters?.eligibility && filters.eligibility !== 'all') {
    result = result.filter((d) => d.eligibility === filters.eligibility);
  }
  if (filters?.onlineStatus && filters.onlineStatus !== 'all') {
    result = result.filter((d) => d.onlineStatus === filters.onlineStatus);
  }
  if (filters?.vehicleCategory && filters.vehicleCategory !== 'all') {
    result = result.filter((d) => d.vehicleCategory === filters.vehicleCategory);
  }

  return result;
}

// FUTURE: apiClient.get(`/admin/drivers/${id}`)
export async function getDriverById(id: string): Promise<Driver | null> {
  await delay(DELAY);
  return drivers.find((d) => d.id === id) ?? null;
}

function updateDriverStatus(id: string, status: DriverStatus): void {
  drivers = drivers.map((d) => (d.id === id ? { ...d, status } : d));
}

// FUTURE: apiClient.post(`/admin/drivers/${id}/approve`)
export async function approveDriver(id: string): Promise<void> {
  await delay(DELAY);
  updateDriverStatus(id, 'approved');
}

// FUTURE: apiClient.post(`/admin/drivers/${id}/reject`)
export async function rejectDriver(id: string): Promise<void> {
  await delay(DELAY);
  updateDriverStatus(id, 'pending');
}

// FUTURE: apiClient.post(`/admin/drivers/${id}/suspend`)
export async function suspendDriver(id: string): Promise<void> {
  await delay(DELAY);
  updateDriverStatus(id, 'suspended');
  drivers = drivers.map((d) =>
    d.id === id
      ? { ...d, status: 'suspended', eligibility: 'ineligible', eligibilityReason: 'Account suspended by admin' }
      : d
  );
}

// FUTURE: apiClient.post(`/admin/drivers/${id}/block`)
export async function blockDriver(id: string): Promise<void> {
  await delay(DELAY);
  drivers = drivers.map((d) =>
    d.id === id
      ? { ...d, status: 'blocked', eligibility: 'ineligible', eligibilityReason: 'Account blocked by admin' }
      : d
  );
}

// FUTURE: apiClient.post(`/admin/drivers/${id}/unblock`)
export async function unblockDriver(id: string): Promise<void> {
  await delay(DELAY);
  updateDriverStatus(id, 'approved');
  drivers = drivers.map((d) =>
    d.id === id
      ? { ...d, status: 'approved', eligibility: 'eligible', eligibilityReason: undefined }
      : d
  );
}
