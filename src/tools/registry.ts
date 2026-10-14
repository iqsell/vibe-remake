import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ToolDefinition } from '../ai/types.js';

export interface ToolSchema {
  name: string;
  version: string;
  description: string;
  inputSchema: z.ZodSchema;
  outputSchema: z.ZodSchema;
  readOnly: boolean;
  riskLevel: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  requiredPermissions: string[];
  requiredUserPermissions: string[];
  hierarchyConstraints?: {
    botMustBeAbove: boolean;
    userMustBeAbove: boolean;
  };
  confirmationRequired: boolean;
  idempotencyKey?: (args: any) => string;
  auditEventType: string;
  timeoutMs: number;
  retryable: boolean;
}

export interface ToolHandler<Input = any, Output = any> {
  (input: Input, context: ToolContext): Promise<Output>;
}

export interface ToolContext {
  guildId: string;
  channelId: string;
  userId: string;
  taskId: string;
  operationId: string;
  discordClient: any;
  prisma: any;
  logger: any;
}

export interface ToolRegistration extends ToolSchema {
  handler: ToolHandler;
}

export class ToolRegistry {
  private tools = new Map<string, ToolRegistration>();
  private aliases = new Map<string, string>();

  register(registration: ToolRegistration): void {
    if (this.tools.has(registration.name)) {
      throw new Error(`Tool already registered: ${registration.name}`);
    }
    
    this.tools.set(registration.name, registration);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): ToolRegistration | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolRegistration[] {
    return Array.from(this.tools.values());
  }

  getByCategory(category: string): ToolRegistration[] {
    // Categories could be derived from tool name prefix (e.g., "discord.", "moderation.")
    const prefix = category.endsWith('.') ? category : `${category}.`;
    return Array.from(this.tools.values()).filter(t => t.name.startsWith(prefix));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  validateInput(name: string, input: unknown): { success: boolean; data?: any; error?: z.ZodError } {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: new z.ZodError([{ code: 'custom', message: `Tool not found: ${name}`, path: [] }]) };
    }

    const result = tool.inputSchema.safeParse(input);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  }

  validateOutput(name: string, output: unknown): { success: boolean; data?: any; error?: z.ZodError } {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: new z.ZodError([{ code: 'custom', message: `Tool not found: ${name}`, path: [] }]) };
    }

    const result = tool.outputSchema.safeParse(output);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  }

  getToolDefinitionsForModel(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => {
      const jsonSchema = zodToJsonSchema(tool.inputSchema, { target: 'openApi3' }) as Record<string, unknown>;
      delete jsonSchema.$schema;
      return {
        name: tool.name,
        description: tool.description,
        parameters: jsonSchema,
      };
    });
  }
}

// Common schemas
export const commonSchemas = {
  userId: z.string().regex(/^\d{17,19}$/, 'Invalid user ID'),
  roleId: z.string().regex(/^\d{17,19}$/, 'Invalid role ID'),
  channelId: z.string().regex(/^\d{17,19}$/, 'Invalid channel ID'),
  guildId: z.string().regex(/^\d{17,19}$/, 'Invalid guild ID'),
  messageId: z.string().regex(/^\d{17,19}$/, 'Invalid message ID'),
  durationMs: z.number().int().positive().max(28 * 24 * 60 * 60 * 1000, 'Max 28 days'), // Discord timeout max
  reason: z.string().max(512).optional(),
  snowflake: z.string().regex(/^\d{17,19}$/),
};

// Tool categories
export const ToolCategories = {
  DISCORD: 'discord',
  MODERATION: 'moderation',
  INVESTIGATIONS: 'investigations',
  SERVER_DESIGN: 'server-design',
  STAFF: 'staff',
  TICKETS: 'tickets',
  APPLICATIONS: 'applications',
} as const;

export type ToolCategory = typeof ToolCategories[keyof typeof ToolCategories];