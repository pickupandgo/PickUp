import { getBookings } from './bookingService';
import { getDrivers } from './driverService';
import { getCustomers } from './customerService';

import { BaseReportData, ReportType } from '@/types/report';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function generateReport(type: ReportType, dateRange: string): Promise<BaseReportData> {
  await delay(500); // Simulate processing time
  
  const allBookings = await getBookings();
  
  switch(type) {
    case 'bookings': {
      const rows = allBookings.map(b => [
        b.id,
        new Date(b.bookingDate).toLocaleDateString(),
        b.customerName,
        b.driverName || 'N/A',
        b.vehicleRegistrationNumber || 'N/A',
        b.vehicleCategoryName,
        `${b.drops.length} drop(s)`,
        `₹${b.fare.totalFare}`,
        b.payment.status,
        b.status
      ]);
      
      const completed = allBookings.filter(b => b.status === 'Completed').length;
      const cancelled = allBookings.filter(b => b.status === 'Cancelled').length;
      
      return {
        headers: ['Booking ID', 'Date', 'Customer', 'Driver', 'Vehicle', 'Category', 'Drops', 'Fare', 'Payment', 'Status'],
        rows,
        summary: [
          { label: 'Total Bookings', value: allBookings.length },
          { label: 'Completed', value: completed },
          { label: 'Cancelled', value: cancelled },
        ]
      };
    }
    case 'cancellations': {
      const cancellations = allBookings.filter(b => b.status === 'Cancelled' && b.cancellation);
      const rows = cancellations.map(b => [
        b.id,
        new Date(b.cancellation!.timestamp).toLocaleDateString(),
        b.customerName,
        b.driverName || 'N/A',
        b.cancellation!.cancelledBy,
        b.cancellation!.reason,
        `₹${b.cancellation!.charge}`,
        `₹${b.fare.totalFare}`,
        b.status
      ]);
      
      const totalCharge = cancellations.reduce((sum, b) => sum + (b.cancellation?.charge || 0), 0);
      
      return {
        headers: ['Booking ID', 'Date', 'Customer', 'Driver', 'Cancelled By', 'Reason', 'Charge', 'Trip Value', 'Status'],
        rows,
        summary: [
          { label: 'Total Cancellations', value: cancellations.length },
          { label: 'Driver Cancellations', value: cancellations.filter(c => c.cancellation!.cancelledBy === 'Driver').length },
          { label: 'Customer Cancellations', value: cancellations.filter(c => c.cancellation!.cancelledBy === 'Customer').length },
          { label: 'Total Cancellation Charges', value: `₹${totalCharge}` },
        ]
      };
    }
    case 'drivers': {
      const drivers = await getDrivers();
      const rows = drivers.map(d => {
        const dBookings = allBookings.filter(b => b.driverId === d.id);
        const completed = dBookings.filter(b => b.status === 'Completed').length;
        const cancelled = dBookings.filter(b => b.status === 'Cancelled').length;
        
        return [
          d.name,
          d.id,
          'RJ19...', // mock
          'Tata Ace', // mock
          dBookings.length,
          completed,
          cancelled,
          d.status,
          'Eligible' // mock
        ];
      });
      
      return {
        headers: ['Driver', 'ID', 'Vehicle Number', 'Category', 'Total Trips', 'Completed Trips', 'Cancelled Trips', 'Status', 'Eligibility'],
        rows,
        summary: [
          { label: 'Total Drivers', value: drivers.length },
          { label: 'Approved Drivers', value: drivers.filter(d => d.status === 'approved').length },
        ]
      };
    }
    case 'revenue': {
      const completed = allBookings.filter(b => b.status === 'Completed');
      const rows = completed.map(b => [
        b.id,
        new Date(b.bookingDate).toLocaleDateString(),
        `₹${b.fare.totalFare}`,
        `₹${b.fare.platformCommission || 0}`,
        `₹${b.fare.insurancePremium || 0}`,
        `₹${b.fare.totalFare - (b.fare.platformCommission || 0)}` // driver earnings
      ]);
      
      const totalRevenue = completed.reduce((sum, b) => sum + b.fare.totalFare, 0);
      const totalComm = completed.reduce((sum, b) => sum + (b.fare.platformCommission || 0), 0);
      
      return {
        headers: ['Booking ID', 'Date', 'Total Fare', 'Commission', 'Insurance', 'Driver Earnings'],
        rows,
        summary: [
          { label: 'Total Booking Value', value: `₹${totalRevenue}` },
          { label: 'Platform Commission', value: `₹${totalComm}` },
          { label: 'Driver Earnings', value: `₹${totalRevenue - totalComm}` },
        ]
      };
    }
    case 'commission': {
      const completed = allBookings.filter(b => b.status === 'Completed' && b.fare.platformCommission);
      const rows = completed.map(b => [
        b.id,
        b.driverName || 'N/A',
        b.vehicleCategoryName,
        `₹${b.fare.totalFare}`,
        '10%', // mock rate
        `₹${b.fare.platformCommission}`,
        new Date(b.bookingDate).toLocaleDateString()
      ]);
      
      const totalComm = completed.reduce((sum, b) => sum + (b.fare.platformCommission || 0), 0);
      
      return {
        headers: ['Booking ID', 'Driver', 'Category', 'Fare', 'Comm. Rate', 'Comm. Amount', 'Date'],
        rows,
        summary: [
          { label: 'Commission Events', value: completed.length },
          { label: 'Total Commission', value: `₹${totalComm}` },
        ]
      };
    }
    case 'payments': {
      const rows = allBookings.map(b => [
        b.payment.referenceId || `PAY-${b.id}`,
        b.customerName,
        b.driverName || 'N/A',
        b.payment.method,
        `₹${b.fare.totalFare}`,
        `₹${b.fare.insurancePremium || 0}`,
        `₹${b.fare.platformCommission || 0}`,
        b.payment.status,
        new Date(b.bookingDate).toLocaleDateString()
      ]);
      
      return {
        headers: ['Payment ID', 'Customer', 'Driver', 'Method', 'Total Fare', 'Insurance', 'Commission', 'Status', 'Date'],
        rows,
        summary: [
          { label: 'Total Transactions', value: allBookings.length },
          { label: 'Completed Payments', value: allBookings.filter(b => b.payment.status === 'Completed').length },
        ]
      };
    }
    // Simple fallbacks for vehicles/wallet
    case 'vehicles':
    case 'wallet':
    default:
      return {
        headers: ['Data', 'Status'],
        rows: [['Report type not fully implemented in mock', 'N/A']],
        summary: [{ label: 'Status', value: 'Draft' }]
      };
  }
}
