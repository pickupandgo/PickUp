import { LiveTrip, LiveDriver, LiveOperationsData } from '@/types/live';
import { getBookings } from './bookingService';
import { getDrivers } from './driverService';

// We maintain a singleton state for the frontend simulation to update.
let cachedData: LiveOperationsData | null = null;

const JODHPUR_CENTER = { lat: 26.2809, lng: 73.0227 };

function generateRandomOffset(base: number, range: number) {
  return base + (Math.random() - 0.5) * range;
}

export async function fetchInitialLiveData(): Promise<LiveOperationsData> {
  const allBookings = await getBookings();
  const allDrivers = await getDrivers();

  const activeBookings = allBookings.filter(b => ['Searching Driver', 'Driver Assigned', 'Driver Arrived', 'Pickup Completed', 'In Transit', 'Partially Delivered'].includes(b.status));

  const activeTrips: LiveTrip[] = activeBookings.map((b, i) => ({
    bookingId: b.id,
    driverId: b.driverId || `DRV-UNASSIGNED-${i}`,
    driverName: b.driverName || 'Searching...',
    vehicleRegistrationNumber: b.vehicleRegistrationNumber || 'N/A',
    vehicleCategoryName: b.vehicleCategoryName,
    customerId: b.customerId,
    customerName: b.customerName,
    status: b.status,
    pickup: {
      address: b.pickup.address,
      lat: generateRandomOffset(JODHPUR_CENTER.lat, 0.05),
      lng: generateRandomOffset(JODHPUR_CENTER.lng, 0.05)
    },
    drops: b.drops,
    currentLocation: {
      address: 'Near Paota Circle',
      lat: generateRandomOffset(JODHPUR_CENTER.lat, 0.04),
      lng: generateRandomOffset(JODHPUR_CENTER.lng, 0.04)
    },
    lastUpdate: new Date().toISOString()
  }));

  const onlineDrivers: LiveDriver[] = allDrivers.slice(0, 8).map(d => ({
    id: d.id,
    name: d.name,
    vehicleId: d.vehicleId || 'V-000',
    vehicleRegistrationNumber: 'RJ19XYZ', // mock
    status: Math.random() > 0.5 ? 'On Trip' : 'Available',
    currentLocation: {
      address: 'Jodhpur Area',
      lat: generateRandomOffset(JODHPUR_CENTER.lat, 0.06),
      lng: generateRandomOffset(JODHPUR_CENTER.lng, 0.06)
    },
    lastUpdate: new Date().toISOString()
  }));

  cachedData = { activeTrips, onlineDrivers };
  return cachedData;
}

export function getCachedLiveData(): LiveOperationsData | null {
  return cachedData;
}

// Mutates the cache to simulate movement/updates
export function simulateRealtimeTick(): LiveOperationsData | null {
  if (!cachedData) return null;
  
  const now = new Date().toISOString();
  
  // Slightly move trips
  cachedData.activeTrips = cachedData.activeTrips.map(t => {
    // 50% chance to update location and timestamp
    if (Math.random() > 0.5) {
      return {
        ...t,
        lastUpdate: now,
        currentLocation: {
          ...t.currentLocation,
          lat: t.currentLocation.lat + (Math.random() - 0.5) * 0.002,
          lng: t.currentLocation.lng + (Math.random() - 0.5) * 0.002,
        }
      };
    }
    return t;
  });

  // Slightly move drivers
  cachedData.onlineDrivers = cachedData.onlineDrivers.map(d => {
    if (Math.random() > 0.7) {
      return {
        ...d,
        lastUpdate: now,
        currentLocation: {
          ...d.currentLocation,
          lat: d.currentLocation.lat + (Math.random() - 0.5) * 0.003,
          lng: d.currentLocation.lng + (Math.random() - 0.5) * 0.003,
        }
      };
    }
    return d;
  });

  return { ...cachedData }; // return new reference to trigger react render
}
