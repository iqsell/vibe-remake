import { describe, it, expect } from 'vitest';
import { envSchema } from '../../src/config/env.js';
import {
  banMemberSchema,
  purgeMessagesSchema,
  timeoutMemberSchema,
} from '../../src/tools/schemas/moderation.js';
import { proposeServerLayoutSchema } from '../../src/tools/schemas/server-design.js';

describe('envSchema', () => {
  const base = {
    DISCORD_TOKEN: 'token',
    DISCORD_CLIENT_ID: '123456789012345678',
    DISCORD_CLIENT_SECRET: 'secret',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/vibe',
  };

  it('parses a minimal valid environment with defaults', () => {
    const result = envSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NODE_ENV).toBe('development');
      expect(result.data.LOG_LEVEL).toBe('info');
      expect(result.data.DEFAULT_PROVIDER).toBe('groq');
      expect(result.data.PROVIDER_ORDER).toContain('gemini');
      expect(result.data.RATE_LIMIT_GLOBAL).toBe(60);
    }
  });

  it('requires the core Discord variables', () => {
    const result = envSchema.safeParse({
      ...base,
      DISCORD_TOKEN: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts sqlite-style file database URLs', () => {
    const result = envSchema.safeParse({ ...base, DATABASE_URL: 'file:./dev.db' });
    expect(result.success).toBe(true);
  });

  it('coerces numeric rate limit env values', () => {
    const result = envSchema.safeParse({ ...base, RATE_LIMIT_PER_USER: '25' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.RATE_LIMIT_PER_USER).toBe(25);
    }
  });
});

describe('moderation schemas', () => {
  it('applies defaults on ban input', () => {
    const parsed = banMemberSchema.input.parse({ userId: '123456789012345678' });
    expect(parsed.deleteMessageDays).toBe(0);
  });

  it('applies defaults on purge input', () => {
    const parsed = purgeMessagesSchema.input.parse({ channelId: '123456789012345678' });
    expect(parsed.limit).toBe(50);
    expect(parsed.dryRun).toBe(false);
  });

  it('rejects non-positive timeouts', () => {
    const result = timeoutMemberSchema.input.safeParse({
      userId: '123456789012345678',
      durationMs: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('server-design schemas', () => {
  it('defaults naming convention and preserve lists', () => {
    const parsed = proposeServerLayoutSchema.input.parse({
      structure: { categories: [] },
    });
    expect(parsed.namingConvention).toBe('kebab-case');
    expect(parsed.preserveChannels).toEqual([]);
    expect(parsed.preserveCategories).toEqual([]);
  });
});
