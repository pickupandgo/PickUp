export type InstructionStatus = 'Active' | 'Inactive';
export type InstructionType = 'Driver Instruction' | 'Operational Message';

export interface DriverInstruction {
  id: string;
  title: string;
  message: string;
  type: InstructionType;
  status: InstructionStatus;
  priority?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
