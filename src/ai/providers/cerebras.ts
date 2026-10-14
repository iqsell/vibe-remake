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

const CEREBRAS_API_URL = 'https://api.cerebras.ai/v1/chat/completions';
const CEREBRAS_MODELS_URL = 'https://api.cerebras.ai/v1/models';

interface CerebrasMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

interface CerebrasTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface CerebrasRequest {
  model: string;
  messages: CerebrasMessage[];
  tools?: CerebrasTool[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  response_format?: { type: 'json_object' | 'json_schema'; json_schema?: any };
  stream?: boolean;
}

interface CerebrasResponse {
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

export class CerebrasAdapter implements ProviderAdapter {
  readonly id = 'cerebras';
  readonly name = 'Cerebras';
  
  private apiKey: string;
  private baseUrl: string;
  private enabledModels: Set<string>;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? CEREBRAS_API_URL;
    this.enabledModels = new Set(config.models.filter(m => m.enabled).map(m => m.id));
  }

  async getCapabilities(modelId: string): Promise<ProviderCapabilities> {
    const knownModels: Record<string, ProviderCapabilities> = {
      'llama3.1-70b': { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 8192, maxOutputTokens: 8192, supportedModels: ['llama3.1-70b'] },
      'llama3.1-8b': { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 8192, maxOutputTokens: 8192, supportedModels: ['llama3.1-8b'] },
    };

    return knownModels[modelId] ?? { 
      toolCalling: true, 
      structuredOutput: true, 
      streaming: true, 
      maxContextTokens: 8192, 
      maxOutputTokens: 4096, 
      supportedModels: [modelId] 
    };
  }

  async generate(request: ChatRequest, options: GenerateOptions = {}): Promise<ChatResponse> {
    const childLogger = createChildLogger({ target: 'ai.provider.cerebras', modelId: request.metadata?.modelId });
    const startTime = Date.now();

    const modelId = (request.metadata?.modelId as string) ?? 'llama3.1-70b';
    
    if (!this.enabledModels.has(modelId)) {
      throw normalizeError(new Error(`Model ${modelId} not enabled for Cerebras`), this.id);
    }

    const cerebrasRequest = this.transformRequest(request, modelId);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 60000);
    
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cerebrasRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw this.createHttpError(response.status, errorData);
      }

      const data = await response.json() as CerebrasResponse;
      
      return this.transformResponse(data, modelId);
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw normalizeError(new Error('Request timeout'), this.id);
      }
      
      const providerError = normalizeError(error, this.id);
      childLogger.error({ target: 'ai.provider.cerebras', ...formatErrorForLogging(providerError) }, 'Cerebras request failed');
      throw providerError;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(CEREBRAS_MODELS_URL, {
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

  private transformRequest(request: ChatRequest, modelId: string): CerebrasRequest {
    const messages: CerebrasMessage[] = normalizeMessages(request.messages).map(msg => ({
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

    const tools: CerebrasTool[] | undefined = request.tools?.map(tool => ({
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
    };
  }

  private transformResponse(data: CerebrasResponse, modelId: string): ChatResponse {
    const choice = data.choices[0];
    if (!choice) {
      throw new Error('No choices in Cerebras response');
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
        if (errorData.error?.message?.includes('quota') || errorData.error?.message?.includes('billing')) {
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