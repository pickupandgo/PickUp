import { FinancialContext, financialContextSettings } from './financial-context';
import { requestFinancialContext } from './financial-context.interceptor';

describe('FinancialContext', () => {
  it('is empty outside a request or job, so a write is recorded as UNATTRIBUTED', () => {
    expect(FinancialContext.current()).toBeUndefined();
    expect(financialContextSettings()).toEqual({
      actorType: 'UNATTRIBUTED',
      actorUserId: '',
      requestId: '',
      origin: '',
      providerEventId: '',
    });
  });

  it('follows the work through every await, and ends with it', async () => {
    const seen = await FinancialContext.run(
      { actorType: 'ADMIN', actorUserId: 'u-1', requestId: 'req-1', origin: 'POST /v1/x' },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        await Promise.resolve();
        return financialContextSettings();
      },
    );
    expect(seen).toEqual({
      actorType: 'ADMIN',
      actorUserId: 'u-1',
      requestId: 'req-1',
      origin: 'POST /v1/x',
      providerEventId: '',
    });
    expect(FinancialContext.current()).toBeUndefined();
  });

  it('keeps concurrent requests apart', async () => {
    const run = (id: string) =>
      FinancialContext.run({ actorType: 'DRIVER', requestId: id }, async () => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
        return FinancialContext.current()?.requestId;
      });
    expect(await Promise.all(['a', 'b', 'c', 'd'].map(run))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a webhook names its provider and event once verified; a job keeps an admin who ran it', () => {
    FinancialContext.run({ requestId: 'req-2', origin: 'POST /v1/webhooks/razorpay' }, () => {
      FinancialContext.annotate({ actorType: 'PROVIDER', providerEventId: 'evt_1' });
      expect(FinancialContext.current()).toMatchObject({
        actorType: 'PROVIDER',
        requestId: 'req-2',
        providerEventId: 'evt_1',
      });
    });
    // Outside any context, annotate does nothing.
    FinancialContext.annotate({ actorType: 'SYSTEM' });
    expect(FinancialContext.current()).toBeUndefined();

    const byTimer = FinancialContext.runIfAbsent(
      { actorType: 'SYSTEM', origin: 'job X' },
      () => FinancialContext.current()?.actorType,
    );
    expect(byTimer).toBe('SYSTEM');
    const byAdmin = FinancialContext.run({ actorType: 'ADMIN', actorUserId: 'u-9' }, () =>
      FinancialContext.runIfAbsent({ actorType: 'SYSTEM' }, () => FinancialContext.current()),
    );
    expect(byAdmin).toMatchObject({ actorType: 'ADMIN', actorUserId: 'u-9' });
  });

  it('caps values to the column sizes', () => {
    const settings = financialContextSettings({
      actorType: 'SYSTEM',
      actorUserId: null,
      requestId: 'r'.repeat(300),
      origin: 'o'.repeat(300),
      providerEventId: 'e'.repeat(300),
    });
    expect(settings.requestId).toHaveLength(100);
    expect(settings.origin).toHaveLength(150);
    expect(settings.providerEventId).toHaveLength(150);
  });
});

describe('requestFinancialContext', () => {
  const principal = (role: 'ADMIN' | 'DRIVER' | 'CUSTOMER') =>
    ({ userId: `user-${role}`, role }) as never;

  it('an authenticated request acts as its user and role, on its route', () => {
    expect(
      requestFinancialContext(
        {
          id: 'req-9',
          method: 'POST',
          path: '/v1/admin/refunds/abc/sync',
          route: { path: '/v1/admin/refunds/:refundId/sync' },
          principal: principal('ADMIN'),
        },
        'ADMIN',
      ),
    ).toEqual({
      actorType: 'ADMIN',
      actorUserId: 'user-ADMIN',
      requestId: 'req-9',
      origin: 'POST /v1/admin/refunds/:refundId/sync',
      providerEventId: null,
    });
    expect(
      requestFinancialContext({ method: 'POST', principal: principal('DRIVER') }, 'DRIVER'),
    ).toMatchObject({ actorType: 'DRIVER', actorUserId: 'user-DRIVER', origin: null });
    expect(requestFinancialContext({ principal: principal('CUSTOMER') }, 'CUSTOMER')).toMatchObject(
      { actorType: 'CUSTOMER', requestId: null },
    );
  });

  it('the internal API is the trip engine; a public route is unattributed until it says more', () => {
    expect(
      requestFinancialContext({ method: 'POST', path: '/v1/internal/x' }, 'INTERNAL'),
    ).toMatchObject({
      actorType: 'ENGINE',
      actorUserId: null,
      origin: 'POST /v1/internal/x',
    });
    expect(
      requestFinancialContext({ method: 'POST', path: '/v1/webhooks/razorpay' }, 'PUBLIC'),
    ).toMatchObject({ actorType: 'UNATTRIBUTED', actorUserId: null });
  });
});
