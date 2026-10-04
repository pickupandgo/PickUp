export interface DashboardMetrics {
  totalBookings: number;
  activeTrips: number;
  onlineDrivers: number;
  activeDrivers: number;
  totalCustomers: number;
  cancelledTrips: number;
  revenue: number;
  platformCommission: number;
  
  trends?: {
    totalBookings: number;
    revenue: number;
  };
}

export interface DashboardSummary {
  metrics: DashboardMetrics;
  recentBookings: Array<{
    id: string;
    customerName: string;
    vehicleCategoryName: string;
    totalFare: number;
    status: string;
    date: string;
  }>;
  recentCancellations: Array<{
    id: string;
    customerName: string;
    driverName?: string;
    reason: string;
    date: string;
    charge: number;
  }>;
}
