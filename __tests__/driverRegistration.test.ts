import { formatToE164, AuthService } from '../src/services/auth/AuthService';
import { ApiClient } from '../src/services/api/ApiClient';
import { ApiError } from '../src/services/api/ApiError';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('Driver Registration Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Phone Validation & Normalization', () => {
    it('normalizes a 10-digit phone number to E.164 format', () => {
      expect(formatToE164('9876543210')).toBe('+919876543210');
      expect(formatToE164(' 9876543210 ')).toBe('+919876543210');
      expect(formatToE164('+919876543210')).toBe('+919876543210');
    });

    it('rejects invalid phone numbers with fewer than 10 digits', () => {
      expect(() => formatToE164('12345')).toThrow('Please enter a valid 10-digit mobile number.');
      expect(() => formatToE164('')).toThrow('Please enter a valid 10-digit mobile number.');
    });
  });

  describe('AuthService.registerDriver', () => {
    it('sends complete 7-field driver registration payload to backend ApiClient', async () => {
      const mockPost = jest.spyOn(ApiClient.getInstance(), 'post').mockResolvedValueOnce({
        driverId: 'drv-uuid-101',
        phone: '+919876543210',
        approvalStatus: 'PENDING',
        legalName: 'Rajesh Sharma',
        vehicleType: 'pickup',
        vehicleRegistrationNumber: 'RJ19AB1234',
      });

      const authService = AuthService.getInstance();
      const result = await authService.registerDriver({
        name: 'Rajesh Sharma',
        phone: '9876543210',
        email: 'rajesh.sharma@example.com',
        vehicleType: 'pickup',
        vehicleMakeModel: 'Mahindra Bolero Maxi Truck',
        vehicleRegistrationNumber: 'RJ19AB1234',
        drivingLicenseNumber: 'RJ1420180012345',
      });

      expect(mockPost).toHaveBeenCalledWith(
        '/v1/drivers/me',
        expect.objectContaining({
          name: 'Rajesh Sharma',
          phone: '+919876543210',
          email: 'rajesh.sharma@example.com',
          vehicleType: 'pickup',
          vehicleMakeModel: 'Mahindra Bolero Maxi Truck',
          vehicleRegistrationNumber: 'RJ19AB1234',
          drivingLicenseNumber: 'RJ1420180012345',
        }),
      );
      expect(result.driverId).toBe('drv-uuid-101');
      expect(result.approvalStatus).toBe('PENDING');

      // Verify vehicle profile was persisted locally for offline/app-session caching
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'driver.vehicleProfile',
        expect.stringContaining('"vehicleType":"pickup"'),
      );
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'driver.vehicleProfile',
        expect.stringContaining('"vehicleRegistrationNumber":"RJ19AB1234"'),
      );

      mockPost.mockRestore();
    });

    it('propagates backend validation errors without swallowing them', async () => {
      const mockPost = jest.spyOn(ApiClient.getInstance(), 'post').mockRejectedValueOnce(
        new ApiError('Vehicle registration number is already registered', 'CONFLICT', 409),
      );

      const authService = AuthService.getInstance();
      await expect(
        authService.registerDriver({
          name: 'Rajesh Sharma',
          phone: '9876543210',
          vehicleType: 'pickup',
          vehicleMakeModel: 'Mahindra Bolero',
          vehicleRegistrationNumber: 'RJ19AB1234',
          drivingLicenseNumber: 'RJ1420180012345',
        }),
      ).rejects.toThrow('Vehicle registration number is already registered');

      mockPost.mockRestore();
    });

    it('propagates network and offline errors so the UI does not falsely advance', async () => {
      const mockPost = jest.spyOn(ApiClient.getInstance(), 'post').mockRejectedValueOnce(
        new Error('Network unavailable. Please check your internet connection.'),
      );

      const authService = AuthService.getInstance();
      await expect(
        authService.registerDriver({
          name: 'Rajesh Sharma',
          phone: '9876543210',
        }),
      ).rejects.toThrow('Network unavailable');

      mockPost.mockRestore();
    });
  });

  describe('AuthService.fetchDriverProfile', () => {
    it('fetches authoritative profile from /v1/drivers/me', async () => {
      const mockGet = jest.spyOn(ApiClient.getInstance(), 'get').mockResolvedValueOnce({
        driverId: 'drv-uuid-101',
        name: 'Rajesh Sharma',
        phone: '+919876543210',
        approvalStatus: 'PENDING',
        vehicleType: 'pickup',
        vehicleRegistrationNumber: 'RJ19AB1234',
      });

      const authService = AuthService.getInstance();
      const profile = await authService.fetchDriverProfile();

      expect(mockGet).toHaveBeenCalledWith('/v1/drivers/me');
      expect(profile).not.toBeNull();
      expect(profile?.driverId).toBe('drv-uuid-101');
      expect(profile?.approvalStatus).toBe('PENDING');

      mockGet.mockRestore();
    });

    it('returns null when driver is not yet registered (403 or 404)', async () => {
      const mockGet = jest.spyOn(ApiClient.getInstance(), 'get').mockRejectedValueOnce(
        new ApiError('Driver profile does not exist', 'DRIVER_NOT_FOUND', 403),
      );

      const authService = AuthService.getInstance();
      const profile = await authService.fetchDriverProfile();

      expect(profile).toBeNull();
      mockGet.mockRestore();
    });

    it('returns null specifically for 403 USER_NOT_PROVISIONED so callers can distinguish unprovisioned accounts from PENDING', async () => {
      const mockGet = jest.spyOn(ApiClient.getInstance(), 'get').mockRejectedValueOnce(
        new ApiError('This account is not registered with MultipleRide', 'USER_NOT_PROVISIONED', 403),
      );

      const authService = AuthService.getInstance();
      const profile = await authService.fetchDriverProfile();

      expect(profile).toBeNull();
      mockGet.mockRestore();
    });

    it('returns authoritative approved driver profile when approvalStatus is APPROVED', async () => {
      const mockGet = jest.spyOn(ApiClient.getInstance(), 'get').mockResolvedValueOnce({
        driverId: '1d7d454a-b699-4faf-896a-cafd498b853b',
        legalName: 'Verified Driver',
        phone: '+918003545846',
        approvalStatus: 'APPROVED',
        vehicleType: 'CAB',
        vehicleRegistrationNumber: 'RJ14CA1234',
      });

      const authService = AuthService.getInstance();
      const profile = await authService.fetchDriverProfile();

      expect(profile).not.toBeNull();
      expect(profile?.approvalStatus).toBe('APPROVED');
      expect(profile?.driverId).toBe('1d7d454a-b699-4faf-896a-cafd498b853b');
      mockGet.mockRestore();
    });

    it('notifies observeProfileState subscribers when fetchDriverProfile succeeds', async () => {
      const mockProfile = {
        driverId: 'drv-uuid-approved',
        approvalStatus: 'APPROVED',
        legalName: 'Verified Driver',
      };
      const mockGet = jest.spyOn(ApiClient.getInstance(), 'get').mockResolvedValueOnce(mockProfile);

      const authService = AuthService.getInstance();
      const profileListener = jest.fn();
      const unsubscribe = AuthService.observeProfileState(profileListener);

      await authService.fetchDriverProfile();

      expect(profileListener).toHaveBeenCalledWith(mockProfile);
      unsubscribe();
      mockGet.mockRestore();
    });

    it('notifies observeProfileState subscribers with null on logout', async () => {
      const profileListener = jest.fn();
      const unsubscribe = AuthService.observeProfileState(profileListener);

      const authService = AuthService.getInstance();
      await authService.logout();

      expect(profileListener).toHaveBeenCalledWith(null);
      unsubscribe();
    });

    it('returns authoritative REJECTED and SUSPENDED status without altering them', async () => {
      const mockGet = jest.spyOn(ApiClient.getInstance(), 'get')
        .mockResolvedValueOnce({
          driverId: 'drv-rejected',
          approvalStatus: 'REJECTED',
          legalName: 'Rejected Driver',
        })
        .mockResolvedValueOnce({
          driverId: 'drv-suspended',
          approvalStatus: 'SUSPENDED',
          legalName: 'Suspended Driver',
        });

      const authService = AuthService.getInstance();
      const rejectedProfile = await authService.fetchDriverProfile();
      expect(rejectedProfile?.approvalStatus).toBe('REJECTED');

      const suspendedProfile = await authService.fetchDriverProfile();
      expect(suspendedProfile?.approvalStatus).toBe('SUSPENDED');

      mockGet.mockRestore();
    });

    it('throws on network failures without falsely reporting null or PENDING', async () => {
      const mockGet = jest.spyOn(ApiClient.getInstance(), 'get').mockRejectedValueOnce(
        new Error('Network request failed'),
      );

      const authService = AuthService.getInstance();
      await expect(authService.fetchDriverProfile()).rejects.toThrow('Network request failed');

      mockGet.mockRestore();
    });

    it('marks driver status restricted in getProfile when profile is PENDING or REJECTED', async () => {
      const mockGet = jest.spyOn(ApiClient.getInstance(), 'get').mockResolvedValueOnce({
        driverId: 'drv-pending',
        approvalStatus: 'PENDING',
        legalName: 'Pending Driver',
      });

      const authService = AuthService.getInstance();
      const profile = await authService.getProfile();

      expect(profile.status).toBe('restricted');
      expect(profile.profileCompletionPercent).toBe(70);

      mockGet.mockRestore();
    });
  });
});

