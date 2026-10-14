import { z } from 'zod';
import { commonSchemas } from '../registry.js';

export const createApplicationPanelSchema = {
  input: z.object({
    type: z.string().min(1).max(50), // e.g., 'staff', 'moderator', 'builder'
    title: z.string().min(1).max(100),
    description: z.string().max(4000),
    questions: z.array(z.object({
      id: z.string(),
      label: z.string().max(200),
      type: z.enum(['SHORT', 'PARAGRAPH', 'CHOICE', 'MULTI_CHOICE', 'USER', 'CHANNEL', 'ROLE']),
      required: z.boolean().default(true),
      options: z.array(z.string()).optional(), // For CHOICE/MULTI_CHOICE
      placeholder: z.string().optional(),
    })).min(1).max(25),
    channelId: commonSchemas.channelId,
    reviewRoles: z.array(commonSchemas.roleId).default([]),
    maxApplications: z.number().int().positive().optional(),
    expireAfterDays: z.number().int().positive().optional(),
  }),
  output: z.object({
    success: z.boolean(),
    panelId: z.string(),
    messageId: z.string(),
    channelId: z.string(),
  }),
};

export const submitApplicationSchema = {
  input: z.object({
    panelId: z.string(),
    applicantId: commonSchemas.userId,
    answers: z.record(z.unknown()), // questionId -> answer
  }),
  output: z.object({
    success: z.boolean(),
    applicationId: z.string(),
    applicationNumber: z.number(),
    status: z.string(),
  }),
};

export const reviewApplicationSchema = {
  input: z.object({
    applicationId: z.string(),
    reviewerId: commonSchemas.userId,
    score: z.number().int().min(0).max(100).optional(),
    notes: z.string().max(2000).optional(),
    decision: z.enum(['ACCEPT', 'REJECT', 'REQUEST_CHANGES']).optional(),
  }),
  output: z.object({
    success: z.boolean(),
    applicationId: z.string(),
    status: z.string(),
    reviewId: z.string(),
  }),
};

export const decideApplicationSchema = {
  input: z.object({
    applicationId: z.string(),
    decidedBy: commonSchemas.userId,
    decision: z.enum(['ACCEPTED', 'REJECTED']),
    reason: z.string().max(2000).optional(),
  }),
  output: z.object({
    success: z.boolean(),
    applicationId: z.string(),
    status: z.string(),
    decidedAt: z.string(),
  }),
};

export const getApplicationSchema = {
  input: z.object({
    applicationId: z.string(),
  }),
  output: z.object({
    application: z.object({
      id: z.string(),
      number: z.number(),
      type: z.string(),
      status: z.string(),
      applicantId: z.string(),
      applicantName: z.string(),
      answers: z.record(z.unknown()),
      reviewerId: z.string().nullable(),
      reviewerName: z.string().nullable(),
      reviewNotes: z.string().nullable(),
      reviewScore: z.number().nullable(),
      decidedBy: z.string().nullable(),
      decidedAt: z.string().nullable(),
      decisionReason: z.string().nullable(),
      submittedAt: z.string(),
      reviewedAt: z.string().nullable(),
    }),
    reviews: z.array(z.object({
      id: z.string(),
      reviewerId: z.string(),
      reviewerName: z.string(),
      score: z.number().nullable(),
      notes: z.string().nullable(),
      decision: z.string().nullable(),
      createdAt: z.string(),
    })),
  }),
};

export const listApplicationsSchema = {
  input: z.object({
    status: z.enum(['PENDING', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED']).optional(),
    type: z.string().optional(),
    applicantId: commonSchemas.userId.optional(),
    reviewerId: commonSchemas.userId.optional(),
    limit: z.number().int().positive().max(100).default(25),
    offset: z.number().int().min(0).default(0),
  }),
  output: z.object({
    applications: z.array(z.object({
      id: z.string(),
      number: z.number(),
      type: z.string(),
      status: z.string(),
      applicantId: z.string(),
      applicantName: z.string(),
      reviewerId: z.string().nullable(),
      submittedAt: z.string(),
      reviewedAt: z.string().nullable(),
    })),
    total: z.number(),
  }),
};

export const getApplicationPanelSchema = {
  input: z.object({
    panelId: z.string(),
  }),
  output: z.object({
    panel: z.object({
      id: z.string(),
      type: z.string(),
      title: z.string(),
      description: z.string(),
      questions: z.array(z.object({
        id: z.string(),
        label: z.string(),
        type: z.string(),
        required: z.boolean(),
        options: z.array(z.string()).optional(),
        placeholder: z.string().optional(),
      })),
      channelId: z.string(),
      messageId: z.string(),
      reviewRoles: z.array(z.string()),
      maxApplications: z.number().nullable(),
      expireAfterDays: z.number().nullable(),
      createdAt: z.string(),
    }),
  }),
};

export const listApplicationPanelsSchema = {
  input: z.object({}),
  output: z.object({
    panels: z.array(z.object({
      id: z.string(),
      type: z.string(),
      title: z.string(),
      channelId: z.string(),
      status: z.enum(['ACTIVE', 'CLOSED', 'EXPIRED']),
      applicationCount: z.number(),
      createdAt: z.string(),
    })),
  }),
};