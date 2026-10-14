import { z } from 'zod';
import { commonSchemas } from '../registry.js';

export const inspectServerLayoutSchema = {
  input: z.object({
    includePermissions: z.boolean().default(true),
    includeUnused: z.boolean().default(false),
  }),
  output: z.object({
    categories: z.array(z.object({
      id: z.string(),
      name: z.string(),
      position: z.number(),
      channels: z.array(z.object({
        id: z.string(),
        name: z.string(),
        type: z.number(),
        topic: z.string().nullable(),
        nsfw: z.boolean(),
        rateLimitPerUser: z.number(),
        position: z.number(),
        messageCount: z.number().optional(),
        lastActivity: z.string().optional(),
      })),
    })),
    roles: z.array(z.object({
      id: z.string(),
      name: z.string(),
      color: z.number(),
      position: z.number(),
      permissions: z.string(),
      memberCount: z.number(),
    })),
    unusedChannels: z.array(z.object({
      id: z.string(),
      name: z.string(),
      type: z.number(),
      lastMessageAt: z.string().nullable(),
    })).optional(),
    permissionConflicts: z.array(z.object({
      channelId: z.string(),
      channelName: z.string(),
      issue: z.string(),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    })).optional(),
  }),
};

export const proposeServerLayoutSchema = {
  input: z.object({
    goals: z.array(z.string()).optional(),
    preserveChannels: z.array(commonSchemas.channelId).default([]),
    preserveCategories: z.array(commonSchemas.channelId).default([]),
    namingConvention: z.enum(['kebab-case', 'snake_case', 'Title Case', 'UPPERCASE']).default('kebab-case'),
    structure: z.object({
      categories: z.array(z.object({
        name: z.string(),
        position: z.number().optional(),
        channels: z.array(z.object({
          name: z.string(),
          type: z.number().default(0), // 0 = text, 2 = voice
          topic: z.string().optional(),
          nsfw: z.boolean().default(false),
          slowmode: z.number().default(0),
        })),
      })),
    }),
  }),
  output: z.object({
    proposalId: z.string(),
    currentLayout: z.object({
      categories: z.array(z.object({
        id: z.string(),
        name: z.string(),
        position: z.number(),
        channels: z.array(z.object({
          id: z.string(),
          name: z.string(),
          type: z.number(),
        })),
      })),
    }),
    proposedLayout: z.object({
      categories: z.array(z.object({
        name: z.string(),
        position: z.number(),
        channels: z.array(z.object({
          name: z.string(),
          type: z.number(),
          topic: z.string().optional(),
          nsfw: z.boolean(),
          slowmode: z.number(),
        })),
      })),
    }),
    changes: z.object({
      createCategories: z.array(z.object({ name: z.string(), position: z.number() })),
      deleteCategories: z.array(z.object({ id: z.string(), name: z.string() })),
      createChannels: z.array(z.object({ name: z.string(), type: z.number(), categoryId: z.string().nullable() })),
      deleteChannels: z.array(z.object({ id: z.string(), name: z.string(), reason: z.string() })),
      moveChannels: z.array(z.object({ id: z.string(), name: z.string(), fromCategoryId: z.string(), toCategoryId: z.string() })),
      renameChannels: z.array(z.object({ id: z.string(), oldName: z.string(), newName: z.string() })),
      renameCategories: z.array(z.object({ id: z.string(), oldName: z.string(), newName: z.string() })),
    }),
    warnings: z.array(z.string()),
  }),
};

export const applyServerLayoutSchema = {
  input: z.object({
    proposalId: z.string(),
    confirm: z.boolean(),
    steps: z.array(z.enum([
      'CREATE_CATEGORIES',
      'DELETE_CATEGORIES',
      'CREATE_CHANNELS',
      'DELETE_CHANNELS',
      'MOVE_CHANNELS',
      'RENAME_CHANNELS',
      'RENAME_CATEGORIES',
    ])).optional(),
  }),
  output: z.object({
    success: z.boolean(),
    appliedSteps: z.array(z.object({
      step: z.string(),
      success: z.boolean(),
      details: z.string(),
      error: z.string().optional(),
    })),
    failedSteps: z.array(z.object({
      step: z.string(),
      error: z.string(),
    })),
    finalLayout: z.object({
      categories: z.array(z.object({
        id: z.string(),
        name: z.string(),
        position: z.number(),
        channels: z.array(z.object({
          id: z.string(),
          name: z.string(),
          type: z.number(),
        })),
      })),
    }),
  }),
};

export const createChannelSchema = {
  input: z.object({
    name: z.string().min(1).max(100),
    type: z.number().int().min(0).max(15).default(0), // 0=text, 2=voice, 4=category, 5=announcement, 13=stage, 15=forum
    categoryId: commonSchemas.channelId.optional(),
    topic: z.string().max(1024).optional(),
    nsfw: z.boolean().default(false),
    rateLimitPerUser: z.number().int().min(0).max(21600).default(0),
    position: z.number().int().optional(),
    permissionOverwrites: z.array(z.object({
      id: commonSchemas.snowflake,
      type: z.number().int().min(0).max(1), // 0=role, 1=member
      allow: z.string(),
      deny: z.string(),
    })).optional(),
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    channelId: z.string(),
    name: z.string(),
    type: z.number(),
  }),
};

export const editChannelSchema = {
  input: z.object({
    channelId: commonSchemas.channelId,
    name: z.string().min(1).max(100).optional(),
    topic: z.string().max(1024).nullable().optional(),
    nsfw: z.boolean().optional(),
    rateLimitPerUser: z.number().int().min(0).max(21600).optional(),
    position: z.number().int().optional(),
    categoryId: commonSchemas.channelId.nullable().optional(),
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    channelId: z.string(),
    changes: z.record(z.unknown()),
  }),
};

export const deleteChannelSchema = {
  input: z.object({
    channelId: commonSchemas.channelId,
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    channelId: z.string(),
    name: z.string(),
  }),
};

export const createCategorySchema = {
  input: z.object({
    name: z.string().min(1).max(100),
    position: z.number().int().optional(),
    permissionOverwrites: z.array(z.object({
      id: commonSchemas.snowflake,
      type: z.number().int().min(0).max(1),
      allow: z.string(),
      deny: z.string(),
    })).optional(),
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    categoryId: z.string(),
    name: z.string(),
  }),
};

export const editCategorySchema = {
  input: z.object({
    categoryId: commonSchemas.channelId,
    name: z.string().min(1).max(100).optional(),
    position: z.number().int().optional(),
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    categoryId: z.string(),
    changes: z.record(z.unknown()),
  }),
};

export const deleteCategorySchema = {
  input: z.object({
    categoryId: commonSchemas.channelId,
    reason: commonSchemas.reason,
    moveChannelsTo: commonSchemas.channelId.optional(), // Optional: move channels to another category
  }),
  output: z.object({
    success: z.boolean(),
    categoryId: z.string(),
    name: z.string(),
    movedChannels: z.array(z.string()).optional(),
  }),
};

export const moveChannelSchema = {
  input: z.object({
    channelId: commonSchemas.channelId,
    categoryId: commonSchemas.channelId.nullable(),
    position: z.number().int().optional(),
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    channelId: z.string(),
    oldCategoryId: z.string().nullable(),
    newCategoryId: z.string().nullable(),
  }),
};

export const detectDuplicateChannelsSchema = {
  input: z.object({
    similarityThreshold: z.number().min(0).max(1).default(0.8),
  }),
  output: z.object({
    duplicates: z.array(z.object({
      channels: z.array(z.object({
        id: z.string(),
        name: z.string(),
        categoryId: z.string().nullable(),
        messageCount: z.number(),
        lastActivity: z.string().nullable(),
      })),
      similarity: z.number(),
      suggestion: z.string(),
    })),
  }),
};