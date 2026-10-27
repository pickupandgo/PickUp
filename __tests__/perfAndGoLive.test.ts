import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthService } from '../src/services/auth/AuthService';
import { LocationService } from '../src/location/LocationService';
import { ApiClient } from '../src/services/api/ApiClient';
import { perfMetrics } from '../src/utils/perfMetrics';

describe('Driver App Performance & Go Live Optimizations', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    (AuthService as any).cachedProfile = null;
    (AuthService as any).inFlightProfilePromise = null;
  });

  describe('AuthService Profile Caching & In-Flight Deduplication', () => {
    it('restores cached profile from AsyncStorage instantly on cold launch', async () => {
      const mockProfile = {
        driverId: 'drv-123',
        name: 'Speedy Driver',
        phone: '+919876543210',
        approvalStatus: 'APPROVED',
      };

      (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockProfile));

      const loaded = await AuthService.loadCachedProfile('driver-test-123');
      expect(loaded).toEqual(mockProfile);
      expect(AuthService.getCachedProfile()).toEqual(mockProfile);
      expect(AsyncStorage.getItem).toHaveBeenCalledWith('driver.cachedProfile.driver-test-123');
    });

    it('deduplicates simultaneous concurrent fetchDriverProfile requests', async () => {
      const authService = AuthService.getInstance();
      const mockApiResponse = {
        driverId: 'drv-dedup',
        approvalStatus: 'APPROVED',
        phone: '+919876543210',
      };

      const getSpy = jest.spyOn(ApiClient.getInstance(), 'get').mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockApiResponse as any), 50)),
      );

      // Trigger 3 simultaneous calls
      const [p1, p2, p3] = await Promise.all([
        authService.fetchDriverProfile(),
        authService.fetchDriverProfile(),
        authService.fetchDriverProfile(),
      ]);

      expect(getSpy).toHaveBeenCalledTimes(1);
      expect(p1).toEqual(mockApiResponse);
      expect(p2).toEqual(mockApiResponse);
      expect(p3).toEqual(mockApiResponse);

      getSpy.mockRestore();
    });

    it('clears in-memory profile cache on logout', async () => {
      const authService = AuthService.getInstance();
      (AuthService as any).cachedProfile = { driverId: 'drv-123', approvalStatus: 'APPROVED' };

      await authService.logout();

      expect(AuthService.getCachedProfile()).toBeNull();
    });
  });

  describe('LocationService Fast Cached Location', () => {
    it('returns null lastKnownLocation initially', () => {
      expect(LocationService.getLastKnownLocation()).toBeNull();
    });

    it('returns cached location immediately if fresher than maxAgeMs', async () => {
      const mockLoc = {
        latitude: 26.2389,
        longitude: 73.0243,
        accuracy: 5,
        heading: 0,
        speed: 0,
        altitude: 200,
        timestamp: Date.now(),
      };

      const getCurrentSpy = jest.spyOn(LocationService, 'getCurrentLocation');

      // Simulate a received location update into cache
      (LocationService as any).lastKnownLocation = mockLoc;
      (LocationService as any).lastLocationTimestamp = Date.now();

      const loc = await LocationService.getFreshOrCachedLocation(60_000);
      expect(loc).toEqual(mockLoc);
      expect(getCurrentSpy).not.toHaveBeenCalled();

      getCurrentSpy.mockRestore();
    });

    it('calls getCurrentLocation if cached location is older than maxAgeMs', async () => {
      const freshLoc = {
        latitude: 26.24,
        longitude: 73.03,
        accuracy: 10,
        heading: 0,
        bearing: 0,
        speed: 0,
        altitude: 200,
        provider: 'fused',
        timestamp: Date.now(),
      };

      const getCurrentSpy = jest.spyOn(LocationService, 'getCurrentLocation').mockResolvedValue(freshLoc);

      // Stale timestamp (2 minutes old)
      (LocationService as any).lastKnownLocation = {
        latitude: 26.0,
        longitude: 73.0,
        accuracy: 50,
        heading: 0,
        speed: 0,
        altitude: 200,
        timestamp: Date.now() - 120_000,
      };
      (LocationService as any).lastLocationTimestamp = Date.now() - 120_000;

      const loc = await LocationService.getFreshOrCachedLocation(60_000);
      expect(getCurrentSpy).toHaveBeenCalledTimes(1);
      expect(loc).toEqual(freshLoc);

      getCurrentSpy.mockRestore();
    });
  });

  describe('perfMetrics Diagnostics', () => {
    it('measures elapsed time without throwing or logging PII', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const id = perfMetrics.start('GO_LIVE_TEST');
      expect(id).toBeDefined();

      const duration = perfMetrics.end(id, { testKey: 'testVal' });
      expect(typeof duration).toBe('number');
      expect(duration).toBeGreaterThanOrEqual(0);

      const milestone = perfMetrics.measureSinceLaunch('COLD_START_TEST');
      expect(typeof milestone).toBe('number');

      expect(logSpy).toHaveBeenCalled();
      logSpy.mockRestore();
    });
  });
});
