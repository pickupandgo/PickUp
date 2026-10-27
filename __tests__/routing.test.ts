import { pointToPolylineDistance, distanceBetween, validateCoordinate, getRouteBounds } from '../src/services/routing/geometry';
import { MockRoutingProvider } from '../src/services/routing/MockRoutingProvider';
import { RoutingService } from '../src/services/routing/RoutingService';
import { RoutingError } from '../src/services/routing/types';

describe('Geometry Utilities', () => {
  it('validates coordinates correctly', () => {
    expect(validateCoordinate({ latitude: 10, longitude: 20 })).toBe(true);
    expect(validateCoordinate({ latitude: 100, longitude: 20 })).toBe(false);
    expect(validateCoordinate({ latitude: 10, longitude: 200 })).toBe(false);
    expect(validateCoordinate(null as any)).toBe(false);
  });

  it('calculates distance between points', () => {
    const p1 = { latitude: 0, longitude: 0 };
    const p2 = { latitude: 0, longitude: 1 };
    // 1 degree of longitude at equator is ~111km
    const dist = distanceBetween(p1, p2);
    expect(dist).toBeGreaterThan(111000);
    expect(dist).toBeLessThan(112000);
  });

  it('calculates point to polyline distance', () => {
    const poly = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 10 }
    ];
    // point is halfway between but slightly offset in latitude
    const point = { latitude: 1, longitude: 5 }; 
    const dist = pointToPolylineDistance(point, poly);
    // distance should be approx distance from (1,5) to (0,5), which is 1 degree latitude ~111km
    expect(dist).toBeGreaterThan(111000);
    expect(dist).toBeLessThan(112000);
  });

  it('calculates route bounds', () => {
    const poly = [
      { latitude: 10, longitude: 20 },
      { latitude: -10, longitude: 30 },
      { latitude: 5, longitude: 5 },
    ];
    const bounds = getRouteBounds(poly);
    expect(bounds?.southwest).toEqual({ latitude: -10, longitude: 5 });
    expect(bounds?.northeast).toEqual({ latitude: 10, longitude: 30 });
  });
});

describe('RoutingService & MockRoutingProvider', () => {
  let provider: MockRoutingProvider;
  let service: RoutingService;

  beforeEach(() => {
    provider = new MockRoutingProvider({ averageSpeedKmh: 30 });
    service = new RoutingService(provider);
  });

  it('returns normalized route data and calculates ETA based on speed', async () => {
    const origin = { latitude: 0, longitude: 0 };
    const dest = { latitude: 0, longitude: 1 };
    const res = await service.getRoute({ origin, destinations: [dest] });
    
    expect(res.polylinePoints.length).toBeGreaterThan(0);
    expect(res.totalDistanceMeters).toBeGreaterThan(111000);
    
    // speed is 30km/h = 8.33 m/s
    const expectedDuration = res.totalDistanceMeters / (30000 / 3600);
    expect(res.totalDurationSeconds).toBeCloseTo(expectedDuration);
    
    const timeDiff = res.eta.getTime() - Date.now();
    expect(timeDiff / 1000).toBeCloseTo(expectedDuration, -1);
  });

  it('handles multi-stop routing', async () => {
    const res = await service.getRoute({
      origin: { latitude: 0, longitude: 0 },
      destinations: [
        { latitude: 1, longitude: 1 },
        { latitude: 2, longitude: 2 }
      ]
    });
    // origin, mid, dest1, mid, dest2 = 5 points
    expect(res.polylinePoints.length).toBe(5);
  });

  it('throws INVALID_COORDINATES error for bad input', async () => {
    await expect(service.getRoute({
      origin: { latitude: 100, longitude: 0 },
      destinations: [{ latitude: 0, longitude: 0 }]
    })).rejects.toThrow(RoutingError);
  });

  it('protects against stale responses (race conditions)', async () => {
    // We will simulate a slow first request and a fast second request
    // Since MockRoutingProvider has a fixed 200ms delay, we can mock it here
    const slowProvider: any = {
      getRoute: jest.fn()
        .mockImplementationOnce(() => new Promise(res => setTimeout(() => res({ id: 1 }), 100))) // Req 1
        .mockImplementationOnce(() => new Promise(res => setTimeout(() => res({ id: 2 }), 10))) // Req 2
    };
    
    const raceService = new RoutingService(slowProvider);
    
    const req1 = raceService.getRoute({ origin: {latitude:0,longitude:0}, destinations: [{latitude:1,longitude:1}] });
    const req2 = raceService.getRoute({ origin: {latitude:0,longitude:0}, destinations: [{latitude:1,longitude:1}] });
    
    const res2 = await req2;
    expect((res2 as any).id).toBe(2);
    
    await expect(req1).rejects.toThrow('Stale response ignored');
  });

  it('EngineRoutingProvider delegates to directions.getRoute with road polyline', async () => {
    const { EngineRoutingProvider } = require('../src/services/routing/EngineRoutingProvider');
    const directions = require('../src/services/engine/directions');
    
    const mockPolyline = [
      { latitude: 26.29, longitude: 73.02 },
      { latitude: 26.25, longitude: 73.30 },
      { latitude: 26.18, longitude: 73.71 },
    ];
    
    const spy = jest.spyOn(directions, 'getRoute').mockResolvedValueOnce({
      polyline: mockPolyline,
      distanceMeters: 78709,
      durationSeconds: 3876,
    });
    
    const engineProvider = new EngineRoutingProvider();
    const res = await engineProvider.getRoute({
      origin: { latitude: 26.29, longitude: 73.02 },
      destinations: [{ latitude: 26.18, longitude: 73.71 }],
    });
    
    expect(res.polylinePoints).toEqual(mockPolyline);
    expect(res.totalDistanceMeters).toBe(78709);
    expect(res.totalDurationSeconds).toBe(3876);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

