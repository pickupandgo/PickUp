import { formatToE164, AuthService } from '../src/services/auth/AuthService';
import { ApiClient } from '../src/services/api/ApiClient';

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
    it('sends driver registration payload to backend ApiClient', async () => {
      const mockPost = jest.spyOn(ApiClient.getInstance(), 'post').mockResolvedValueOnce({
        driverId: 'drv-uuid-1',
        phone: '+919876543210',
        approvalStatus: 'PENDING',
        legalName: 'Rajesh Kumar',
      });

      const authService = AuthService.getInstance();
      const result = await authService.registerDriver({
        name: 'Rajesh Kumar',
        phone: '9876543210',
        email: 'rajesh@example.com',
        vehicleMake: 'Tata Ace',
        licensePlate: 'RJ19AB1234',
      });

      expect(mockPost).toHaveBeenCalledWith(
        '/v1/drivers/me',
        expect.objectContaining({
          name: 'Rajesh Kumar',
          phone: '+919876543210',
        }),
      );
      expect(result.driverId).toBe('drv-uuid-1');
      expect(result.approvalStatus).toBe('PENDING');

      mockPost.mockRestore();
    });

    it('gracefully handles offline/mock mode if backend API is not configured', async () => {
      const mockPost = jest.spyOn(ApiClient.getInstance(), 'post').mockRejectedValueOnce(
        new Error('API_BASE_URL is not configured. Cannot make API requests in mock mode.'),
      );

      const authService = AuthService.getInstance();
      const result = await authService.registerDriver({
        name: 'Rajesh Kumar',
        phone: '9876543210',
        email: 'rajesh@example.com',
      });

      expect(result).toEqual({ success: true, offline: true });
      mockPost.mockRestore();
    });
  });
});
