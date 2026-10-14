import { z } from 'zod';

export const envSchema = z.object({
  // Discord
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  DISCORD_CLIENT_SECRET: z.string().min(1, 'DISCORD_CLIENT_SECRET is required'),

  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL').or(
    z.string().startsWith('file:').transform(s => s)
  ),

  // AI Providers (at least one required at runtime, but optional in schema for flexibility)
  GROQ_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  CEREBRAS_API_KEY: z.string().optional(),
  NVIDIA_API_KEY: z.string().optional(),
  HF_API_KEY: z.string().optional(),

  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: z.coerce.boolean().default(false),

  // Feature Flags
  ENABLE_CONVERSATIONAL_CHANNELS: z.coerce.boolean().default(false),
  ENABLE_AUTOMOD: z.coerce.boolean().default(false),
  ENABLE_TICKETS: z.coerce.boolean().default(false),
  ENABLE_APPLICATIONS: z.coerce.boolean().default(false),

  // Rate Limits
  RATE_LIMIT_GLOBAL: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_PER_USER: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_PER_GUILD: z.coerce.number().int().positive().default(100),

  // Task Configuration
  TASK_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  MAX_TOOL_CALLS_PER_TASK: z.coerce.number().int().positive().default(50),
  MAX_MODEL_CALLS_PER_TASK: z.coerce.number().int().positive().default(20),

  // Provider Configuration
  PROVIDER_ORDER: z.string().default('groq,gemini,openrouter,cerebras,nvidia,huggingface').transform(s => s.split(',').map(x => x.trim()).filter(Boolean)),
  DEFAULT_PROVIDER: z.string().default('groq'),
  FAILOVER_MAX_IMMEDIATE_ATTEMPTS: z.coerce.number().int().positive().default(3),
  FAILOVER_TASK_BUDGET_MS: z.coerce.number().int().positive().default(600000),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const result = envSchema.safeParse(process.env);
  
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const messages = Object.entries(errors).flatMap(([field, errs]) => 
      (errs ?? []).map(err => `${field}: ${err}`)
    );
    throw new Error(`Environment validation failed:\n${messages.join('\n')}`);
  }

  cachedEnv = result.data;
  return cachedEnv;
}

export function getEnv(): Env {
  if (!cachedEnv) {
    return loadEnv();
  }
  return cachedEnv;
}

export function validateProviderKeys(env: Env): string[] {
  const providers = [
    { key: 'GROQ_API_KEY', name: 'Groq' },
    { key: 'GEMINI_API_KEY', name: 'Gemini' },
    { key: 'OPENROUTER_API_KEY', name: 'OpenRouter' },
    { key: 'CEREBRAS_API_KEY', name: 'Cerebras' },
    { key: 'NVIDIA_API_KEY', name: 'NVIDIA' },
    { key: 'HF_API_KEY', name: 'HuggingFace' },
  ] as const;

  return providers
    .filter(p => env[p.key])
    .map(p => p.name);
}