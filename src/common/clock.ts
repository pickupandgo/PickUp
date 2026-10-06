import { Global, Module } from '@nestjs/common';

/**
 * Application time source for business schedules and cutoffs (weekly payout run, settlement
 * look-back windows). Injected so tests can run the Monday 11:00 IST cycle at a chosen instant.
 * Database timestamps keep using the database clock.
 */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class ClockModule {}
