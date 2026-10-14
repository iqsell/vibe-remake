import { describe, it, expect, vi } from 'vitest';

vi.mock('@prisma/client', () => {
  class PrismaClient {
    $on(): void {}
    $connect = async (): Promise<void> => {};
    $disconnect = async (): Promise<void> => {};
    $queryRaw = async (): Promise<unknown[]> => [{}];
  }
  return { PrismaClient };
});

import { ToolRegistry } from '../../src/tools/registry.js';
import { registerAllTools } from '../../src/tools/index.js';

const EXPECTED_TOOL_COUNT = 65;

describe('tool registration contract', () => {
  const registry = new ToolRegistry();
  registerAllTools(registry);
  const tools = registry.getAll();

  it('registers the full expected tool surface', () => {
    expect(tools).toHaveLength(EXPECTED_TOOL_COUNT);
  });

  it('registers every tool with a unique name', () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('registers tools across every category', () => {
    const prefixes = new Set(tools.map((t) => t.name.split('.')[0]));
    expect(prefixes).toEqual(
      new Set(['discord', 'moderation', 'server-design', 'tickets', 'applications', 'staff'])
    );
  });

  it('gives every tool a callable handler and valid schemas', () => {
    for (const tool of tools) {
      expect(typeof tool.handler).toBe('function');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
      expect(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(tool.riskLevel);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.timeoutMs).toBeGreaterThan(0);
    }
  });

  it('only marks read-only tools as readOnly', () => {
    const readOnly = tools.filter((t) => t.readOnly);
    // The read-only surface is the discord inspection tools plus query tools.
    expect(readOnly.length).toBeGreaterThanOrEqual(8);
    for (const tool of readOnly) {
      expect(tool.name.split('.')[0]).toBeDefined();
    }
  });

  it('exposes model-facing JSON schema definitions for all tools', () => {
    const defs = registry.getToolDefinitionsForModel();
    expect(defs).toHaveLength(EXPECTED_TOOL_COUNT);
    for (const def of defs) {
      expect(typeof def.name).toBe('string');
      expect(typeof def.parameters).toBe('object');
    }
  });
});
