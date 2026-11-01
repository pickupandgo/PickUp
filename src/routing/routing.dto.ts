import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDefined, IsOptional, ValidateNested } from 'class-validator';
import { LocationInput } from '../fare/fare.dto';
export class RoadRouteRequest {
  @IsDefined()
  @ValidateNested()
  @Type(() => LocationInput)
  origin!: LocationInput;
  @IsDefined()
  @ValidateNested()
  @Type(() => LocationInput)
  destination!: LocationInput;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => LocationInput)
  waypoints?: LocationInput[];
}
export interface RoadRouteResponse {
  encodedPolyline: string;
  distanceMeters: number;
  durationSeconds: number;
}
