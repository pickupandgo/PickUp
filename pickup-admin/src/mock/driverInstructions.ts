import { DriverInstruction } from '@/types/driverInstruction';

export const MOCK_DRIVER_INSTRUCTIONS: DriverInstruction[] = [
  {
    id: 'INST-001',
    title: 'Pickup OTP Reminder',
    message: 'Always verify the pickup OTP before starting the trip. Do not hand over goods without verification.',
    type: 'Driver Instruction',
    status: 'Active',
    priority: 1,
    createdBy: 'admin@pickupjodhpur.in',
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 30).toISOString(),
  },
  {
    id: 'INST-002',
    title: 'Rain Emergency Protocol',
    message: 'If it starts raining heavily, secure all goods with tarpaulin immediately. Contact support if you need to halt the trip.',
    type: 'Operational Message',
    status: 'Active',
    priority: 2,
    createdBy: 'admin@pickupjodhpur.in',
    createdAt: new Date(Date.now() - 86400000 * 15).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'INST-003',
    title: 'Toll Tax Guidelines',
    message: 'Toll taxes are paid by the customer directly. Please do not ask the customer for toll cash if they have paid online.',
    type: 'Driver Instruction',
    status: 'Inactive',
    priority: 3,
    createdBy: 'admin@pickupjodhpur.in',
    createdAt: new Date(Date.now() - 86400000 * 45).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 10).toISOString(),
  }
];
