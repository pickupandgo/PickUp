import { forbidden } from '../common/errors/app-error';
import type { CustomerPrincipal, DriverPrincipal, Principal } from './principal';

/** Returns the caller's driver profile or fails with 403. */
export function requireDriver(principal: Principal): DriverPrincipal {
  if (!principal.driver) {
    throw forbidden('This action requires a driver account');
  }
  return principal.driver;
}

/** Returns the caller's customer profile or fails with 403. */
export function requireCustomer(principal: Principal): CustomerPrincipal {
  if (!principal.customer) {
    throw forbidden('This action requires a customer account');
  }
  return principal.customer;
}
