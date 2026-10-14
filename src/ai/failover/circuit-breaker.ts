import { logger } from '../../observability/logger.js';

export interface CircuitBreakerConfig {
  failureThreshold: number;      // Number of failures before opening
  successThreshold: number;      // Number of successes in half-open before closing
  timeoutMs: number;             // Time before transitioning from open to half-open
  excludedErrors?: string[];     // Error classes that don't count towards failures
}

export enum CircuitState {
  CLOSED = 'closed',       // Normal operation
  OPEN = 'open',           // Failing, reject requests
  HALF_OPEN = 'half_open', // Testing if service recovered
}

export class CircuitBreaker {
  private state = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private nextAttempt = 0;

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new Error(`Circuit breaker ${this.name} is OPEN`);
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  private canExecute(): boolean {
    switch (this.state) {
      case CircuitState.CLOSED:
        return true;
      case CircuitState.OPEN:
        if (Date.now() >= this.nextAttempt) {
          this.transitionToHalfOpen();
          return true;
        }
        return false;
      case CircuitState.HALF_OPEN:
        return true;
      default:
        return false;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.transitionToClosed();
      }
    }
  }

  private onFailure(error: unknown): void {
    this.lastFailureTime = Date.now();
    
    // Check if error should be excluded
    if (this.config.excludedErrors) {
      const errorClass = this.getErrorClass(error);
      if (this.config.excludedErrors.includes(errorClass)) {
        return; // Don't count towards failure threshold
      }
    }

    this.failures++;
    this.successes = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open goes back to open
      this.transitionToOpen();
    } else if (this.state === CircuitState.CLOSED && this.failures >= this.config.failureThreshold) {
      this.transitionToOpen();
    }
  }

  private transitionToOpen(): void {
    this.state = CircuitState.OPEN;
    this.nextAttempt = Date.now() + this.config.timeoutMs;
    logger.warn({ target: 'ai.failover.circuit', name: this.name }, 'Circuit breaker opened');
  }

  private transitionToHalfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.successes = 0;
    logger.info({ target: 'ai.failover.circuit', name: this.name }, 'Circuit breaker half-open');
  }

  private transitionToClosed(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    logger.info({ target: 'ai.failover.circuit', name: this.name }, 'Circuit breaker closed');
  }

  private getErrorClass(error: unknown): string {
    if (error instanceof Error && 'errorClass' in error) {
      return (error as any).errorClass;
    }
    return 'UNKNOWN';
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): { state: CircuitState; failures: number; successes: number; nextAttempt: number } {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      nextAttempt: this.nextAttempt,
    };
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = 0;
    this.nextAttempt = 0;
  }
}

export class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  getOrCreate(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      breaker = new CircuitBreaker(name, {
        failureThreshold: 5,
        successThreshold: 2,
        timeoutMs: 60000,
        excludedErrors: ['AUTHENTICATION', 'AUTHORIZATION', 'INVALID_REQUEST', 'UNSUPPORTED_CAPABILITY', 'QUOTA_EXHAUSTED', 'CONTENT_REFUSAL'],
        ...config,
      });
      this.breakers.set(name, breaker);
    }
    return breaker;
  }

  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  reset(name: string): void {
    const breaker = this.breakers.get(name);
    if (breaker) breaker.reset();
  }

  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}

export const circuitBreakerRegistry = new CircuitBreakerRegistry();