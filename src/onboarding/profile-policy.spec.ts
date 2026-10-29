import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ageOn, decryptLicence, encryptLicence, validBirthDate } from './profile-policy';
import { SaveVehicleCategoryRequest, UpdateDriverProfileRequest } from './onboarding.dto';
import { loadConfig } from '../config/app-config';

describe('Detailed onboarding profile policy', () => {
  it('validates category-specific document maps without inventing missing categories', () => {
    const source = {
      DATABASE_URL: 'postgresql://test:test@localhost/isolated_test',
      AUTH_ISSUER: 'https://securetoken.google.com/test',
      AUTH_AUDIENCE: 'test',
      RAZORPAY_KEY_ID: 'rzp_test_AbCdEf123456',
      RAZORPAY_KEY_SECRET: 'synthetic-secret-test',
      RAZORPAY_WEBHOOK_SECRET: 'synthetic-webhook-secret-1234567890',
      WALLET_TOPUP_MAX_PAISE: '500000',
      ADMIN_ADJUSTMENT_MAX_PAISE: '1000000',
    };
    const configured = loadConfig({
      ...source,
      VEHICLE_REQUIRED_DOCUMENTS_BY_CATEGORY: '{"MINI_TRUCK":["TEST_RC"]}',
    });
    expect(configured.onboarding.requiredVehicleDocumentsByCategory).toEqual({
      MINI_TRUCK: ['TEST_RC'],
    });
    expect(configured.onboarding.minimumAge).toBeUndefined();
    expect(() =>
      loadConfig({ ...source, VEHICLE_REQUIRED_DOCUMENTS_BY_CATEGORY: '{"CRANE":["TEST_RC"]}' }),
    ).toThrow();
    expect(() =>
      loadConfig({ ...source, VEHICLE_REQUIRED_DOCUMENTS_BY_CATEGORY: '{"MINI_TRUCK":[]}' }),
    ).toThrow();
    expect(() => loadConfig({ ...source, ONBOARDING_MINIMUM_AGE: 'not-a-policy' })).toThrow();
  });
  it('calculates age at birthday boundaries in UTC', () => {
    const dob = new Date('2008-10-29T00:00:00Z');
    expect(ageOn(dob, new Date('2026-10-28T23:59:59Z'))).toBe(17);
    expect(ageOn(dob, new Date('2026-10-29T00:00:00Z'))).toBe(18);
  });
  it.each(['2001-02-29', '2026-13-01', '1900-02-29', 'tomorrow', '2999-01-01'])(
    'rejects malformed, impossible or future DOB %s',
    (value) => expect(() => validBirthDate(value)).toThrow(),
  );
  it('accepts a valid leap-day birth date', () => {
    expect(validBirthDate('2000-02-29').toISOString()).toBe('2000-02-29T00:00:00.000Z');
  });
  it('encrypts licence numbers with randomized authenticated driver-bound encryption', () => {
    const key = 'ab'.repeat(32),
      number = 'SYNTHETIC-LICENCE-1234';
    const first = encryptLicence(number, key, 'driver1');
    expect(first).not.toContain(number);
    expect(first).not.toBe(encryptLicence(number, key, 'driver1'));
    expect(decryptLicence(first, key, 'driver1')).toBe(number);
    expect(() => decryptLicence(first, key, 'driver2')).toThrow();
    expect(() => decryptLicence(first, 'cd'.repeat(32), 'driver1')).toThrow();
  });
  it('rejects missing v2 fields and privileged fields while preserving legacy name updates', async () => {
    const options = { whitelist: true, forbidNonWhitelisted: true };
    expect(
      await validate(plainToInstance(UpdateDriverProfileRequest, { name: 'Test Driver' }), options),
    ).toHaveLength(0);
    expect(
      (
        await validate(
          plainToInstance(UpdateDriverProfileRequest, { name: 'Test', profileVersion: 2 }),
          options,
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(UpdateDriverProfileRequest, {
            name: 'Test',
            role: 'ADMIN',
            phone: 'arbitrary',
          }),
          options,
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(UpdateDriverProfileRequest, {
            name: 'Test',
            email: 'wrong',
            pinCode: '0',
          }),
          options,
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it('accepts only supported category drafts', async () => {
    expect(
      await validate(plainToInstance(SaveVehicleCategoryRequest, { category: 'MINI_TRUCK' })),
    ).toHaveLength(0);
    expect(
      await validate(plainToInstance(SaveVehicleCategoryRequest, { category: 'CRANE' })),
    ).not.toHaveLength(0);
  });
});
