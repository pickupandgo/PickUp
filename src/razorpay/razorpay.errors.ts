/** Razorpay definitively rejected the request (4xx) or answered with something unusable. */
export class RazorpayApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly errorCode: string | null,
    readonly description: string | null,
  ) {
    super(`Razorpay rejected the request (HTTP ${httpStatus}${errorCode ? `, ${errorCode}` : ''})`);
    this.name = 'RazorpayApiError';
  }
}

/** Razorpay could not be reached or is temporarily failing (timeout, network, 5xx, 429). Retryable. */
export class RazorpayUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RazorpayUnavailableError';
  }
}
