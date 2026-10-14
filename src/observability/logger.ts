import pino from 'pino';
import { getEnv } from '../config/env.js';

const REDACT_KEYS = [
  'token',
  'secret',
  'key',
  'password',
  'authorization',
  'cookie',
  'session',
  'api_key',
  'apikey',
  'access_token',
  'refresh_token',
  'client_secret',
  'discord_token',
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'CEREBRAS_API_KEY',
  'NVIDIA_API_KEY',
  'HF_API_KEY',
];

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const shouldRedact = REDACT_KEYS.some(r => lowerKey.includes(r));
    
    if (shouldRedact) {
      result[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redact(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map(v => 
        v && typeof v === 'object' ? redact(v as Record<string, unknown>) : v
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

function createLogger() {
  const env = getEnv();
  
  const streams: Parameters<typeof pino.multistream>[0] = [];
  
  if (env.LOG_PRETTY && env.NODE_ENV !== 'production') {
    streams.push({
      stream: pino.destination({ sync: false }),
      level: env.LOG_LEVEL,
    });
  } else {
    streams.push({
      stream: process.stdout,
      level: env.LOG_LEVEL,
    });
  }

  const logger = pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: REDACT_KEYS.map(k => `*.${k}`),
      censor: '[REDACTED]',
    },
    formatters: {
      level: (label) => ({ level: label }),
      bindings: () => ({
        pid: process.pid,
        hostname: process.env.HOSTNAME ?? 'unknown',
      }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: undefined,
  }, pino.multistream(streams));

  return logger;
}

export const logger = createLogger();

export function createChildLogger(bindings: Record<string, unknown>) {
  return logger.child(redact(bindings));
}

export function createCorrelationLogger(correlationId: string, extra?: Record<string, unknown>) {
  return logger.child(redact({ correlationId, ...extra }));
}

export function createGuildLogger(guildId: string, extra?: Record<string, unknown>) {
  return logger.child(redact({ guildId, ...extra }));
}

export function createTaskLogger(taskId: string, extra?: Record<string, unknown>) {
  return logger.child(redact({ taskId, ...extra }));
}