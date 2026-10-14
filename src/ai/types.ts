import { z } from 'zod';

// Core types for the AI provider abstraction

export interface ProviderCapabilities {
  toolCalling: boolean;
  structuredOutput: boolean;
  streaming: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
  supportedModels: string[];
}

export interface ModelCapabilities {
  modelId: string;
  providerId: string;
  toolCalling: boolean;
  structuredOutput: boolean;
  streaming: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
  freeTier: boolean;
  quotaNotes?: string;
  httpReferer?: string;
  xTitle?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  responseFormat?: { type: 'json_object' | 'json_schema'; json_schema?: any };
  metadata?: Record<string, unknown>;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' | 'unknown';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  providerId: string;
  modelId: string;
  rawResponse?: unknown;
}

export interface ProviderError extends Error {
  providerId: string;
  errorClass: ProviderErrorClass;
  retryable: boolean;
  retryAfterMs?: number;
  statusCode?: number;
  originalError?: Error;
}

export enum ProviderErrorClass {
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  INVALID_REQUEST = 'INVALID_REQUEST',
  UNSUPPORTED_CAPABILITY = 'UNSUPPORTED_CAPABILITY',
  QUOTA_EXHAUSTED = 'QUOTA_EXHAUSTED',
  RATE_LIMITED = 'RATE_LIMITED',
  TIMEOUT = 'TIMEOUT',
  TRANSIENT_NETWORK = 'TRANSIENT_NETWORK',
  PROVIDER_SERVER_ERROR = 'PROVIDER_SERVER_ERROR',
  CONTENT_REFUSAL = 'CONTENT_REFUSAL',
  MALFORMED_RESPONSE = 'MALFORMED_RESPONSE',
  UNKNOWN = 'UNKNOWN',
}

export interface ProviderAdapter {
  readonly id: string;
  readonly name: string;
  
  getCapabilities(modelId: string): Promise<ProviderCapabilities>;
  generate(request: ChatRequest, options: GenerateOptions): Promise<ChatResponse>;
  healthCheck(): Promise<boolean>;
  classifyError(error: unknown): ProviderError;
}

export interface GenerateOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface ProviderConfig {
  id: string;
  name: string;
  apiKey: string;
  baseUrl?: string;
  models: ModelConfig[];
  enabled: boolean;
  priority: number;
  rateLimit: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
}

export interface ModelConfig {
  id: string;
  name: string;
  capabilities: Partial<ModelCapabilities>;
  enabled: boolean;
  costPer1kInput?: number;
  costPer1kOutput?: number;
}

export interface RouterConfig {
  defaultProvider: string;
  providerOrder: string[];
  taskTypePreferences: Record<string, string[]>; // taskType -> provider ids in order
  failover: {
    maxImmediateAttempts: number;
    taskBudgetMs: number;
    enableCircuitBreaker: boolean;
    circuitBreakerThreshold: number;
    circuitBreakerTimeoutMs: number;
  };
}