import type { SubscriptionPlan, CurrentSubscription } from '../../types/user';
export interface ISubscriptionService {
  getPlans(): Promise<SubscriptionPlan[]>;
  getCurrent(): Promise<CurrentSubscription | null>;
  purchase(
    planId: string,
    paymentMethodId: string,
  ): Promise<CurrentSubscription>;
}
export class SubscriptionUnavailableError extends Error {
  readonly code = 'SUBSCRIPTIONS_UNAVAILABLE';
  constructor() {
    super(
      'Subscription purchase and entitlement verification are not connected yet.',
    );
  }
}
class UnavailableSubscriptionService implements ISubscriptionService {
  async getPlans(): Promise<SubscriptionPlan[]> {
    throw new SubscriptionUnavailableError();
  }
  async getCurrent(): Promise<CurrentSubscription | null> {
    throw new SubscriptionUnavailableError();
  }
  async purchase(
    _planId: string,
    _paymentMethodId: string,
  ): Promise<CurrentSubscription> {
    throw new SubscriptionUnavailableError();
  }
}
/** Compatibility names cannot issue unsupported payment requests or grant a demo entitlement. */
export class ApiSubscriptionService extends UnavailableSubscriptionService {}
export class MockSubscriptionService extends UnavailableSubscriptionService {}
export class SubscriptionService {
  private static readonly instance: ISubscriptionService =
    new UnavailableSubscriptionService();
  static getInstance(): ISubscriptionService {
    return this.instance;
  }
}
