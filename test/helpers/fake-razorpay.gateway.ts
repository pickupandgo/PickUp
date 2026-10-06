import { randomBytes } from 'node:crypto';
import { RazorpayApiError, RazorpayUnavailableError } from '../../src/razorpay/razorpay.errors';
import { RazorpayGateway } from '../../src/razorpay/razorpay.gateway';
import type {
  CreateOrderInput,
  RazorpayOrder,
  RazorpayPayment,
} from '../../src/razorpay/razorpay.types';

type CreateOrderBehaviour = 'unavailable' | 'reject' | 'lose-response';

interface StoredOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
  notes: Record<string, string>;
}

export interface PayOptions {
  readonly status?: 'captured' | 'authorized' | 'failed';
  readonly amount?: number;
  readonly currency?: string;
  readonly method?: string;
}

/** In-memory Razorpay with the behaviours the real API documents. */
export class FakeRazorpayGateway extends RazorpayGateway {
  readonly orders = new Map<string, StoredOrder>();
  readonly payments = new Map<string, RazorpayPayment>();
  readonly calls = {
    createOrder: 0,
    findOrderByReceipt: 0,
    fetchPayment: 0,
    capturePayment: 0,
    fetchOrderPayments: 0,
    fetchOrder: 0,
  };
  /** When true every call fails as if Razorpay were unreachable. */
  unavailable = false;
  private readonly createOrderBehaviours: CreateOrderBehaviour[] = [];

  queueCreateOrderBehaviour(behaviour: CreateOrderBehaviour): void {
    this.createOrderBehaviours.push(behaviour);
  }

  createOrder(input: CreateOrderInput): Promise<RazorpayOrder> {
    this.calls.createOrder += 1;
    return this.run(() => {
      const behaviour = this.createOrderBehaviours.shift();
      if (behaviour === 'unavailable') {
        throw new RazorpayUnavailableError('simulated outage');
      }
      if (behaviour === 'reject') {
        throw new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'simulated rejection');
      }
      const order: StoredOrder = {
        id: newId('order_'),
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.receipt,
        status: 'created',
        notes: { ...input.notes },
      };
      this.orders.set(order.id, order);
      if (behaviour === 'lose-response') {
        throw new RazorpayUnavailableError('simulated lost response');
      }
      return toOrder(order);
    });
  }

  findOrderByReceipt(receipt: string): Promise<RazorpayOrder | null> {
    this.calls.findOrderByReceipt += 1;
    return this.run(() => {
      const match = [...this.orders.values()].find((order) => order.receipt === receipt);
      return match ? toOrder(match) : null;
    });
  }

  fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    this.calls.fetchPayment += 1;
    return this.run(() => ({ ...this.requirePayment(paymentId) }));
  }

  capturePayment(paymentId: string, amountPaise: number): Promise<RazorpayPayment> {
    this.calls.capturePayment += 1;
    return this.run(() => {
      const payment = this.requirePayment(paymentId);
      if (payment.status !== 'authorized') {
        throw new RazorpayApiError(
          400,
          'BAD_REQUEST_ERROR',
          'This payment has already been captured',
        );
      }
      if (payment.amount !== amountPaise) {
        throw new RazorpayApiError(
          400,
          'BAD_REQUEST_ERROR',
          'Capture amount must equal the authorized amount',
        );
      }
      const captured: RazorpayPayment = { ...payment, status: 'captured' };
      this.payments.set(paymentId, captured);
      this.markOrder(captured);
      return { ...captured };
    });
  }

  fetchOrderPayments(orderId: string): Promise<RazorpayPayment[]> {
    this.calls.fetchOrderPayments += 1;
    return this.run(() =>
      [...this.payments.values()]
        .filter((payment) => payment.orderId === orderId)
        .map((p) => ({ ...p })),
    );
  }

  fetchOrder(orderId: string): Promise<RazorpayOrder> {
    this.calls.fetchOrder += 1;
    return this.run(() => {
      const order = this.orders.get(orderId);
      if (!order) {
        throw new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'The id provided does not exist');
      }
      return toOrder(order);
    });
  }

  /** Registers an order created outside /orders (e.g. by a payment link) with a receipt. */
  registerExternalOrder(orderId: string, amount: number, receipt: string): void {
    this.orders.set(orderId, {
      id: orderId,
      amount,
      currency: 'INR',
      receipt,
      status: 'paid',
      notes: {},
    });
  }

  /** Simulates the customer completing Checkout for an order. */
  pay(orderId: string, options: PayOptions = {}): RazorpayPayment {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Unknown fake order ${orderId}`);
    }
    const payment: RazorpayPayment = {
      id: newId('pay_'),
      amount: options.amount ?? order.amount,
      currency: options.currency ?? order.currency,
      status: options.status ?? 'captured',
      orderId,
      method: options.method ?? 'upi',
    };
    this.payments.set(payment.id, payment);
    this.markOrder(payment);
    return { ...payment };
  }

  private markOrder(payment: RazorpayPayment): void {
    const order = payment.orderId ? this.orders.get(payment.orderId) : undefined;
    if (order) {
      order.status = payment.status === 'captured' ? 'paid' : 'attempted';
    }
  }

  private requirePayment(paymentId: string): RazorpayPayment {
    const payment = this.payments.get(paymentId);
    if (!payment) {
      throw new RazorpayApiError(400, 'BAD_REQUEST_ERROR', 'The id provided does not exist');
    }
    return payment;
  }

  private run<T>(work: () => T): Promise<T> {
    if (this.unavailable) {
      return Promise.reject(new RazorpayUnavailableError('simulated outage'));
    }
    try {
      return Promise.resolve(work());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function toOrder(order: StoredOrder): RazorpayOrder {
  return {
    id: order.id,
    amount: order.amount,
    currency: order.currency,
    receipt: order.receipt,
    status: order.status,
  };
}

export function newId(prefix: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(14);
  let id = prefix;
  for (const byte of bytes) {
    id += alphabet[byte % alphabet.length] ?? 'x';
  }
  return id;
}
