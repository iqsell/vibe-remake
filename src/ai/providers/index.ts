export { GroqAdapter } from './groq.js';
export { GeminiAdapter } from './gemini.js';
export { OpenRouterAdapter } from './openrouter.js';
export { CerebrasAdapter } from './cerebras.js';
export { NvidiaAdapter } from './nvidia.js';
export { HuggingFaceAdapter } from './huggingface.js';

import { GroqAdapter } from './groq.js';
import { GeminiAdapter } from './gemini.js';
import { OpenRouterAdapter } from './openrouter.js';
import { CerebrasAdapter } from './cerebras.js';
import { NvidiaAdapter } from './nvidia.js';
import { HuggingFaceAdapter } from './huggingface.js';
import { ProviderAdapter, ProviderConfig, ModelConfig } from '../types.js';
import { getEnv } from '../../config/env.js';

export async function initializeProviders(gateway: any): Promise<void> {
  const env = getEnv();
  const adapters = [
    { id: 'groq', adapter: GroqAdapter, key: env.GROQ_API_KEY },
    { id: 'gemini', adapter: GeminiAdapter, key: env.GEMINI_API_KEY },
    { id: 'openrouter', adapter: OpenRouterAdapter, key: env.OPENROUTER_API_KEY },
    { id: 'cerebras', adapter: CerebrasAdapter, key: env.CEREBRAS_API_KEY },
    { id: 'nvidia', adapter: NvidiaAdapter, key: env.NVIDIA_API_KEY },
    { id: 'huggingface', adapter: HuggingFaceAdapter, key: env.HF_API_KEY },
  ];

  for (const { id, adapter: Adapter, key } of adapters) {
    if (!key) {
      console.log(`[AI] Skipping ${id}: no API key configured`);
      continue;
    }

    try {
      const config = createProviderConfig(id, key);
      const adapter = new Adapter(config);
      gateway.registerProvider(adapter, config);
      console.log(`[AI] Registered provider: ${id}`);
    } catch (error) {
      console.error(`[AI] Failed to initialize ${id}:`, error);
    }
  }
}

function createProviderConfig(id: string, apiKey: string): ProviderConfig {
  const baseModels: ModelConfig[] = [
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', capabilities: { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 131072, maxOutputTokens: 8192, freeTier: true }, enabled: true },
    { id: 'llama-3.1-70b-versatile', name: 'Llama 3.1 70B Versatile', capabilities: { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 131072, maxOutputTokens: 8192, freeTier: true }, enabled: true },
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', capabilities: { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 131072, maxOutputTokens: 8192, freeTier: true }, enabled: true },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', capabilities: { toolCalling: true, structuredOutput: false, streaming: true, maxContextTokens: 32768, maxOutputTokens: 8192, freeTier: true }, enabled: true },
    { id: 'gemma2-9b-it', name: 'Gemma 2 9B IT', capabilities: { toolCalling: false, structuredOutput: false, streaming: true, maxContextTokens: 8192, maxOutputTokens: 8192, freeTier: true }, enabled: true },
  ];

  const configs: Record<string, ProviderConfig> = {
    groq: {
      id: 'groq',
      name: 'Groq',
      apiKey,
      baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
      models: baseModels,
      enabled: true,
      priority: 1,
      rateLimit: { requestsPerMinute: 30, tokensPerMinute: 6000 },
    },
    gemini: {
      id: 'gemini',
      name: 'Google Gemini',
      apiKey,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      models: [
        { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', capabilities: { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 1048576, maxOutputTokens: 8192, freeTier: true }, enabled: true },
        { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', capabilities: { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 2097152, maxOutputTokens: 8192, freeTier: true }, enabled: true },
        { id: 'gemini-1.0-pro', name: 'Gemini 1.0 Pro', capabilities: { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 32768, maxOutputTokens: 2048, freeTier: true }, enabled: true },
      ],
      enabled: true,
      priority: 2,
      rateLimit: { requestsPerMinute: 60, tokensPerMinute: 32000 },
    },
    openrouter: {
      id: 'openrouter',
      name: 'OpenRouter',
      apiKey,
      baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
      models: [
        { id: 'openrouter/auto', name: 'Auto (Best Available)', capabilities: { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 128000, maxOutputTokens: 4096, freeTier: true }, enabled: true },
        { id: 'meta-llama/llama-3.1-70b-instruct:free', name: 'Llama 3.1 70B Instruct (Free)', capabilities: { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 131072, maxOutputTokens: 4096, freeTier: true }, enabled: true },
        { id: 'meta-llama/llama-3.1-8b-instruct:free', name: 'Llama 3.1 8B Instruct (Free)', capabilities: { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 131072, maxOutputTokens: 4096, freeTier: true }, enabled: true },
        { id: 'google/gemma-2-9b-it:free', name: 'Gemma 2 9B IT (Free)', capabilities: { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 8192, maxOutputTokens: 4096, freeTier: true }, enabled: true },
        { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B Instruct (Free)', capabilities: { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 32768, maxOutputTokens: 4096, freeTier: true }, enabled: true },
      ],
      enabled: true,
      priority: 3,
      rateLimit: { requestsPerMinute: 20, tokensPerMinute: 20000 },
    },
    cerebras: {
      id: 'cerebras',
      name: 'Cerebras',
      apiKey,
      baseUrl: 'https://api.cerebras.ai/v1/chat/completions',
      models: [
        { id: 'llama3.1-70b', name: 'Llama 3.1 70B', capabilities: { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 8192, maxOutputTokens: 8192, freeTier: true }, enabled: true },
        { id: 'llama3.1-8b', name: 'Llama 3.1 8B', capabilities: { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 8192, maxOutputTokens: 8192, freeTier: true }, enabled: true },
      ],
      enabled: true,
      priority: 4,
      rateLimit: { requestsPerMinute: 60, tokensPerMinute: 100000 },
    },
    nvidia: {
      id: 'nvidia',
      name: 'NVIDIA',
      apiKey,
      baseUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
      models: [
        { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B Instruct', capabilities: { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 128000, maxOutputTokens: 4096, freeTier: true }, enabled: true },
        { id: 'meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct', capabilities: { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 128000, maxOutputTokens: 4096, freeTier: true }, enabled: true },
        { id: 'nvidia/nemotron-3-ultra', name: 'Nemotron 3 Ultra', capabilities: { toolCalling: true, structuredOutput: true, streaming: true, maxContextTokens: 128000, maxOutputTokens: 4096, freeTier: true }, enabled: true },
      ],
      enabled: true,
      priority: 5,
      rateLimit: { requestsPerMinute: 60, tokensPerMinute: 50000 },
    },
    huggingface: {
      id: 'huggingface',
      name: 'Hugging Face',
      apiKey,
      baseUrl: 'https://api-inference.huggingface.co/models',
      models: [
        { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct', name: 'Llama 3.1 8B Instruct', capabilities: { toolCalling: false, structuredOutput: false, streaming: false, maxContextTokens: 8192, maxOutputTokens: 1024, freeTier: true }, enabled: true },
        { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct', name: 'Llama 3.1 70B Instruct', capabilities: { toolCalling: false, structuredOutput: false, streaming: false, maxContextTokens: 8192, maxOutputTokens: 1024, freeTier: true }, enabled: true },
        { id: 'mistralai/Mistral-7B-Instruct-v0.3', name: 'Mistral 7B Instruct v0.3', capabilities: { toolCalling: false, structuredOutput: false, streaming: false, maxContextTokens: 32768, maxOutputTokens: 1024, freeTier: true }, enabled: true },
      ],
      enabled: true,
      priority: 6,
      rateLimit: { requestsPerMinute: 30, tokensPerMinute: 10000 },
    },
  };

  return configs[id];
}