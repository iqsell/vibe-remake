import { 
  ProviderAdapter, 
  ProviderConfig, 
  ModelConfig, 
  ChatRequest, 
  ChatResponse, 
  ProviderCapabilities,
  ProviderError,
  ProviderErrorClass,
  GenerateOptions 
} from './types.js';
import { logger, createChildLogger } from '../observability/logger.js';

export class AIGateway {
  private providers = new Map<string, ProviderAdapter>();
  private modelToProvider = new Map<string, string>();
  private providerConfigs = new Map<string, ProviderConfig>();

  registerProvider(adapter: ProviderAdapter, config: ProviderConfig): void {
    this.providers.set(config.id, adapter);
    this.providerConfigs.set(config.id, config);
    
    for (const model of config.models) {
      if (model.enabled) {
        this.modelToProvider.set(model.id, config.id);
      }
    }
    
    logger.info({ target: 'ai.gateway', providerId: config.id, models: config.models.length }, 'Provider registered');
  }

  unregisterProvider(providerId: string): void {
    const config = this.providerConfigs.get(providerId);
    if (config) {
      for (const model of config.models) {
        this.modelToProvider.delete(model.id);
      }
    }
    this.providers.delete(providerId);
    this.providerConfigs.delete(providerId);
    logger.info({ target: 'ai.gateway', providerId }, 'Provider unregistered');
  }

  getProvider(providerId: string): ProviderAdapter | undefined {
    return this.providers.get(providerId);
  }

  getProviderForModel(modelId: string): ProviderAdapter | undefined {
    const providerId = this.modelToProvider.get(modelId);
    if (!providerId) return undefined;
    return this.providers.get(providerId);
  }

  getProviderConfig(providerId: string): ProviderConfig | undefined {
    return this.providerConfigs.get(providerId);
  }

  getAllProviders(): ProviderAdapter[] {
    return Array.from(this.providers.values());
  }

  getEnabledProviders(): ProviderAdapter[] {
    return Array.from(this.providers.entries())
      .filter(([, adapter]) => {
        const config = this.providerConfigs.get(adapter.id);
        return config?.enabled ?? false;
      })
      .map(([, adapter]) => adapter);
  }

  getAvailableModels(): ModelConfig[] {
    const models: ModelConfig[] = [];
    for (const config of this.providerConfigs.values()) {
      if (config.enabled) {
        for (const model of config.models) {
          if (model.enabled) {
            models.push({ ...model, capabilities: { ...model.capabilities, providerId: config.id } });
          }
        }
      }
    }
    return models;
  }

  async generate(
    modelId: string, 
    request: ChatRequest, 
    options: GenerateOptions = {}
  ): Promise<ChatResponse> {
    const provider = this.getProviderForModel(modelId);
    if (!provider) {
      throw this.createError(
        ProviderErrorClass.UNSUPPORTED_CAPABILITY,
        `No provider found for model: ${modelId}`,
        false
      );
    }

    const childLogger = createChildLogger({ 
      target: 'ai.gateway', 
      providerId: provider.id, 
      modelId 
    });

    const startTime = Date.now();
    
    try {
      childLogger.debug({ target: 'ai.gateway', messageCount: request.messages.length }, 'Generating response');
      
      const response = await provider.generate(request, options);
      
      childLogger.info({ 
        target: 'ai.gateway', 
        latencyMs: Date.now() - startTime,
        finishReason: response.finishReason,
        toolCalls: response.toolCalls.length,
        usage: response.usage,
      }, 'Generation completed');

      return response;
    } catch (error) {
      const classified = provider.classifyError(error);
      childLogger.error({ 
        target: 'ai.gateway', 
        latencyMs: Date.now() - startTime,
        errorClass: classified.errorClass,
        retryable: classified.retryable,
      }, 'Generation failed');
      throw classified;
    }
  }

  async checkCapabilities(modelId: string): Promise<ProviderCapabilities | null> {
    const provider = this.getProviderForModel(modelId);
    if (!provider) return null;
    return provider.getCapabilities(modelId);
  }

  async healthCheck(providerId?: string): Promise<Record<string, boolean>> {
    if (providerId) {
      const provider = this.providers.get(providerId);
      if (!provider) return { [providerId]: false };
      try {
        const healthy = await provider.healthCheck();
        return { [providerId]: healthy };
      } catch {
        return { [providerId]: false };
      }
    }

    const results: Record<string, boolean> = {};
    for (const [id, provider] of this.providers) {
      try {
        results[id] = await provider.healthCheck();
      } catch {
        results[id] = false;
      }
    }
    return results;
  }

  private createError(
    errorClass: ProviderErrorClass,
    message: string,
    retryable: boolean,
    providerId = 'unknown'
  ): ProviderError {
    const error = new Error(message) as ProviderError;
    error.providerId = providerId;
    error.errorClass = errorClass;
    error.retryable = retryable;
    return error;
  }
}

// Singleton instance
let gatewayInstance: AIGateway | null = null;

export function getAIGateway(): AIGateway {
  if (!gatewayInstance) {
    gatewayInstance = new AIGateway();
  }
  return gatewayInstance;
}

export function resetAIGateway(): void {
  gatewayInstance = null;
}