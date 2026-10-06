import { Clock } from '../../src/common/clock';

/** Real time by default; a test can pin it to run the Monday 11:00 IST cycle at will. */
export class FakeClock extends Clock {
  private fixed: Date | null = null;

  now(): Date {
    return this.fixed ? new Date(this.fixed) : new Date();
  }

  set(instant: Date): void {
    this.fixed = new Date(instant);
  }

  reset(): void {
    this.fixed = null;
  }
}
