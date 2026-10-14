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

const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

interface NvidiaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

interface NvidiaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface NvidiaRequest {
  model: string;
  messages: NvidiaMessage[];
  tools?: NvidiaTool[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  response_format?: { type: 'json_object' | 'json_schema'; json_schema?: any };
  stream?: boolean;
}

interface NvidiaResponse {
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

export class NvidiaAdapter implements ProviderAdapter {
  readonly id = 'nvidia';
  readonly name = 'NVIDIA';
  
  private apiKey: string;
  private baseUrl: string;
  private enabledModels: Set<string>;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? NVIDIA_API_URL;
    this.enabledModels = new Set(config.models.filter(m => m.enabled).map(m => m.id));
  }

  async getCapabilities(modelId: string): Promise<ProviderCapabilities> {
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
    const childLogger = createChildLogger({ target: 'ai.provider.nvidia', modelId: request.metadata?.modelId });
    const startTime = Date.now();

    const modelId = (request.metadata?.modelId as string) ?? 'meta/llama-3.1-70b-instruct';
    
    if (!this.enabledModels.has(modelId)) {
      throw normalizeError(new Error(`Model ${modelId} not enabled for NVIDIA`), this.id);
    }

    const nvidiaRequest = this.transformRequest(request, modelId);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 120000);
    
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(nvidiaRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw this.createHttpError(response.status, errorData);
      }

      const data = await response.json() as NvidiaResponse;
      
      return this.transformResponse(data, modelId);
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw normalizeError(new Error('Request timeout'), this.id);
      }
      
      const providerError = normalizeError(error, this.id);
      childLogger.error({ target: 'ai.provider.nvidia', ...formatErrorForLogging(providerError) }, 'NVIDIA request failed');
      throw providerError;
    }
  }

  async healthCheck(): Promise<boolean> {
    // NVIDIA doesn't have a simple models endpoint, try a minimal request
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'meta/llama-3.1-70b-instruct',
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(10000),
      });
      return response.ok || response.status === 400; // 400 means auth works but request invalid
    } catch {
      return false;
    }
  }

  classifyError(error: unknown): ProviderError {
    return normalizeError(error, this.id);
  }

  private transformRequest(request: ChatRequest, modelId: string): NvidiaRequest {
    const messages: NvidiaMessage[] = normalizeMessages(request.messages).map(msg => ({
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

    const tools: NvidiaTool[] | undefined = request.tools?.map(tool => ({
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

  private transformResponse(data: NvidiaResponse, modelId: string): ChatResponse {
    const choice = data.choices[0];
    if (!choice) {
      throw new Error('No choices in NVIDIA response');
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