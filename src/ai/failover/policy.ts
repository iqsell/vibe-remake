import { ProviderError, ProviderErrorClass, ProviderCapabilities } from '../types.js';
import { logger } from '../../observability/logger.js';
import { CircuitBreaker, circuitBreakerRegistry, CircuitState } from './circuit-breaker.js';
import { QuotaTracker, quotaTracker } from './quota-state.js';

export interface FailoverPolicyConfig {
  maxImmediateAttempts: number;
  taskBudgetMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  enableCircuitBreaker: boolean;
  enableQuotaTracking: boolean;
}

export interface AttemptResult {
  success: boolean;
  response?: any;
  error?: ProviderError;
  providerId: string;
  modelId: string;
  latencyMs: number;
  attemptNumber: number;
}

export interface FailoverDecision {
  shouldRetry: boolean;
  nextProviderId?: string;
  nextModelId?: string;
  delayMs?: number;
  reason: string;
}

export class FailoverPolicy {
  private circuitBreakers = circuitBreakerRegistry;
  private quotaTracker = quotaTracker;
  private config: FailoverPolicyConfig;

  constructor(config: Partial<FailoverPolicyConfig> = {}) {
    this.config = {
      maxImmediateAttempts: 3,
      taskBudgetMs: 300000,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
      jitterFactor: 0.3,
      enableCircuitBreaker: true,
      enableQuotaTracking: true,
      ...config,
    };
  }

  async executeWithFailover<T>(
    candidates: Array<{ providerId: string; modelId: string }>,
    operation: (providerId: string, modelId: string) => Promise<T>,
    taskStartTime: number
  ): Promise<{ result: T; attempts: AttemptResult[] }> {
    const attempts: AttemptResult[] = [];
    let lastError: ProviderError | null = null;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const attemptNumber = i + 1;

      // Check task budget
      if (Date.now() - taskStartTime > this.config.taskBudgetMs) {
        logger.warn({ target: 'ai.failover.policy' }, 'Task budget exceeded');
        break;
      }

      // Check max attempts
      if (attemptNumber > this.config.maxImmediateAttempts) {
        logger.warn({ target: 'ai.failover.policy', attempts: attemptNumber }, 'Max immediate attempts reached');
        break;
      }

      // Check circuit breaker
      if (this.config.enableCircuitBreaker) {
        const breaker = this.circuitBreakers.get(candidate.providerId);
        if (breaker && breaker.getState() === CircuitState.OPEN) {
          logger.debug({ target: 'ai.failover.policy', providerId: candidate.providerId }, 'Circuit breaker open, skipping');
          attempts.push({
            success: false,
            error: this.createError(ProviderErrorClass.PROVIDER_SERVER_ERROR, 'Circuit breaker open', false, candidate.providerId),
            providerId: candidate.providerId,
            modelId: candidate.modelId,
            latencyMs: 0,
            attemptNumber,
          });
          continue;
        }
      }

      // Check quota
      if (this.config.enableQuotaTracking && this.quotaTracker.isExhausted(candidate.providerId)) {
        logger.debug({ target: 'ai.failover.policy', providerId: candidate.providerId }, 'Quota exhausted, skipping');
        attempts.push({
          success: false,
          error: this.createError(ProviderErrorClass.QUOTA_EXHAUSTED, 'Quota exhausted', false, candidate.providerId),
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          latencyMs: 0,
          attemptNumber,
        });
        continue;
      }

      const attemptStart = Date.now();
      
      try {
        const result = await operation(candidate.providerId, candidate.modelId);
        const latencyMs = Date.now() - attemptStart;
        
        attempts.push({
          success: true,
          response: result,
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          latencyMs,
          attemptNumber,
        });

        logger.info({ 
          target: 'ai.failover.policy', 
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          latencyMs,
          attemptNumber,
        }, 'Attempt succeeded');

        return { result, attempts };
      } catch (error) {
        const latencyMs = Date.now() - attemptStart;
        const providerError = error instanceof Error && 'errorClass' in error 
          ? error as ProviderError 
          : this.normalizeError(error, candidate.providerId);
        
        lastError = providerError;

        attempts.push({
          success: false,
          error: providerError,
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          latencyMs,
          attemptNumber,
        });

        logger.warn({ 
          target: 'ai.failover.policy', 
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          errorClass: providerError.errorClass,
          retryable: providerError.retryable,
          latencyMs,
          attemptNumber,
        }, 'Attempt failed');

        // Decide whether to retry or failover
        const decision = this.makeDecision(providerError, attemptNumber, candidates.length);
        
        if (!decision.shouldRetry) {
          logger.warn({ target: 'ai.failover.policy', reason: decision.reason }, 'Stopping failover');
          break;
        }

        // Wait before next attempt
        if (decision.delayMs && decision.delayMs > 0) {
          logger.debug({ target: 'ai.failover.policy', delayMs: decision.delayMs }, 'Waiting before next attempt');
          await new Promise(resolve => setTimeout(resolve, decision.delayMs));
        }
      }
    }

    throw lastError ?? this.createError(ProviderErrorClass.UNKNOWN, 'All providers failed', false, 'failover');
  }

  private makeDecision(error: ProviderError, attemptNumber: number, totalCandidates: number): FailoverDecision {
    // Non-retryable errors: stop immediately
    if (!error.retryable) {
      return { shouldRetry: false, reason: `Non-retryable error: ${error.errorClass}` };
    }

    // Check specific error classes
    switch (error.errorClass) {
      case ProviderErrorClass.AUTHENTICATION:
      case ProviderErrorClass.AUTHORIZATION:
      case ProviderErrorClass.INVALID_REQUEST:
      case ProviderErrorClass.UNSUPPORTED_CAPABILITY:
      case ProviderErrorClass.CONTENT_REFUSAL:
      case ProviderErrorClass.QUOTA_EXHAUSTED:
        return { shouldRetry: false, reason: `Error class ${error.errorClass} is not retryable` };

      case ProviderErrorClass.RATE_LIMITED:
        // Wait for retry-after or calculated delay
        const delay = error.retryAfterMs ?? this.calculateDelay(attemptNumber);
        return { shouldRetry: true, delayMs: delay, reason: 'Rate limited' };

      case ProviderErrorClass.TIMEOUT:
      case ProviderErrorClass.TRANSIENT_NETWORK:
      case ProviderErrorClass.PROVIDER_SERVER_ERROR:
        // Retry with exponential backoff
        return { shouldRetry: true, delayMs: this.calculateDelay(attemptNumber), reason: 'Transient error' };

      case ProviderErrorClass.MALFORMED_RESPONSE:
        // Might be a model issue, try next provider
        return { shouldRetry: true, delayMs: 0, reason: 'Malformed response, trying next provider' };

      default:
        // Unknown error - retry with backoff
        return { shouldRetry: true, delayMs: this.calculateDelay(attemptNumber), reason: 'Unknown error, retrying' };
    }
  }

  private calculateDelay(attemptNumber: number): number {
    const exponentialDelay = this.config.baseDelayMs * Math.pow(2, attemptNumber - 1);
    const jitter = exponentialDelay * this.config.jitterFactor * Math.random();
    return Math.min(exponentialDelay + jitter, this.config.maxDelayMs);
  }

  private createError(
    errorClass: ProviderErrorClass,
    message: string,
    retryable: boolean,
    providerId: string
  ): ProviderError {
    const error = new Error(message) as ProviderError;
    error.providerId = providerId;
    error.errorClass = errorClass;
    error.retryable = retryable;
    return error;
  }

  private normalizeError(error: unknown, providerId: string): ProviderError {
    if (error instanceof Error) {
      const providerError = new Error(error.message) as ProviderError;
      providerError.providerId = providerId;
      providerError.originalError = error;
      
      const message = error.message.toLowerCase();
      
      if (message.includes('unauthorized') || message.includes('invalid api key')) {
        providerError.errorClass = ProviderErrorClass.AUTHENTICATION;
        providerError.retryable = false;
      } else if (message.includes('rate limit')) {
        providerError.errorClass = ProviderErrorClass.RATE_LIMITED;
        providerError.retryable = true;
      } else if (message.includes('quota') || message.includes('billing')) {
        providerError.errorClass = ProviderErrorClass.QUOTA_EXHAUSTED;
        providerError.retryable = false;
      } else if (message.includes('timeout')) {
        providerError.errorClass = ProviderErrorClass.TIMEOUT;
        providerError.retryable = true;
      } else if (message.includes('network') || message.includes('econnrefused')) {
        providerError.errorClass = ProviderErrorClass.TRANSIENT_NETWORK;
        providerError.retryable = true;
      } else if (message.includes('500') || message.includes('502') || message.includes('503')) {
        providerError.errorClass = ProviderErrorClass.PROVIDER_SERVER_ERROR;
        providerError.retryable = true;
      } else if (message.includes('content filter') || message.includes('safety')) {
        providerError.errorClass = ProviderErrorClass.CONTENT_REFUSAL;
        providerError.retryable = false;
      } else {
        providerError.errorClass = ProviderErrorClass.UNKNOWN;
        providerError.retryable = true;
      }

      return providerError;
    }

    const unknownError = new Error(String(error)) as ProviderError;
    unknownError.providerId = providerId;
    unknownError.errorClass = ProviderErrorClass.UNKNOWN;
    unknownError.retryable = true;
    return unknownError;
  }

  getCircuitBreakerState(providerId: string): CircuitState | undefined {
    const breaker = this.circuitBreakers.get(providerId);
    return breaker?.getState();
  }

  getQuotaState(providerId: string) {
    return this.quotaTracker.getQuota(providerId);
  }

  resetProviderState(providerId: string): void {
    this.circuitBreakers.reset(providerId);
    this.quotaTracker.reset(providerId);
  }
}

export const failoverPolicy = new FailoverPolicy();