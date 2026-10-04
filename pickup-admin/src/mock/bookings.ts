import { Booking, PaymentMethod } from '@/types/booking';

export const MOCK_BOOKINGS: Booking[] = [
  {
    id: 'BKG-1001',
    bookingDate: '2024-03-20T10:30:00Z',
    status: 'Completed',
    customerId: 'CUST-001',
    customerName: 'Rahul Sharma',
    customerPhone: '+91 94140 12345',
    driverId: 'DRV-001',
    driverName: 'Ramesh Kumar',
    driverPhone: '+91 98290 12345',
    vehicleId: 'VEH-001',
    vehicleRegistrationNumber: 'RJ19AB1234',
    vehicleCategoryId: 'VC-003',
    vehicleCategoryName: 'Mini Truck / Tata Ace',
    pickup: {
      address: 'Plot 45, Phase 2, Basni Industrial Area, Jodhpur',
      landmark: 'Near AIIMS',
      contactName: 'Rahul Sharma',
      contactPhone: '+91 94140 12345'
    },
    drops: [
      {
        id: 'DROP-1001-1',
        order: 1,
        location: { address: 'Shop 12, Sardarpura B Road, Jodhpur', landmark: 'Opposite IDFC Bank' },
        receiver: { name: 'Amit Trader', phone: '+91 98291 00001' },
        status: 'Completed',
        completedAt: '2024-03-20T11:45:00Z'
      }
    ],
    load: {
      type: 'Textiles',
      description: '3 bundles of cotton fabric',
      approxWeightKg: 450,
      declaredValue: 25000,
      specialInstructions: 'Keep dry'
    },
    insurance: { selected: true, provider: 'SecureGoods India', premium: 125, referenceId: 'INS-88992' },
    fare: {
      baseFare: 100,
      distanceCharge: 150,
      trafficSurcharge: 25,
      insurancePremium: 125,
      totalFare: 400,
      platformCommission: 40,
      driverEarnings: 360
    },
    payment: { method: 'UPI', status: 'Completed', amount: 400, referenceId: 'TXN-UPI-001' },
    notes: [
      { id: 'N-1', text: 'Driver arrived 10 mins late but delivered on time.', addedBy: 'Admin (System)', timestamp: '2024-03-20T12:00:00Z' }
    ],
    timeline: [
      { id: 'T-1', status: 'Pending', timestamp: '2024-03-20T10:30:00Z' },
      { id: 'T-2', status: 'Driver Assigned', timestamp: '2024-03-20T10:32:00Z' },
      { id: 'T-3', status: 'Driver Arrived', timestamp: '2024-03-20T10:55:00Z' },
      { id: 'T-4', status: 'Pickup Completed', timestamp: '2024-03-20T11:10:00Z' },
      { id: 'T-5', status: 'Completed', timestamp: '2024-03-20T11:45:00Z' }
    ],
    deliveryProof: { photoUrl: 'placeholder', location: '26.2829, 73.0134', timestamp: '2024-03-20T11:45:00Z', dropId: 'DROP-1001-1' }
  },
  {
    id: 'BKG-1002',
    bookingDate: '2024-03-21T09:15:00Z',
    status: 'In Transit',
    customerId: 'CUST-002',
    customerName: 'Mohit Jain',
    customerPhone: '+91 98290 67890',
    driverId: 'DRV-003',
    driverName: 'Vikram Singh',
    driverPhone: '+91 98290 54321',
    vehicleId: 'VEH-003',
    vehicleRegistrationNumber: 'RJ19CD9012',
    vehicleCategoryId: 'VC-004',
    vehicleCategoryName: 'Pickup / Bolero',
    pickup: {
      address: 'Mandore Mandi, Jodhpur',
      landmark: 'Gate 2',
      contactName: 'Mohit Jain',
      contactPhone: '+91 98290 67890'
    },
    drops: [
      {
        id: 'DROP-1002-1',
        order: 1,
        location: { address: 'Pal Road, Jodhpur', landmark: 'DPS Circle' },
        receiver: { name: 'Kisan Traders', phone: '+91 98292 22222' },
        status: 'Pending'
      }
    ],
    load: { type: 'Agriculture', description: 'Grain Sacks', approxWeightKg: 1200, declaredValue: 50000 },
    insurance: { selected: false },
    fare: { baseFare: 150, distanceCharge: 300, totalFare: 450, platformCommission: 45, driverEarnings: 405 },
    payment: { method: 'COD', status: 'Pending', amount: 450 },
    notes: [],
    timeline: [
      { id: 'T-1', status: 'Pending', timestamp: '2024-03-21T09:15:00Z' },
      { id: 'T-2', status: 'Driver Assigned', timestamp: '2024-03-21T09:20:00Z' },
      { id: 'T-3', status: 'Pickup Completed', timestamp: '2024-03-21T10:00:00Z' },
      { id: 'T-4', status: 'In Transit', timestamp: '2024-03-21T10:05:00Z' }
    ]
  },
  {
    id: 'BKG-1003',
    bookingDate: '2024-03-21T11:00:00Z',
    status: 'Partially Delivered',
    customerId: 'CUST-004',
    customerName: 'Neha Mehta',
    customerPhone: '+91 97999 11223',
    driverId: 'DRV-005',
    driverName: 'Suresh Bishnoi',
    driverPhone: '+91 98290 98765',
    vehicleId: 'VEH-005',
    vehicleRegistrationNumber: 'RJ19EF7890',
    vehicleCategoryId: 'VC-002',
    vehicleCategoryName: '3-Wheeler / E-Loader',
    pickup: {
      address: 'Ratanada, Jodhpur',
      landmark: 'Polo Ground',
      contactName: 'Neha Mehta',
      contactPhone: '+91 97999 11223'
    },
    drops: [
      {
        id: 'DROP-1003-1',
        order: 1,
        location: { address: 'Chopasni Housing Board, Jodhpur' },
        receiver: { name: 'Priya', phone: '+91 99999 88881' },
        status: 'Completed',
        completedAt: '2024-03-21T12:30:00Z'
      },
      {
        id: 'DROP-1003-2',
        order: 2,
        location: { address: 'BJS Colony, Jodhpur' },
        receiver: { name: 'Ravi', phone: '+91 99999 88882' },
        status: 'Pending'
      }
    ],
    load: { type: 'E-commerce', description: 'Multiple small packages', approxWeightKg: 150 },
    insurance: { selected: false },
    fare: { baseFare: 70, distanceCharge: 200, multiDropFee: 30, totalFare: 300, platformCommission: 30, driverEarnings: 270 },
    payment: { method: 'Wallet', status: 'Completed', amount: 300, referenceId: 'TXN-WLT-998' },
    notes: [
      { id: 'N-1', text: 'Customer requested cautious driving due to fragile items in 1st drop.', addedBy: 'Support (Agent A)', timestamp: '2024-03-21T11:05:00Z' }
    ],
    timeline: [
      { id: 'T-1', status: 'Pending', timestamp: '2024-03-21T11:00:00Z' },
      { id: 'T-2', status: 'Pickup Completed', timestamp: '2024-03-21T11:45:00Z' },
      { id: 'T-3', status: 'Partially Delivered', timestamp: '2024-03-21T12:30:00Z' }
    ]
  },
  {
    id: 'BKG-1004',
    bookingDate: '2024-03-22T08:00:00Z',
    status: 'Cancelled',
    customerId: 'CUST-006',
    customerName: 'Vikram Rathore',
    customerPhone: '+91 99293 77889',
    driverId: 'DRV-001',
    driverName: 'Ramesh Kumar',
    driverPhone: '+91 98290 12345',
    vehicleId: 'VEH-001',
    vehicleRegistrationNumber: 'RJ19AB1234',
    vehicleCategoryId: 'VC-003',
    vehicleCategoryName: 'Mini Truck / Tata Ace',
    pickup: { address: 'Boranada Industrial Area', contactName: 'Vikram Rathore', contactPhone: '+91 99293 77889' },
    drops: [
      { id: 'DROP-1004-1', order: 1, location: { address: 'Sojati Gate' }, receiver: { name: 'Ramesh', phone: '+91 88888 77777' }, status: 'Pending' }
    ],
    load: { type: 'Hardware', description: 'Pipes and fittings', approxWeightKg: 600 },
    insurance: { selected: false },
    fare: { baseFare: 100, distanceCharge: 250, totalFare: 350 },
    payment: { method: 'UPI', status: 'Refunded', amount: 350 },
    cancellation: {
      status: 'Cancelled',
      cancelledBy: 'Customer',
      reason: 'Driver taking too long',
      charge: 0,
      timestamp: '2024-03-22T08:45:00Z'
    },
    notes: [],
    timeline: [
      { id: 'T-1', status: 'Pending', timestamp: '2024-03-22T08:00:00Z' },
      { id: 'T-2', status: 'Driver Assigned', timestamp: '2024-03-22T08:05:00Z' },
      { id: 'T-3', status: 'Cancelled', timestamp: '2024-03-22T08:45:00Z', description: 'Cancelled by customer' }
    ]
  },
  {
    id: 'BKG-1005',
    bookingDate: '2024-03-22T14:00:00Z',
    status: 'Searching Driver',
    customerId: 'CUST-008',
    customerName: 'Deepak Gupta',
    customerPhone: '+91 93520 88774',
    vehicleCategoryId: 'VC-005',
    vehicleCategoryName: 'JCB',
    pickup: { address: 'Shastri Nagar, Jodhpur', landmark: 'Sector D', contactName: 'Deepak Gupta', contactPhone: '+91 93520 88774' },
    drops: [
      { id: 'DROP-1005-1', order: 1, location: { address: 'Shastri Nagar, Jodhpur' }, receiver: { name: 'Deepak Gupta', phone: '+91 93520 88774' }, status: 'Pending' }
    ],
    load: { type: 'Construction', description: 'Site clearing work', specialInstructions: 'Require 3 hours min.' },
    insurance: { selected: false },
    fare: { baseFare: 0, hourlyCharge: 4500, totalFare: 4500 }, // 3 hrs * 1500
    payment: { method: 'Cash at Pickup', status: 'Pending', amount: 4500 },
    notes: [],
    timeline: [
      { id: 'T-1', status: 'Pending', timestamp: '2024-03-22T14:00:00Z' },
      { id: 'T-2', status: 'Searching Driver', timestamp: '2024-03-22T14:01:00Z' }
    ]
  }
];

export const generateMoreBookings = () => {
  const statuses: Booking['status'][] = ['Completed', 'Cancelled', 'In Transit', 'Pending', 'Driver Arrived'];
  const methods: PaymentMethod[] = ['UPI', 'COD', 'Cash at Pickup'];
  const newBookings: Booking[] = [];
  
  for(let i=1006; i<=1025; i++) {
    const s = statuses[i % statuses.length];
    newBookings.push({
      id: `BKG-${i}`,
      bookingDate: `2024-03-${String((i%30)+1).padStart(2, '0')}T10:00:00Z`,
      status: s,
      customerId: `CUST-00${(i%10)+1}`,
      customerName: 'Demo Customer',
      customerPhone: '+91 99999 00000',
      driverId: s === 'Pending' || s === 'Searching Driver' ? undefined : `DRV-00${(i%5)+1}`,
      driverName: s === 'Pending' || s === 'Searching Driver' ? undefined : 'Demo Driver',
      driverPhone: s === 'Pending' ? undefined : '+91 88888 00000',
      vehicleId: s === 'Pending' ? undefined : `VEH-00${(i%5)+1}`,
      vehicleRegistrationNumber: s === 'Pending' ? undefined : `RJ19DEMO${i}`,
      vehicleCategoryId: 'VC-003',
      vehicleCategoryName: 'Mini Truck / Tata Ace',
      pickup: { address: 'Demo Pickup Address, Jodhpur' },
      drops: [ { id: `DROP-${i}-1`, order: 1, location: { address: 'Demo Drop Address' }, receiver: { name: 'Receiver', phone: '123' }, status: s === 'Completed' ? 'Completed' : 'Pending' } ],
      load: { type: 'General', description: 'Demo Goods' },
      insurance: { selected: false },
      fare: { baseFare: 100, distanceCharge: 200, totalFare: 300 },
      payment: { method: methods[i % methods.length], status: s === 'Completed' ? 'Completed' : 'Pending', amount: 300 },
      notes: [],
      timeline: [{ id: `T-${i}`, status: 'Pending', timestamp: `2024-03-${String((i%30)+1).padStart(2, '0')}T10:00:00Z` }]
    });
  }
  return newBookings;
}

MOCK_BOOKINGS.push(...generateMoreBookings());
