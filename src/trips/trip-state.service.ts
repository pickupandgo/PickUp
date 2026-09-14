import { Injectable, BadRequestException } from '@nestjs/common';
import { TripStatus, StopStatus } from './trips.types';

@Injectable()
export class TripStateService {
  // Trip-level transitions
  // Key change: DELIVERED can go back to IN_TRANSIT (for next stop) OR to COMPLETED (last stop)
  private allowedTransitions: Record<TripStatus, TripStatus[]> = {
    'DRIVER_ASSIGNED': ['DRIVER_ARRIVED', 'CANCELLED'],
    'DRIVER_ARRIVED': ['PICKUP_VERIFIED', 'CANCELLED'],
    'PICKUP_VERIFIED': ['IN_TRANSIT', 'CANCELLED'],
    'IN_TRANSIT': ['DROP_PROGRESS'],
    'DROP_PROGRESS': ['DELIVERED'],
    'DELIVERED': ['IN_TRANSIT', 'COMPLETED'],   // ← can loop back for next stop OR complete
    'COMPLETED': [],
    'CANCELLED': [],
  };

  // Stop-level transitions
  private allowedStopTransitions: Record<StopStatus, StopStatus[]> = {
    'PENDING': ['IN_TRANSIT'],
    'IN_TRANSIT': ['ARRIVED'],
    'ARRIVED': ['DELIVERED'],
    'DELIVERED': [],
  };

  validateTransition(current: TripStatus, next: TripStatus) {
    if (!this.allowedTransitions[current]?.includes(next)) {
      throw new BadRequestException(`Invalid trip state transition from ${current} to ${next}`);
    }
  }

  validateStopTransition(current: StopStatus, next: StopStatus) {
    if (!this.allowedStopTransitions[current]?.includes(next)) {
      throw new BadRequestException(`Invalid stop state transition from ${current} to ${next}`);
    }
  }
}
