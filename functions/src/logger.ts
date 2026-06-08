import * as functions from 'firebase-functions';

export interface LogContext {
  userId?: string;
  reference?: string;
  functionName: string;
  requestId?: string;
  duration?: number;
  statusCode?: number;
  amount?: number;
  email?: string;
  [key: string]: any;
}

export class StructuredLogger {
  static info(message: string, context: LogContext) {
    functions.logger.info(message, {
      timestamp: new Date().toISOString(),
      severity: 'INFO',
      ...context
    });
  }

  static warn(message: string, context: LogContext) {
    functions.logger.warn(message, {
      timestamp: new Date().toISOString(),
      severity: 'WARNING',
      ...context
    });
  }

  static error(message: string, error: Error | any, context: LogContext) {
    const errorData = error instanceof Error ? {
      message: error.message,
      stack: error.stack,
      name: error.name
    } : {
      message: String(error),
      stack: undefined,
      name: 'UnknownError'
    };

    functions.logger.error(message, {
      timestamp: new Date().toISOString(),
      severity: 'ERROR',
      error: errorData,
      ...context
    });
  }
}

export function logPaymentEvent(event: {
  type: 'PAYMENT_INIT' | 'PAYMENT_VERIFY' | 'WEBHOOK_RECEIVED' | 'ORDER_CREATED' | 'PAYOUT_REQUEST';
  reference?: string;
  userId?: string;
  amount?: number;
  status?: string;
  duration?: number;
  error?: string;
  source?: 'webhook' | 'api' | 'client';
}) {
  const context: LogContext = {
    functionName: 'payment-sdk',
    reference: event.reference,
    userId: event.userId,
    amount: event.amount,
    source: event.source || 'api',
    duration: event.duration
  };

  if (event.error) {
    StructuredLogger.error(event.type, new Error(event.error), context);
  } else {
    StructuredLogger.info(event.type, { ...context, status: event.status });
  }
}

export function logOrderEvent(event: {
  type: 'ORDER_CREATED' | 'ORDER_UPDATED' | 'ORDER_COMPLETED' | 'ORDER_FAILED';
  orderId: string;
  customerId: string;
  total?: number;
  status?: string;
  duration?: number;
  error?: string;
}) {
  const context: LogContext = {
    functionName: 'orders-sdk',
    reference: event.orderId,
    userId: event.customerId,
    amount: event.total,
    duration: event.duration
  };

  if (event.error) {
    StructuredLogger.error(event.type, new Error(event.error), context);
  } else {
    StructuredLogger.info(event.type, { ...context, status: event.status });
  }
}

export function logPayoutEvent(event: {
  type: 'PAYOUT_REQUESTED' | 'PAYOUT_PROCESSED' | 'PAYOUT_FAILED' | 'PAYOUT_CANCELLED';
  payoutId: string;
  sellerId: string;
  amount: number;
  duration?: number;
  error?: string;
}) {
  const context: LogContext = {
    functionName: 'payouts-sdk',
    reference: event.payoutId,
    userId: event.sellerId,
    amount: event.amount,
    duration: event.duration
  };

  if (event.error) {
    StructuredLogger.error(event.type, new Error(event.error), context);
  } else {
    StructuredLogger.info(event.type, { ...context });
  }
}
