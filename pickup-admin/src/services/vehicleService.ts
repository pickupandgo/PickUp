// ============================================================
// PICK UP ADMIN PANEL — VEHICLE SERVICE
// ============================================================
import type { Vehicle, VehicleFilters } from '@/types/vehicle';
import { MOCK_VEHICLES } from '@/mock/vehicles';

const DELAY = 400;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

let vehicles: Vehicle[] = [...MOCK_VEHICLES];

// FUTURE: apiClient.get('/admin/vehicles', { params })
export async function getVehicles(filters?: Partial<VehicleFilters>): Promise<Vehicle[]> {
  await delay(DELAY);
  let result = [...vehicles];

  if (filters?.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (v) =>
        v.registrationNumber.toLowerCase().includes(q) ||
        v.driverName.toLowerCase().includes(q) ||
        v.category.toLowerCase().includes(q) ||
        v.id.toLowerCase().includes(q)
    );
  }
  if (filters?.category && filters.category !== 'all') {
    result = result.filter((v) => v.category === filters.category);
  }
  if (filters?.verificationStatus && filters.verificationStatus !== 'all') {
    result = result.filter((v) => v.verificationStatus === filters.verificationStatus);
  }
  if (filters?.operationalStatus && filters.operationalStatus !== 'all') {
    result = result.filter((v) => v.operationalStatus === filters.operationalStatus);
  }

  return result;
}

// FUTURE: apiClient.get(`/admin/vehicles/${id}`)
export async function getVehicleById(id: string): Promise<Vehicle | null> {
  await delay(DELAY);
  return vehicles.find((v) => v.id === id) ?? null;
}

// FUTURE: apiClient.post(`/admin/vehicles/${id}/approve`)
export async function approveVehicle(id: string, adminName: string): Promise<void> {
  await delay(DELAY);
  vehicles = vehicles.map((v) =>
    v.id === id
      ? {
          ...v,
          verificationStatus: 'approved',
          operationalStatus: 'enabled',
          verifiedAt: new Date().toISOString().split('T')[0],
          verifiedBy: adminName,
        }
      : v
  );
}

// FUTURE: apiClient.post(`/admin/vehicles/${id}/reject`)
export async function rejectVehicle(id: string): Promise<void> {
  await delay(DELAY);
  vehicles = vehicles.map((v) =>
    v.id === id ? { ...v, verificationStatus: 'rejected', operationalStatus: 'disabled' } : v
  );
}

// FUTURE: apiClient.post(`/admin/vehicles/${id}/enable`)
export async function enableVehicle(id: string): Promise<void> {
  await delay(DELAY);
  vehicles = vehicles.map((v) =>
    v.id === id ? { ...v, operationalStatus: 'enabled' } : v
  );
}

// FUTURE: apiClient.post(`/admin/vehicles/${id}/disable`)
export async function disableVehicle(id: string): Promise<void> {
  await delay(DELAY);
  vehicles = vehicles.map((v) =>
    v.id === id ? { ...v, operationalStatus: 'disabled' } : v
  );
}
