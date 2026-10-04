import { DriverInstruction, InstructionStatus } from '@/types/driverInstruction';
import { MOCK_DRIVER_INSTRUCTIONS } from '@/mock/driverInstructions';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let instructions = [...MOCK_DRIVER_INSTRUCTIONS];

export async function getInstructions(): Promise<DriverInstruction[]> {
  await delay(300);
  return [...instructions];
}

export async function saveInstruction(instruction: Partial<DriverInstruction>): Promise<DriverInstruction> {
  await delay(400);
  
  if (instruction.id) {
    const idx = instructions.findIndex(i => i.id === instruction.id);
    if (idx !== -1) {
      instructions[idx] = { 
        ...instructions[idx], 
        ...instruction,
        updatedAt: new Date().toISOString()
      } as DriverInstruction;
      return instructions[idx];
    }
  }
  
  const newInst: DriverInstruction = {
    id: `INST-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
    title: instruction.title || '',
    message: instruction.message || '',
    type: instruction.type || 'Driver Instruction',
    status: instruction.status || 'Active',
    priority: instruction.priority || 1,
    createdBy: 'admin@pickupjodhpur.in',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  instructions.unshift(newInst);
  return newInst;
}

export async function toggleStatus(id: string, newStatus: InstructionStatus): Promise<void> {
  await delay(200);
  const idx = instructions.findIndex(i => i.id === id);
  if (idx !== -1) {
    instructions[idx].status = newStatus;
    instructions[idx].updatedAt = new Date().toISOString();
  }
}
