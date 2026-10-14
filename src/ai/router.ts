import { 
  ProviderConfig, 
  ModelConfig, 
  ChatRequest, 
  ChatResponse, 
  GenerateOptions,
  ProviderError,
  ProviderErrorClass,
  RouterConfig 
} from './types.js';
import { AIGateway, getAIGateway } from './gateway.js';
import { logger, createChildLogger } from '../observability/logger.js';
import { getEnv } from '../config/env.js';

interface ProviderState {
  providerId: string;
  consecutiveFailures: number;
  lastFailureTime: number;
  circuitOpen: boolean;
  circuitOpenTime: number;
  rateLimitedUntil: number;
  quotaExhausted: boolean;
}

export class ProviderRouter {
  private gateway: AIGateway;
  private config: RouterConfig;
  private providerStates = new Map<string, ProviderState>();
  private modelCapabilities = new Map<string, Map<string, boolean>>(); // modelId -> capability -> supported

  constructor(gateway: AIGateway, config?: Partial<RouterConfig>) {
    this.gateway = gateway;
    const env = getEnv();
    this.config = {
      defaultProvider: env.DEFAULT_PROVIDER,
      providerOrder: env.PROVIDER_ORDER,
      taskTypePreferences: {},
      failover: {
        maxImmediateAttempts: env.FAILOVER_MAX_IMMEDIATE_ATTEMPTS,
        taskBudgetMs: env.FAILOVER_TASK_BUDGET_MS,
        enableCircuitBreaker: true,
        circuitBreakerThreshold: 5,
        circuitBreakerTimeoutMs: 60000,
      },
      ...config,
    };
  }

  async generate(
    request: ChatRequest,
    options: GenerateOptions & { 
      taskType?: string; 
      preferredModel?: string;
      requiredCapabilities?: string[];
    } = {}
  ): Promise<ChatResponse> {
    const { taskType, preferredModel, requiredCapabilities = [], ...generateOptions } = options;
    const childLogger = createChildLogger({ 
      target: 'ai.router', 
      taskType,
      preferredModel 
    });

    // Determine model and provider candidates
    const candidates = this.selectCandidates(taskType, preferredModel, requiredCapabilities);
    
    if (candidates.length === 0) {
      throw this.createError(
        ProviderErrorClass.UNSUPPORTED_CAPABILITY,
        'No eligible providers found for the request',
        false
      );
    }

    const taskStartTime = Date.now();
    let lastError: ProviderError | null = null;
    let attempts = 0;

    for (const candidate of candidates) {
      const { providerId, modelId } = candidate;
      
      // Check if we should skip this provider
      if (this.shouldSkipProvider(providerId)) {
        childLogger.debug({ target: 'ai.router', providerId, modelId }, 'Skipping provider due to state');
        continue;
      }

      // Check budget
      if (Date.now() - taskStartTime > this.config.failover.taskBudgetMs) {
        childLogger.warn({ target: 'ai.router' }, 'Task budget exceeded');
        break;
      }

      attempts++;
      if (attempts > this.config.failover.maxImmediateAttempts) {
        childLogger.warn({ target: 'ai.router', attempts }, 'Max immediate attempts reached');
        break;
      }

      try {
        childLogger.info({ target: 'ai.router', providerId, modelId, attempt: attempts }, 'Attempting generation');
        
        const response = await this.gateway.generate(modelId, request, generateOptions);
        
        // Success - reset provider state
        this.recordSuccess(providerId);
        childLogger.info({ target: 'ai.router', providerId, modelId }, 'Generation succeeded');
        return response;
      } catch (error) {
        const providerError = error as ProviderError;
        lastError = providerError;
        
        childLogger.warn({ 
          target: 'ai.router', 
          providerId, 
          modelId, 
          errorClass: providerError.errorClass,
          retryable: providerError.retryable,
        }, 'Generation failed');

        this.recordFailure(providerId, providerError);

        // Don't retry on non-retryable errors
        if (!providerError.retryable) {
          childLogger.warn({ target: 'ai.router', errorClass: providerError.errorClass }, 'Non-retryable error, stopping failover');
          break;
        }

        // Wait before retry if rate limited
        if (providerError.retryAfterMs) {
          const waitTime = Math.min(providerError.retryAfterMs, 5000);
          childLogger.debug({ target: 'ai.router', waitMs: waitTime }, 'Waiting before retry');
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    // All candidates exhausted
    throw lastError ?? this.createError(
      ProviderErrorClass.UNKNOWN,
      'All providers failed',
      false
    );
  }

  private selectCandidates(
    taskType: string | undefined,
    preferredModel: string | undefined,
    requiredCapabilities: string[]
  ): Array<{ providerId: string; modelId: string }> {
    const candidates: Array<{ providerId: string; modelId: string }> = [];
    const allModels = this.gateway.getAvailableModels();

    // If preferred model specified, try it first
    if (preferredModel) {
      const model = allModels.find(m => m.id === preferredModel);
      if (model && this.modelMatchesCapabilities(model, requiredCapabilities)) {
        const providerId = model.capabilities.providerId;
        if (providerId && !this.shouldSkipProvider(providerId)) {
          candidates.push({ providerId, modelId: model.id });
        }
      }
    }

    // Get provider order for task type
    const providerOrder = taskType && this.config.taskTypePreferences[taskType]
      ? this.config.taskTypePreferences[taskType]
      : this.config.providerOrder;

    // Add models from providers in order
    for (const providerId of providerOrder) {
      const providerConfig = this.gateway.getProviderConfig(providerId);
      if (!providerConfig || !providerConfig.enabled) continue;
      if (this.shouldSkipProvider(providerId)) continue;

      for (const model of providerConfig.models) {
        if (!model.enabled) continue;
        if (!this.modelMatchesCapabilities(model, requiredCapabilities)) continue;
        
        // Avoid duplicates
        if (!candidates.some(c => c.modelId === model.id)) {
          candidates.push({ providerId, modelId: model.id });
        }
      }
    }

    return candidates;
  }

  private modelMatchesCapabilities(model: ModelConfig, requiredCapabilities: string[]): boolean {
    const caps = model.capabilities;
    for (const cap of requiredCapabilities) {
      switch (cap) {
        case 'toolCalling':
          if (!caps.toolCalling) return false;
          break;
        case 'structuredOutput':
          if (!caps.structuredOutput) return false;
          break;
        case 'streaming':
          if (!caps.streaming) return false;
          break;
      }
    }
    return true;
  }

  private shouldSkipProvider(providerId: string): boolean {
    const state = this.providerStates.get(providerId);
    if (!state) return false;

    // Check circuit breaker
    if (state.circuitOpen) {
      if (Date.now() - state.circuitOpenTime > this.config.failover.circuitBreakerTimeoutMs) {
        // Half-open: allow one request through
        state.circuitOpen = false;
        return false;
      }
      return true;
    }

    // Check rate limit
    if (state.rateLimitedUntil > Date.now()) {
      return true;
    }

    // Check quota
    if (state.quotaExhausted) {
      return true;
    }

    return false;
  }

  private recordSuccess(providerId: string): void {
    const state = this.providerStates.get(providerId) ?? { 
      providerId, 
      consecutiveFailures: 0, 
      lastFailureTime: 0, 
      circuitOpen: false, 
      circuitOpenTime: 0,
      rateLimitedUntil: 0,
      quotaExhausted: false,
    };
    
    state.consecutiveFailures = 0;
    state.circuitOpen = false;
    this.providerStates.set(providerId, state);
  }

  private recordFailure(providerId: string, error: ProviderError): void {
    const state = this.providerStates.get(providerId) ?? { 
      providerId, 
      consecutiveFailures: 0, 
      lastFailureTime: 0, 
      circuitOpen: false, 
      circuitOpenTime: 0,
      rateLimitedUntil: 0,
      quotaExhausted: false,
    };

    state.consecutiveFailures++;
    state.lastFailureTime = Date.now();

    switch (error.errorClass) {
      case ProviderErrorClass.RATE_LIMITED:
        state.rateLimitedUntil = Date.now() + (error.retryAfterMs ?? 60000);
        break;
      case ProviderErrorClass.QUOTA_EXHAUSTED:
        state.quotaExhausted = true;
        break;
      case ProviderErrorClass.AUTHENTICATION:
      case ProviderErrorClass.AUTHORIZATION:
        // Don't retry auth errors
        state.circuitOpen = true;
        state.circuitOpenTime = Date.now();
        break;
    }

    // Check circuit breaker
    if (this.config.failover.enableCircuitBreaker && 
        state.consecutiveFailures >= this.config.failover.circuitBreakerThreshold) {
      state.circuitOpen = true;
      state.circuitOpenTime = Date.now();
      logger.warn({ target: 'ai.router', providerId }, 'Circuit breaker opened');
    }

    this.providerStates.set(providerId, state);
  }

  getProviderState(providerId: string): ProviderState | undefined {
    return this.providerStates.get(providerId);
  }

  getAllProviderStates(): ProviderState[] {
    return Array.from(this.providerStates.values());
  }

  resetProviderState(providerId: string): void {
    this.providerStates.delete(providerId);
  }

  private createError(
    errorClass: ProviderErrorClass,
    message: string,
    retryable: boolean
  ): ProviderError {
    const error = new Error(message) as ProviderError;
    error.providerId = 'router';
    error.errorClass = errorClass;
    error.retryable = retryable;
    return error;
  }
}

let routerInstance: ProviderRouter | null = null;

export function getProviderRouter(gateway?: AIGateway): ProviderRouter {
  if (!routerInstance) {
    const gw = gateway ?? getAIGateway();
    routerInstance = new ProviderRouter(gw);
  }
  return routerInstance;
}

export function resetProviderRouter(): void {
  routerInstance = null;
}