import { 
  ProviderAdapter, 
  ProviderConfig, 
  ChatRequest, 
  ChatResponse, 
  ProviderCapabilities,
  ProviderError,
  ProviderErrorClass,
  GenerateOptions,
  ToolDefinition,
  ToolCall 
} from '../types.js';
import { logger, createChildLogger } from '../../observability/logger.js';
import { normalizeError, formatErrorForLogging } from '../errors.js';
import { 
  normalizeFinishReason, 
  normalizeToolCalls, 
  normalizeUsage,
  normalizeMessages,
} from '../normalizers/base.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

interface OpenRouterTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  tools?: OpenRouterTool[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  response_format?: { type: 'json_object' | 'json_schema'; json_schema?: any };
  stream?: boolean;
  route?: string;
  provider?: {
    order?: string[];
    allow_fallbacks?: boolean;
    require_parameters?: boolean;
    data_collection?: 'allow' | 'deny';
  };
}

interface OpenRouterResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: any[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenRouterModel {
  id: string;
  name: string;
  description: string;
  pricing: {
    prompt: string;
    completion: string;
  };
  context_length: number;
  architecture: {
    modality: string;
    tokenizer: string;
    instruct_type: string | null;
  };
  top_provider: {
    max_completion_tokens: number;
  };
  per_request_limits: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

export class OpenRouterAdapter implements ProviderAdapter {
  readonly id = 'openrouter';
  readonly name = 'OpenRouter';
  
  private apiKey: string;
  private baseUrl: string;
  private enabledModels: Set<string>;
  private httpReferer?: string;
  private xTitle?: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? OPENROUTER_API_URL;
    this.enabledModels = new Set(config.models.filter(m => m.enabled).map(m => m.id));
    this.httpReferer = config.models[0]?.capabilities?.httpReferer;
    this.xTitle = config.models[0]?.capabilities?.xTitle;
  }

  async getCapabilities(modelId: string): Promise<ProviderCapabilities> {
    // OpenRouter routes to various models, capabilities vary
    // We'll return conservative defaults and let the actual model determine
    return { 
      toolCalling: true, 
      structuredOutput: true, 
      streaming: true, 
      maxContextTokens: 128000, 
      maxOutputTokens: 4096, 
      supportedModels: [modelId] 
    };
  }

  async generate(request: ChatRequest, options: GenerateOptions = {}): Promise<ChatResponse> {
    const childLogger = createChildLogger({ target: 'ai.provider.openrouter', modelId: request.metadata?.modelId });
    const startTime = Date.now();

    const modelId = (request.metadata?.modelId as string) ?? 'openrouter/auto';
    
    // OpenRouter uses model IDs like "openrouter/auto" or specific model IDs
    const openRouterModelId = modelId.startsWith('openrouter/') ? modelId : `openrouter/${modelId}`;
    
    if (!this.enabledModels.has(modelId) && !this.enabledModels.has(openRouterModelId)) {
      // OpenRouter allows any model, so we don't strictly enforce
      childLogger.warn({ target: 'ai.provider.openrouter', modelId }, 'Model not in enabled list, attempting anyway');
    }

    const openRouterRequest = this.transformRequest(request, openRouterModelId);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 120000); // Longer timeout for OpenRouter
    
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      };
      
      if (this.httpReferer) headers['HTTP-Referer'] = this.httpReferer;
      if (this.xTitle) headers['X-Title'] = this.xTitle;

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(openRouterRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw this.createHttpError(response.status, errorData);
      }

      const data = await response.json() as OpenRouterResponse;
      
      return this.transformResponse(data, modelId);
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw normalizeError(new Error('Request timeout'), this.id);
      }
      
      const providerError = normalizeError(error, this.id);
      childLogger.error({ target: 'ai.provider.openrouter', ...formatErrorForLogging(providerError) }, 'OpenRouter request failed');
      throw providerError;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(OPENROUTER_MODELS_URL, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  classifyError(error: unknown): ProviderError {
    return normalizeError(error, this.id);
  }

  private transformRequest(request: ChatRequest, modelId: string): OpenRouterRequest {
    const messages: OpenRouterMessage[] = normalizeMessages(request.messages).map(msg => ({
      role: msg.role,
      content: msg.content,
      tool_calls: msg.toolCalls?.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
      tool_call_id: msg.toolCallId,
      name: msg.name,
    }));

    const tools: OpenRouterTool[] | undefined = request.tools?.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    return {
      model: modelId,
      messages,
      tools,
      tool_choice: request.toolChoice,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens,
      top_p: request.topP,
      stop: request.stop,
      response_format: request.responseFormat,
      stream: false,
      route: 'fallback', // Use fallback routing
      provider: {
        allow_fallbacks: true,
        require_parameters: true,
      },
    };
  }

  private transformResponse(data: OpenRouterResponse, modelId: string): ChatResponse {
    const choice = data.choices[0];
    if (!choice) {
      throw new Error('No choices in OpenRouter response');
    }

    const toolCalls = normalizeToolCalls(choice.message.tool_calls ?? []);

    return {
      content: choice.message.content,
      toolCalls,
      finishReason: normalizeFinishReason(choice.finish_reason),
      usage: normalizeUsage(data.usage),
      providerId: this.id,
      modelId,
      rawResponse: data,
    };
  }

  private createHttpError(status: number, errorData: any): ProviderError {
    const error = new Error(errorData.error?.message ?? `HTTP ${status}`) as ProviderError;
    error.providerId = this.id;
    error.statusCode = status;

    switch (status) {
      case 401:
        error.errorClass = ProviderErrorClass.AUTHENTICATION;
        error.retryable = false;
        break;
      case 403:
        error.errorClass = ProviderErrorClass.AUTHORIZATION;
        error.retryable = false;
        break;
      case 429:
        error.errorClass = ProviderErrorClass.RATE_LIMITED;
        error.retryable = true;
        if (errorData.error?.retry_after) {
          error.retryAfterMs = Math.ceil(errorData.error.retry_after * 1000);
        }
        break;
      case 400:
      case 402:
        if (errorData.error?.message?.includes('quota') || errorData.error?.message?.includes('billing') || errorData.error?.message?.includes('credits')) {
          error.errorClass = ProviderErrorClass.QUOTA_EXHAUSTED;
          error.retryable = false;
        } else {
          error.errorClass = ProviderErrorClass.INVALID_REQUEST;
          error.retryable = false;
        }
        break;
      case 500:
      case 502:
      case 503:
      case 504:
        error.errorClass = ProviderErrorClass.PROVIDER_SERVER_ERROR;
        error.retryable = true;
        break;
      default:
        error.errorClass = ProviderErrorClass.UNKNOWN;
        error.retryable = true;
    }

    return error;
  }
}