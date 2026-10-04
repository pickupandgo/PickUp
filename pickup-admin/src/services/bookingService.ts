import type { Booking, BookingStatus, BookingNote } from '@/types/booking';
import { MOCK_BOOKINGS } from '@/mock/bookings';
import { getDriverById } from './driverService';
import { getVehicleById } from './vehicleService';

const DELAY = 300;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

let bookings = [...MOCK_BOOKINGS];

export async function getBookings(filters?: {
  search?: string;
  status?: BookingStatus | 'all';
  paymentStatus?: string | 'all';
}): Promise<Booking[]> {
  await delay(DELAY);
  let result = [...bookings];

  if (filters) {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(b => 
        b.id.toLowerCase().includes(q) ||
        b.customerName.toLowerCase().includes(q) ||
        b.customerPhone.includes(q) ||
        b.driverName?.toLowerCase().includes(q) ||
        b.vehicleRegistrationNumber?.toLowerCase().includes(q)
      );
    }
    if (filters.status && filters.status !== 'all') {
      result = result.filter(b => b.status === filters.status);
    }
    if (filters.paymentStatus && filters.paymentStatus !== 'all') {
      result = result.filter(b => b.payment.status === filters.paymentStatus);
    }
  }

  // Sort newest first
  return result.sort((a, b) => new Date(b.bookingDate).getTime() - new Date(a.bookingDate).getTime());
}

export async function getBookingById(id: string): Promise<Booking | null> {
  await delay(DELAY);
  return bookings.find(b => b.id === id) ?? null;
}

export async function reassignDriver(bookingId: string, driverId: string): Promise<void> {
  await delay(DELAY);
  const driver = await getDriverById(driverId);
  const vehicle = driver ? await getVehicleById(driver.vehicleId!) : null;

  bookings = bookings.map(b => {
    if (b.id === bookingId && driver && vehicle) {
      return {
        ...b,
        driverId: driver.id,
        driverName: driver.name,
        driverPhone: driver.phone,
        vehicleId: vehicle.id,
        vehicleRegistrationNumber: vehicle.registrationNumber,
        status: b.status === 'Pending' || b.status === 'Searching Driver' ? 'Driver Assigned' : b.status,
        timeline: [
          ...b.timeline,
          { id: `T-${Date.now()}`, status: 'Driver Assigned', timestamp: new Date().toISOString(), description: `Reassigned to ${driver.name}` }
        ]
      };
    }
    return b;
  });
}

export async function cancelBooking(bookingId: string, reason: string, adminNote?: string): Promise<void> {
  await delay(DELAY);
  bookings = bookings.map(b => {
    if (b.id === bookingId) {
      return {
        ...b,
        status: 'Cancelled',
        cancellation: {
          status: 'Cancelled',
          cancelledBy: 'Admin',
          reason,
          charge: 0,
          timestamp: new Date().toISOString(),
          adminNote
        },
        timeline: [
          ...b.timeline,
          { id: `T-${Date.now()}`, status: 'Cancelled', timestamp: new Date().toISOString(), description: `Admin Cancellation: ${reason}` }
        ]
      };
    }
    return b;
  });
}

export async function updateBookingStatus(bookingId: string, status: BookingStatus): Promise<void> {
  await delay(DELAY);
  bookings = bookings.map(b => {
    if (b.id === bookingId) {
      return {
        ...b,
        status,
        timeline: [
          ...b.timeline,
          { id: `T-${Date.now()}`, status, timestamp: new Date().toISOString(), description: `Status manually updated to ${status}` }
        ]
      };
    }
    return b;
  });
}

export async function addInternalNote(bookingId: string, text: string, adminName: string): Promise<void> {
  await delay(DELAY);
  bookings = bookings.map(b => {
    if (b.id === bookingId) {
      const newNote: BookingNote = {
        id: `N-${Date.now()}`,
        text,
        addedBy: adminName,
        timestamp: new Date().toISOString()
      };
      return { ...b, notes: [newNote, ...b.notes] };
    }
    return b;
  });
}
