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

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiMessage {
  role: 'user' | 'model';
  parts: Array<{ text?: string; functionCall?: any; functionResponse?: any }>;
}

interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

interface GeminiRequest {
  contents: GeminiMessage[];
  tools?: GeminiTool[];
  toolConfig?: {
    functionCallingConfig: {
      mode: 'AUTO' | 'NONE' | 'ANY';
      allowedFunctionNames?: string[];
    };
  };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
    responseMimeType?: string;
    responseSchema?: Record<string, unknown>;
  };
  safetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      role: string;
      parts: Array<{ text?: string; functionCall?: any; functionResponse?: any }>;
    };
    finishReason: string;
    index: number;
    safetyRatings?: Array<{ category: string; probability: string }>;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

interface GeminiModel {
  name: string;
  version: string;
  displayName: string;
  description: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  supportedGenerationMethods: string[];
}

export class GeminiAdapter implements ProviderAdapter {
  readonly id = 'gemini';
  readonly name = 'Google Gemini';
  
  private apiKey: string;
  private enabledModels: Set<string>;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.enabledModels = new Set(config.models.filter(m => m.enabled).map(m => m.id));
  }

  async getCapabilities(modelId: string): Promise<ProviderCapabilities> {
    const knownModels: Record<string, ProviderCapabilities> = {
      'gemini-1.5-pro': { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 2097152, maxOutputTokens: 8192, supportedModels: ['gemini-1.5-pro'] },
      'gemini-1.5-flash': { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 1048576, maxOutputTokens: 8192, supportedModels: ['gemini-1.5-flash'] },
      'gemini-1.0-pro': { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 32768, maxOutputTokens: 2048, supportedModels: ['gemini-1.0-pro'] },
    };

    return knownModels[modelId] ?? { 
      toolCalling: true, 
      structuredOutput: true, 
      streaming: true, 
      maxContextTokens: 32768, 
      maxOutputTokens: 2048, 
      supportedModels: [modelId] 
    };
  }

  async generate(request: ChatRequest, options: GenerateOptions = {}): Promise<ChatResponse> {
    const childLogger = createChildLogger({ target: 'ai.provider.gemini', modelId: request.metadata?.modelId });
    const startTime = Date.now();

    const modelId = (request.metadata?.modelId as string) ?? 'gemini-1.5-flash';
    
    if (!this.enabledModels.has(modelId)) {
      throw normalizeError(new Error(`Model ${modelId} not enabled for Gemini`), this.id);
    }

    const geminiRequest = this.transformRequest(request);
    const url = `${GEMINI_API_BASE}/models/${modelId}:generateContent?key=${this.apiKey}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 60000);
    
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(geminiRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw this.createHttpError(response.status, errorData);
      }

      const data = await response.json() as GeminiResponse;
      
      return this.transformResponse(data, modelId);
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw normalizeError(new Error('Request timeout'), this.id);
      }
      
      const providerError = normalizeError(error, this.id);
      childLogger.error({ target: 'ai.provider.gemini', ...formatErrorForLogging(providerError) }, 'Gemini request failed');
      throw providerError;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${GEMINI_API_BASE}/models?key=${this.apiKey}`, {
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

  private transformRequest(request: ChatRequest): GeminiRequest {
    // Convert messages to Gemini format
    const contents: GeminiMessage[] = [];
    let systemPrompt = '';

    for (const msg of normalizeMessages(request.messages)) {
      if (msg.role === 'system') {
        systemPrompt += msg.content + '\n';
        continue;
      }

      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts: GeminiMessage['parts'] = [];

      if (msg.content) {
        parts.push({ text: systemPrompt + msg.content });
        systemPrompt = '';
      } else {
        parts.push({ text: systemPrompt });
        systemPrompt = '';
      }

      // Handle tool calls
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments),
            },
          });
        }
      }

      // Handle tool results
      if (msg.role === 'tool' && msg.toolCallId) {
        // Tool results are handled differently in Gemini
        // They come as functionResponse in the next user message
      }

      contents.push({ role, parts });
    }

    // Transform tools
    const tools: GeminiTool[] | undefined = request.tools?.map(tool => ({
      functionDeclarations: [{
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }],
    }));

    // Transform tool choice
    let toolConfig: GeminiRequest['toolConfig'];
    if (request.toolChoice) {
      if (request.toolChoice === 'auto') {
        toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
      } else if (request.toolChoice === 'none') {
        toolConfig = { functionCallingConfig: { mode: 'NONE' } };
      } else if (request.toolChoice === 'required') {
        toolConfig = { functionCallingConfig: { mode: 'ANY' } };
      } else if (typeof request.toolChoice === 'object' && request.toolChoice.type === 'function') {
        toolConfig = { 
          functionCallingConfig: { 
            mode: 'ANY',
            allowedFunctionNames: [request.toolChoice.function.name],
          } 
        };
      }
    }

    return {
      contents,
      tools,
      toolConfig,
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens,
        topP: request.topP,
        stopSequences: request.stop,
        responseMimeType: request.responseFormat?.type === 'json_object' ? 'application/json' : undefined,
        responseSchema: request.responseFormat?.json_schema,
      },
    };
  }

  private transformResponse(data: GeminiResponse, modelId: string): ChatResponse {
    const candidate = data.candidates[0];
    if (!candidate) {
      throw new Error('No candidates in Gemini response');
    }

    let content: string | null = null;
    const toolCalls: ToolCall[] = [];

    for (const part of candidate.content.parts) {
      if (part.text) {
        content = (content ?? '') + part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args),
          },
        });
      }
    }

    // Map finish reason
    let finishReason: ChatResponse['finishReason'] = 'unknown';
    switch (candidate.finishReason) {
      case 'STOP':
        finishReason = 'stop';
        break;
      case 'MAX_TOKENS':
        finishReason = 'length';
        break;
      case 'SAFETY':
        finishReason = 'content_filter';
        break;
      case 'RECITATION':
        finishReason = 'content_filter';
        break;
      case 'FUNCTION_CALL':
        finishReason = 'tool_calls';
        break;
    }

    return {
      content,
      toolCalls,
      finishReason,
      usage: data.usageMetadata ? {
        promptTokens: data.usageMetadata.promptTokenCount,
        completionTokens: data.usageMetadata.candidatesTokenCount,
        totalTokens: data.usageMetadata.totalTokenCount,
      } : undefined,
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
      case 403:
        error.errorClass = ProviderErrorClass.AUTHENTICATION;
        error.retryable = false;
        break;
      case 429:
        error.errorClass = ProviderErrorClass.RATE_LIMITED;
        error.retryable = true;
        if (errorData.error?.details) {
          for (const detail of errorData.error.details) {
            if (detail['@type']?.includes('RetryInfo') && detail.retryDelay) {
              const seconds = parseFloat(detail.retryDelay.replace('s', ''));
              error.retryAfterMs = Math.ceil(seconds * 1000);
              break;
            }
          }
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