import { describe, it, expect } from 'vitest';
import { ToolRegistry, commonSchemas } from '../../src/tools/registry.js';
import { z } from 'zod';

function makeTool(name: string, overrides: Record<string, any> = {}) {
  return {
    name,
    version: '1.0.0',
    description: `${name} description`,
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    readOnly: true,
    riskLevel: 'NONE' as const,
    requiredPermissions: [],
    requiredUserPermissions: [],
    confirmationRequired: false,
    auditEventType: 'TEST',
    timeoutMs: 1000,
    retryable: false,
    handler: async () => ({ ok: true }),
    ...overrides,
  };
}

describe('ToolRegistry', () => {
  it('registers and retrieves tools', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('discord.test'));
    expect(registry.has('discord.test')).toBe(true);
    expect(registry.get('discord.test')?.name).toBe('discord.test');
    expect(registry.getAll()).toHaveLength(1);
  });

  it('rejects duplicate tool names', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('a.b'));
    expect(() => registry.register(makeTool('a.b'))).toThrow(/already registered/);
  });

  it('filters by category prefix', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('discord.one'));
    registry.register(makeTool('discord.two'));
    registry.register(makeTool('moderation.one'));
    expect(registry.getByCategory('discord')).toHaveLength(2);
    expect(registry.getByCategory('moderation')).toHaveLength(1);
  });

  it('validates input against the input schema', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('x.y'));

    const ok = registry.validateInput('x.y', { value: 'hello' });
    expect(ok.success).toBe(true);
    expect(ok.data).toEqual({ value: 'hello' });

    const bad = registry.validateInput('x.y', { value: 123 });
    expect(bad.success).toBe(false);
    expect(bad.error).toBeDefined();
  });

  it('reports an error for unknown tools', () => {
    const registry = new ToolRegistry();
    const result = registry.validateInput('missing.tool', {});
    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(/Tool not found/);
  });

  it('converts tool registrations to JSON schema definitions', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('x.y'));
    const defs = registry.getToolDefinitionsForModel();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('x.y');
    expect(typeof defs[0].parameters).toBe('object');
    expect((defs[0].parameters as any).$schema).toBeUndefined();
    expect((defs[0].parameters as any).properties).toBeDefined();
  });
});

describe('commonSchemas', () => {
  it('accepts valid snowflakes', () => {
    expect(commonSchemas.userId.safeParse('123456789012345678').success).toBe(true);
  });

  it('rejects invalid snowflakes', () => {
    expect(commonSchemas.userId.safeParse('not-an-id').success).toBe(false);
  });

  it('caps durations at 28 days', () => {
    const max = 28 * 24 * 60 * 60 * 1000;
    expect(commonSchemas.durationMs.safeParse(max).success).toBe(true);
    expect(commonSchemas.durationMs.safeParse(max + 1).success).toBe(false);
  });
});
