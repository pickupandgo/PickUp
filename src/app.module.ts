import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DriversModule } from './drivers/drivers.module';
import { RidesModule } from './rides/rides.module';
import { TripsModule } from './trips/trips.module';
import { FareModule } from './fare/fare.module';

@Module({
  imports: [DriversModule, RidesModule, TripsModule, FareModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
