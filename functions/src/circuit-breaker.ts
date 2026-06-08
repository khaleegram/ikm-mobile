import { StructuredLogger, LogContext } from './logger';

export interface CircuitBreakerConfig {
  failureThreshold: number; // 5 failures
  successThreshold: number; // 2 successes to close
  timeout: number; // 60000ms (1 minute)
}

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export class CircuitBreaker<T> {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number | null = null;
  private readonly config: CircuitBreakerConfig;
  private readonly serviceName: string;

  constructor(serviceName: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.serviceName = serviceName;
    this.config = {
      failureThreshold: config.failureThreshold || 5,
      successThreshold: config.successThreshold || 2,
      timeout: config.timeout || 60000
    };
  }

  async call<R>(fn: () => Promise<R>, context: LogContext): Promise<R> {
    if (this.state === CircuitState.OPEN) {
      if (this.isTimeoutExpired()) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        StructuredLogger.info(`${this.serviceName} circuit breaker entering HALF_OPEN state`, context);
      } else {
        const error = new Error(
          `${this.serviceName} service temporarily unavailable (circuit open)`
        );
        StructuredLogger.error(`${this.serviceName} circuit breaker OPEN`, error, {
          ...context,
          functionName: `circuit-breaker-${this.serviceName}`,
          state: this.state
        });
        throw error;
      }
    }

    try {
      const result = await fn();
      this.onSuccess(context);
      return result;
    } catch (error) {
      this.onFailure(context, error);
      throw error;
    }
  }

  private onSuccess(context: LogContext) {
    this.failureCount = 0;
    this.lastFailureTime = null;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
        StructuredLogger.info(`${this.serviceName} circuit breaker CLOSED (recovered)`, {
          ...context,
          functionName: `circuit-breaker-${this.serviceName}`,
          state: this.state
        });
      }
    }
  }

  private onFailure(context: LogContext, error: any) {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.successCount = 0;
      StructuredLogger.warn(
        `${this.serviceName} circuit breaker reopening after failure in HALF_OPEN state`,
        {
          ...context,
          functionName: `circuit-breaker-${this.serviceName}`,
          state: this.state,
          failureCount: this.failureCount
        }
      );
    } else if (this.failureCount >= this.config.failureThreshold && this.state === CircuitState.CLOSED) {
      this.state = CircuitState.OPEN;
      StructuredLogger.warn(
        `${this.serviceName} circuit breaker opened after ${this.failureCount} failures`,
        {
          ...context,
          functionName: `circuit-breaker-${this.serviceName}`,
          state: this.state,
          failureCount: this.failureCount,
          error: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  private isTimeoutExpired(): boolean {
    if (this.lastFailureTime === null) return true;
    return Date.now() - this.lastFailureTime >= this.config.timeout;
  }

  getState(): CircuitState {
    return this.state;
  }

  getMetrics() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      isTimeoutExpired: this.isTimeoutExpired()
    };
  }

  // For testing purposes
  reset() {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
  }
}

// Singleton instances for critical services
export const paystackCircuitBreaker = new CircuitBreaker('Paystack', {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000 // 1 minute
});

export const firestoreCircuitBreaker = new CircuitBreaker('Firestore', {
  failureThreshold: 10,
  successThreshold: 3,
  timeout: 30000 // 30 seconds
});
