import 'reflect-metadata';
import { createValidationPipe } from '../common/http/validation';
import { UpdateCustomerProfileRequest } from './customers.dto';

describe('Customer profile request validation', () => {
  const pipe = createValidationPipe();
  const parse = (value: unknown) =>
    pipe.transform(value, {
      type: 'body',
      metatype: UpdateCustomerProfileRequest,
    });
  it('trims editable strings without coercing age', async () => {
    expect(
      await parse({
        name: ' Test Customer ',
        email: ' test@example.com ',
        age: 24,
        address: ' Test address ',
      }),
    ).toEqual({
      name: 'Test Customer',
      email: 'test@example.com',
      age: 24,
      address: 'Test address',
    });
  });
  it('preserves omission and explicitly nullable fields', async () => {
    expect(await parse({})).toEqual({});
    expect(await parse({ age: null, address: null })).toEqual({ age: null, address: null });
  });
  it.each([0, 121, 1.5, '24', true])('rejects invalid age %p', async (age) => {
    await expect(parse({ age })).rejects.toMatchObject({ status: 400 });
  });
  it.each([null, '', '  ', 123, 'x'.repeat(121)])('rejects invalid name %p', async (name) => {
    await expect(parse({ name })).rejects.toMatchObject({ status: 400 });
  });
  it.each([null, '', 'invalid', 'x'.repeat(250) + '@example.com'])(
    'rejects invalid email %p',
    async (email) => {
      await expect(parse({ email })).rejects.toMatchObject({ status: 400 });
    },
  );
  it.each(['', ' \t\n ', false, 'x'.repeat(501)])(
    'rejects invalid non-null address',
    async (address) => {
      await expect(parse({ address })).rejects.toMatchObject({ status: 400 });
    },
  );
  it.each(['uid', 'firebaseUid', 'phone', 'role', 'status', 'userId', 'customerId'])(
    'rejects privileged field %s',
    async (field) => {
      await expect(parse({ [field]: 'untrusted', name: 'Test Customer' })).rejects.toMatchObject({
        status: 400,
      });
    },
  );
});
