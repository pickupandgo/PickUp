import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DriverFix, LOCATION_TTL_MS } from './location-policy';

export interface StoredPosition {
  subject: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: bigint;
  receivedAt: Date;
}

/** One row per verified driver; PostgreSQL orders concurrent writers across instances. */
@Injectable()
export class DriverLocationStore {
  constructor(private readonly prisma: PrismaService) {}

  async put(subject: string, fix: DriverFix): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ subject: string }[]>`
      INSERT INTO engine_driver_positions (subject, latitude, longitude, accuracy, captured_at, received_at)
      VALUES (${subject}, ${fix.latitude}, ${fix.longitude}, ${fix.accuracy}, ${BigInt(fix.capturedAt)}, clock_timestamp())
      ON CONFLICT (subject) DO UPDATE SET latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
        accuracy=EXCLUDED.accuracy, captured_at=EXCLUDED.captured_at, received_at=EXCLUDED.received_at
      WHERE engine_driver_positions.captured_at < EXCLUDED.captured_at
      RETURNING subject`;
    return rows.length === 1;
  }

  async fresh(subject?: string): Promise<StoredPosition[]> {
    const since = BigInt(Date.now() - LOCATION_TTL_MS);
    return subject === undefined
      ? this.prisma.$queryRaw<
          StoredPosition[]
        >`SELECT subject,latitude,longitude,accuracy,
          captured_at AS "capturedAt",received_at AS "receivedAt" FROM engine_driver_positions WHERE captured_at >= ${since}`
      : this.prisma.$queryRaw<
          StoredPosition[]
        >`SELECT subject,latitude,longitude,accuracy,
          captured_at AS "capturedAt",received_at AS "receivedAt" FROM engine_driver_positions WHERE subject=${subject} AND captured_at >= ${since}`;
  }
}
