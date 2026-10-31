import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ACCESS_POLICY_KEY } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { CustomersController } from './customers.controller';
import type { CustomersService } from './customers.service';

describe('CustomersController profile PATCH', () => {
  it('registers PATCH me behind the existing CUSTOMER authorization policy', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CustomersController.prototype.update)).toBe('me');
    expect(Reflect.getMetadata(METHOD_METADATA, CustomersController.prototype.update)).toBe(
      RequestMethod.PATCH,
    );
    expect(Reflect.getMetadata(ACCESS_POLICY_KEY, CustomersController.prototype.update)).toBe(
      'CUSTOMER',
    );
  });
  it('passes only the resolved principal and validated profile to the service', async () => {
    const saved = { customerId: 'fixture', age: 25, address: 'Synthetic address' };
    const update = jest.fn().mockResolvedValue(saved);
    const controller = new CustomersController({ update } as unknown as CustomersService);
    const principal = {
      role: 'CUSTOMER',
      userId: 'owner',
      customer: { id: 'fixture' },
    } as Principal;
    const body = { age: 25, address: 'Synthetic address' };
    expect(await controller.update(principal, body)).toBe(saved);
    expect(update).toHaveBeenCalledWith(principal, body);
  });
});
