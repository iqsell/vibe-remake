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

const HF_API_URL = 'https://api-inference.huggingface.co/models';

interface HFMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

interface HFRequest {
  inputs: string;
  parameters?: {
    temperature?: number;
    max_new_tokens?: number;
    top_p?: number;
    stop?: string[];
    return_full_text?: boolean;
  };
  stream?: boolean;
}

interface HFResponse {
  generated_text?: string;
  error?: string;
  estimated_time?: number;
}

export class HuggingFaceAdapter implements ProviderAdapter {
  readonly id = 'huggingface';
  readonly name = 'Hugging Face';
  
  private apiKey: string;
  private baseUrl: string;
  private enabledModels: Set<string>;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? HF_API_URL;
    this.enabledModels = new Set(config.models.filter(m => m.enabled).map(m => m.id));
  }

  async getCapabilities(modelId: string): Promise<ProviderCapabilities> {
    // HF Inference API generally doesn't support tool calling natively
    // Some models may support it via specific formats
    return { 
      toolCalling: false, 
      structuredOutput: false, 
      streaming: false, 
      maxContextTokens: 4096, 
      maxOutputTokens: 1024, 
      supportedModels: [modelId] 
    };
  }

  async generate(request: ChatRequest, options: GenerateOptions = {}): Promise<ChatResponse> {
    const childLogger = createChildLogger({ target: 'ai.provider.huggingface', modelId: request.metadata?.modelId });
    const startTime = Date.now();

    const modelId = (request.metadata?.modelId as string) ?? 'meta-llama/Meta-Llama-3.1-8B-Instruct';
    
    if (!this.enabledModels.has(modelId)) {
      throw normalizeError(new Error(`Model ${modelId} not enabled for Hugging Face`), this.id);
    }

    // HF Inference API uses a different format - single string input
    const prompt = this.formatPrompt(request);
    const hfRequest = this.transformRequest(prompt);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 120000);
    
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    const url = `${this.baseUrl}/${modelId}`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(hfRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw this.createHttpError(response.status, errorData);
      }

      const data = await response.json() as HFResponse | HFResponse[];
      
      return this.transformResponse(data, modelId);
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw normalizeError(new Error('Request timeout'), this.id);
      }
      
      const providerError = normalizeError(error, this.id);
      childLogger.error({ target: 'ai.provider.huggingface', ...formatErrorForLogging(providerError) }, 'Hugging Face request failed');
      throw providerError;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/meta-llama/Meta-Llama-3.1-8B-Instruct`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: 'test', parameters: { max_new_tokens: 1 } }),
        signal: AbortSignal.timeout(10000),
      });
      return response.ok || response.status === 503; // 503 = model loading (cold start)
    } catch {
      return false;
    }
  }

  classifyError(error: unknown): ProviderError {
    return normalizeError(error, this.id);
  }

  private formatPrompt(request: ChatRequest): string {
    const messages = normalizeMessages(request.messages);
    let prompt = '';

    for (const msg of messages) {
      if (msg.role === 'system') {
        prompt += `<|system|>\n${msg.content}\n`;
      } else if (msg.role === 'user') {
        prompt += `<|user|>\n${msg.content}\n`;
      } else if (msg.role === 'assistant') {
        prompt += `<|assistant|>\n${msg.content}\n`;
      }
    }

    prompt += '<|assistant|>\n';
    return prompt;
  }

  private transformRequest(prompt: string): HFRequest {
    return {
      inputs: prompt,
      parameters: {
        temperature: 0.7,
        max_new_tokens: 1024,
        top_p: 0.9,
        return_full_text: false,
      },
      stream: false,
    };
  }

  private transformResponse(data: HFResponse | HFResponse[], modelId: string): ChatResponse {
    // HF returns array or single object
    const result = Array.isArray(data) ? data[0] : data;
    
    if (result.error) {
      throw new Error(result.error);
    }

    const content = result.generated_text ?? '';
    
    return {
      content,
      toolCalls: [], // HF Inference API doesn't support tool calling
      finishReason: 'stop',
      usage: undefined, // HF doesn't return usage
      providerId: this.id,
      modelId,
      rawResponse: data,
    };
  }

  private createHttpError(status: number, errorData: any): ProviderError {
    const error = new Error(errorData.error ?? `HTTP ${status}`) as ProviderError;
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
      case 404:
        error.errorClass = ProviderErrorClass.INVALID_REQUEST;
        error.retryable = false;
        break;
      case 429:
        error.errorClass = ProviderErrorClass.RATE_LIMITED;
        error.retryable = true;
        break;
      case 503:
        // Model loading - this is common for HF
        error.errorClass = ProviderErrorClass.PROVIDER_SERVER_ERROR;
        error.retryable = true;
        if (errorData.estimated_time) {
          error.retryAfterMs = Math.ceil(errorData.estimated_time * 1000);
        }
        break;
      case 500:
      case 502:
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