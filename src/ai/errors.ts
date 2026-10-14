import { ProviderError, ProviderErrorClass } from './types.js';

export function normalizeError(error: unknown, providerId: string): ProviderError {
  if (isProviderError(error)) {
    return { ...error, providerId };
  }

  if (error instanceof Error) {
    const providerError = new Error(error.message) as ProviderError;
    providerError.providerId = providerId;
    providerError.originalError = error;
    
    // Classify based on error message
    const message = error.message.toLowerCase();
    
    if (message.includes('unauthorized') || message.includes('invalid api key') || message.includes('authentication')) {
      providerError.errorClass = ProviderErrorClass.AUTHENTICATION;
      providerError.retryable = false;
    } else if (message.includes('forbidden') || message.includes('permission')) {
      providerError.errorClass = ProviderErrorClass.AUTHORIZATION;
      providerError.retryable = false;
    } else if (message.includes('rate limit') || message.includes('too many requests')) {
      providerError.errorClass = ProviderErrorClass.RATE_LIMITED;
      providerError.retryable = true;
    } else if (message.includes('quota') || message.includes('exceeded') || message.includes('billing')) {
      providerError.errorClass = ProviderErrorClass.QUOTA_EXHAUSTED;
      providerError.retryable = false;
    } else if (message.includes('timeout') || message.includes('timed out')) {
      providerError.errorClass = ProviderErrorClass.TIMEOUT;
      providerError.retryable = true;
    } else if (message.includes('network') || message.includes('econnrefused') || message.includes('enotfound') || message.includes('socket')) {
      providerError.errorClass = ProviderErrorClass.TRANSIENT_NETWORK;
      providerError.retryable = true;
    } else if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('internal server error') || message.includes('bad gateway') || message.includes('service unavailable')) {
      providerError.errorClass = ProviderErrorClass.PROVIDER_SERVER_ERROR;
      providerError.retryable = true;
    } else if (message.includes('content filter') || message.includes('safety') || message.includes('policy violation') || message.includes('refusal')) {
      providerError.errorClass = ProviderErrorClass.CONTENT_REFUSAL;
      providerError.retryable = false;
    } else if (message.includes('invalid request') || message.includes('bad request') || message.includes('malformed')) {
      providerError.errorClass = ProviderErrorClass.INVALID_REQUEST;
      providerError.retryable = false;
    } else if (message.includes('not supported') || message.includes('unsupported') || message.includes('capability')) {
      providerError.errorClass = ProviderErrorClass.UNSUPPORTED_CAPABILITY;
      providerError.retryable = false;
    } else {
      providerError.errorClass = ProviderErrorClass.UNKNOWN;
      providerError.retryable = true; // Default to retryable for unknown errors
    }

    return providerError;
  }

  const unknownError = new Error(String(error)) as ProviderError;
  unknownError.providerId = providerId;
  unknownError.errorClass = ProviderErrorClass.UNKNOWN;
  unknownError.retryable = true;
  return unknownError;
}

function isProviderError(error: unknown): error is ProviderError {
  return error instanceof Error && 'errorClass' in error && 'retryable' in error && 'providerId' in error;
}

export function isRetryableError(error: unknown): boolean {
  const normalized = normalizeError(error, 'unknown');
  return normalized.retryable;
}

export function getRetryAfter(error: unknown): number | undefined {
  if (isProviderError(error)) {
    return error.retryAfterMs;
  }
  return undefined;
}

export function formatErrorForLogging(error: ProviderError): Record<string, unknown> {
  return {
    providerId: error.providerId,
    errorClass: error.errorClass,
    retryable: error.retryable,
    retryAfterMs: error.retryAfterMs,
    statusCode: error.statusCode,
    message: error.message,
    stack: error.stack,
  };
}