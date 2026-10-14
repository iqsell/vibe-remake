import { logger } from '../../observability/logger.js';

export interface QuotaStateConfig {
  defaultQuota?: number;
  resetIntervalMs?: number; // e.g., 24 hours for daily quota
  warningThreshold?: number; // 0-1, warn when quota below this fraction
}

export interface QuotaInfo {
  providerId: string;
  used: number;
  limit: number;
  remaining: number;
  resetAt: number;
  lastUpdated: number;
}

export class QuotaTracker {
  private quotas = new Map<string, QuotaInfo>();
  private config: QuotaStateConfig;

  constructor(config: QuotaStateConfig = {}) {
    this.config = {
      defaultQuota: 10000,
      resetIntervalMs: 24 * 60 * 60 * 1000, // 24 hours
      warningThreshold: 0.1,
      ...config,
    };
  }

  initialize(providerId: string, limit?: number, resetAt?: number): void {
    const now = Date.now();
    const quota: QuotaInfo = {
      providerId,
      used: 0,
      limit: limit ?? this.config.defaultQuota!,
      remaining: limit ?? this.config.defaultQuota!,
      resetAt: resetAt ?? now + this.config.resetIntervalMs!,
      lastUpdated: now,
    };
    this.quotas.set(providerId, quota);
  }

  consume(providerId: string, tokens: number): boolean {
    const quota = this.quotas.get(providerId);
    if (!quota) {
      this.initialize(providerId);
      return this.consume(providerId, tokens);
    }

    // Check if quota reset is needed
    if (Date.now() >= quota.resetAt) {
      this.reset(providerId);
      return this.consume(providerId, tokens);
    }

    if (quota.remaining < tokens) {
      return false; // Insufficient quota
    }

    quota.used += tokens;
    quota.remaining -= tokens;
    quota.lastUpdated = Date.now();
    
    // Warn if low
    if (quota.remaining / quota.limit <= this.config.warningThreshold!) {
      logger.warn({ 
        target: 'ai.failover.quota', 
        providerId, 
        remaining: quota.remaining, 
        limit: quota.limit 
      }, 'Quota running low');
    }

    return true;
  }

  tryConsume(providerId: string, tokens: number): { success: boolean; quota?: QuotaInfo } {
    const success = this.consume(providerId, tokens);
    return { success, quota: this.quotas.get(providerId) };
  }

  updateFromResponse(providerId: string, usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }): void {
    if (!usage) return;
    
    const tokens = usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
    if (tokens > 0) {
      this.consume(providerId, tokens);
    }
  }

  setLimit(providerId: string, limit: number): void {
    const quota = this.quotas.get(providerId);
    if (quota) {
      quota.limit = limit;
      quota.remaining = Math.max(0, limit - quota.used);
    } else {
      this.initialize(providerId, limit);
    }
  }

  getQuota(providerId: string): QuotaInfo | undefined {
    const quota = this.quotas.get(providerId);
    if (!quota) return undefined;

    // Check if reset needed
    if (Date.now() >= quota.resetAt) {
      this.reset(providerId);
      return this.quotas.get(providerId);
    }

    return quota;
  }

  getAllQuotas(): QuotaInfo[] {
    const now = Date.now();
    const result: QuotaInfo[] = [];
    
    for (const quota of this.quotas.values()) {
      if (now >= quota.resetAt) {
        this.reset(quota.providerId);
        result.push(this.quotas.get(quota.providerId)!);
      } else {
        result.push(quota);
      }
    }
    
    return result;
  }

  reset(providerId: string): void {
    const quota = this.quotas.get(providerId);
    if (quota) {
      const now = Date.now();
      quota.used = 0;
      quota.remaining = quota.limit;
      quota.resetAt = now + this.config.resetIntervalMs!;
      quota.lastUpdated = now;
    }
  }

  isExhausted(providerId: string): boolean {
    const quota = this.getQuota(providerId);
    return quota ? quota.remaining <= 0 : false;
  }

  getAvailableProviders(providerIds: string[]): string[] {
    return providerIds.filter(id => !this.isExhausted(id));
  }
}

export const quotaTracker = new QuotaTracker();