import { BookingStatus, BookingDrop } from './booking';

export interface LocationCoordinates {
  lat: number;
  lng: number;
  address?: string;
}

export interface LiveDriver {
  id: string;
  name: string;
  vehicleId: string;
  vehicleRegistrationNumber: string;
  status: 'Online' | 'Offline' | 'On Trip' | 'Available';
  currentLocation: LocationCoordinates;
  lastUpdate: string;
}

export interface LiveTrip {
  bookingId: string;
  driverId: string;
  driverName: string;
  vehicleRegistrationNumber: string;
  vehicleCategoryName: string;
  
  customerId: string;
  customerName: string;
  
  status: BookingStatus;
  
  pickup: LocationCoordinates;
  drops: BookingDrop[];
  
  currentLocation: LocationCoordinates;
  lastUpdate: string;
}

export interface LiveOperationsData {
  activeTrips: LiveTrip[];
  onlineDrivers: LiveDriver[];
}
