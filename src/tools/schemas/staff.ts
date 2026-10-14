import { z } from 'zod';
import { commonSchemas } from '../registry.js';

export const setStaffDutySchema = {
  input: z.object({
    userId: commonSchemas.userId,
    role: z.string().min(1).max(50), // e.g., 'moderator', 'admin', 'helper'
    status: z.enum(['ACTIVE', 'ON_BREAK', 'OFF_DUTY', 'EXTENDED_LEAVE']),
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    dutyId: z.string(),
    userId: z.string(),
    role: z.string(),
    status: z.string(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
  }),
};

export const getStaffDutySchema = {
  input: z.object({
    userId: commonSchemas.userId.optional(),
    role: z.string().optional(),
    status: z.enum(['ACTIVE', 'ON_BREAK', 'OFF_DUTY', 'EXTENDED_LEAVE']).optional(),
  }),
  output: z.object({
    duties: z.array(z.object({
      id: z.string(),
      userId: z.string(),
      userName: z.string(),
      role: z.string(),
      status: z.string(),
      startedAt: z.string(),
      endedAt: z.string().nullable(),
      reason: z.string().nullable(),
    })),
  }),
};

export const getStaffActivitySchema = {
  input: z.object({
    userId: commonSchemas.userId.optional(),
    role: z.string().optional(),
    startDate: z.string().optional(), // ISO date
    endDate: z.string().optional(),
    limit: z.number().int().positive().max(100).default(25),
  }),
  output: z.object({
    activity: z.array(z.object({
      userId: z.string(),
      userName: z.string(),
      role: z.string(),
      actionType: z.string(),
      count: z.number(),
      period: z.string(),
    })),
  }),
};

export const checkPermissionsSchema = {
  input: z.object({
    userId: commonSchemas.userId,
    permissions: z.array(z.string()).min(1),
    channelId: commonSchemas.channelId.optional(),
  }),
  output: z.object({
    hasAll: z.boolean(),
    hasAny: z.boolean(),
    missing: z.array(z.string()),
    details: z.array(z.object({
      permission: z.string(),
      has: z.boolean(),
      source: z.enum(['ROLE', 'OWNER', 'ADMINISTRATOR', 'CHANNEL_OVERRIDE']),
    })),
  }),
};

export const getRoleHierarchySchema = {
  input: z.object({
    userId: commonSchemas.userId.optional(),
    roleId: commonSchemas.roleId.optional(),
  }),
  output: z.object({
    botHighestRole: z.object({
      id: z.string(),
      name: z.string(),
      position: z.number(),
    }),
    userHighestRole: z.object({
      id: z.string(),
      name: z.string(),
      position: z.number(),
    }).nullable(),
    targetHighestRole: z.object({
      id: z.string(),
      name: z.string(),
      position: z.number(),
    }).nullable(),
    canActOnUser: z.boolean(),
    canActOnRole: z.boolean(),
    canAssignRole: z.boolean(),
  }),
};

export const createReportSchema = {
  input: z.object({
    reportedUserId: commonSchemas.userId,
    reportedById: commonSchemas.userId,
    reason: z.string().max(1000),
    evidence: z.array(z.object({
      type: z.string(),
      value: z.string(),
      description: z.string().optional(),
    })).optional(),
    assignedToId: commonSchemas.userId.optional(),
    channelId: commonSchemas.channelId.optional(),
  }),
  output: z.object({
    success: z.boolean(),
    reportId: z.string(),
    reportNumber: z.number(),
    ticketId: z.string().optional(),
  }),
};

export const getReportsSchema = {
  input: z.object({
    status: z.enum(['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED']).optional(),
    reportedUserId: commonSchemas.userId.optional(),
    assignedToId: commonSchemas.userId.optional(),
    limit: z.number().int().positive().max(100).default(25),
    offset: z.number().int().min(0).default(0),
  }),
  output: z.object({
    reports: z.array(z.object({
      id: z.string(),
      number: z.number(),
      reportedUserId: z.string(),
      reportedUserName: z.string(),
      reportedById: z.string(),
      reportedByName: z.string(),
      reason: z.string(),
      status: z.string(),
      assignedToId: z.string().nullable(),
      createdAt: z.string(),
    })),
    total: z.number(),
  }),
};

export const scheduleReminderSchema = {
  input: z.object({
    userId: commonSchemas.userId,
    message: z.string().max(2000),
    at: z.string(), // ISO datetime
    recurring: z.object({
      frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
      interval: z.number().int().positive().default(1),
      endDate: z.string().optional(),
    }).optional(),
  }),
  output: z.object({
    success: z.boolean(),
    reminderId: z.string(),
    scheduledAt: z.string(),
  }),
};

export const cancelReminderSchema = {
  input: z.object({
    reminderId: z.string(),
  }),
  output: z.object({
    success: z.boolean(),
    reminderId: z.string(),
  }),
};