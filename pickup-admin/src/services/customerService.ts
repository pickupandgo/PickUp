// ============================================================
// PICK UP ADMIN PANEL — CUSTOMER SERVICE
// ============================================================
// All methods currently resolve from mock data.
// Replace the implementation bodies with real API calls when backend is ready.

import type { Customer, CustomerFilters, InternalNote } from '@/types/customer';
import { MOCK_CUSTOMERS } from '@/mock/customers';

const DELAY = 400;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// In-memory mutable copy (simulate backend state per session)
let customers: Customer[] = [...MOCK_CUSTOMERS];

// FUTURE: return apiClient.get('/admin/customers', { params })
export async function getCustomers(filters?: Partial<CustomerFilters>): Promise<Customer[]> {
  await delay(DELAY);
  let result = [...customers];

  if (filters?.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.id.toLowerCase().includes(q)
    );
  }
  if (filters?.status && filters.status !== 'all') {
    result = result.filter((c) => c.status === filters.status);
  }
  if (filters?.paymentStatus && filters.paymentStatus !== 'all') {
    result = result.filter((c) => c.paymentStatus === filters.paymentStatus);
  }

  return result;
}

// FUTURE: return apiClient.get(`/admin/customers/${id}`)
export async function getCustomerById(id: string): Promise<Customer | null> {
  await delay(DELAY);
  return customers.find((c) => c.id === id) ?? null;
}

// FUTURE: return apiClient.post(`/admin/customers/${id}/block`)
export async function blockCustomer(id: string): Promise<void> {
  await delay(DELAY);
  customers = customers.map((c) =>
    c.id === id ? { ...c, status: 'blocked' as const } : c
  );
}

// FUTURE: return apiClient.post(`/admin/customers/${id}/unblock`)
export async function unblockCustomer(id: string): Promise<void> {
  await delay(DELAY);
  customers = customers.map((c) =>
    c.id === id ? { ...c, status: 'active' as const } : c
  );
}

// FUTURE: return apiClient.post(`/admin/customers/${id}/notes`, { text })
export async function addCustomerNote(id: string, text: string, adminName: string): Promise<InternalNote> {
  await delay(DELAY);
  const note: InternalNote = {
    id: `N${Date.now()}`,
    text,
    addedBy: adminName,
    addedAt: new Date().toISOString().split('T')[0],
  };
  customers = customers.map((c) =>
    c.id === id ? { ...c, notes: [...c.notes, note] } : c
  );
  return note;
}
