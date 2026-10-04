import { DashboardSummary } from '@/types/dashboard';
import { getBookings } from './bookingService';
import { getDrivers } from './driverService';
import { getCustomers } from './customerService';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function getDashboardSummary(dateFilter: string = 'Today'): Promise<DashboardSummary> {
  await delay(300);

  // In a real app, dateFilter would be passed to the backend or applied to the DB query.
  // For mock, we'll just pull the data and calculate metrics statically or lightly filtered.
  const bookings = await getBookings();
  const drivers = await getDrivers();
  const customers = await getCustomers();

  const totalBookings = bookings.length;
  const activeTrips = bookings.filter(b => ['Searching Driver', 'Driver Assigned', 'Driver Arrived', 'Pickup Completed', 'In Transit', 'Partially Delivered'].includes(b.status)).length;
  const cancelledTrips = bookings.filter(b => b.status === 'Cancelled').length;

  const totalCustomers = customers.length;
  
  const onlineDrivers = drivers.filter(d => d.status === 'approved').length; // Mocking mapping approved -> online
  const activeDrivers = Math.floor(onlineDrivers * 0.7); // Mock active drivers

  const revenue = bookings.reduce((sum, b) => b.status === 'Completed' ? sum + b.fare.totalFare : sum, 0) + 12500; // Added base value to make it look realistic
  const platformCommission = bookings.reduce((sum, b) => b.status === 'Completed' ? sum + (b.fare.platformCommission || 0) : sum, 0) + 1250;

  const recentBookings = bookings.slice(0, 5).map(b => ({
    id: b.id,
    customerName: b.customerName,
    vehicleCategoryName: b.vehicleCategoryName,
    totalFare: b.fare.totalFare,
    status: b.status,
    date: b.bookingDate,
  }));

  const recentCancellations = bookings
    .filter(b => b.status === 'Cancelled' && b.cancellation)
    .slice(0, 5)
    .map(b => ({
      id: b.id,
      customerName: b.customerName,
      driverName: b.driverName,
      reason: b.cancellation!.reason,
      date: b.cancellation!.timestamp,
      charge: b.cancellation!.charge,
    }));

  return {
    metrics: {
      totalBookings: totalBookings + 145, // Add offset for demo
      activeTrips,
      onlineDrivers: onlineDrivers + 24,
      activeDrivers,
      totalCustomers: totalCustomers + 560,
      cancelledTrips: cancelledTrips + 12,
      revenue,
      platformCommission,
      trends: {
        totalBookings: 12, // +12%
        revenue: 8, // +8%
      }
    },
    recentBookings,
    recentCancellations
  };
}
