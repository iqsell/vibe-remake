import { z } from 'zod';
import { commonSchemas } from '../registry.js';

export const createTicketSchema = {
  input: z.object({
    type: z.enum(['SUPPORT', 'REPORT', 'APPEAL', 'GENERAL', 'STAFF_ONLY']),
    subject: z.string().min(1).max(100),
    description: z.string().max(4000),
    creatorId: commonSchemas.userId,
    tags: z.array(z.string()).default([]),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
    assigneeId: commonSchemas.userId.optional(),
  }),
  output: z.object({
    success: z.boolean(),
    ticketId: z.string(),
    ticketNumber: z.number(),
    channelId: z.string(),
    threadId: z.string().optional(),
  }),
};

export const claimTicketSchema = {
  input: z.object({
    ticketId: z.string(),
    staffId: commonSchemas.userId,
  }),
  output: z.object({
    success: z.boolean(),
    ticketId: z.string(),
    claimedBy: z.string(),
    claimedAt: z.string(),
  }),
};

export const transferTicketSchema = {
  input: z.object({
    ticketId: z.string(),
    newAssigneeId: commonSchemas.userId,
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    ticketId: z.string(),
    newAssignee: z.string(),
  }),
};

export const closeTicketSchema = {
  input: z.object({
    ticketId: z.string(),
    closedBy: commonSchemas.userId,
    reason: commonSchemas.reason,
    generateTranscript: z.boolean().default(true),
  }),
  output: z.object({
    success: z.boolean(),
    ticketId: z.string(),
    closedAt: z.string(),
    transcriptId: z.string().optional(),
    transcriptUrl: z.string().optional(),
  }),
};

export const reopenTicketSchema = {
  input: z.object({
    ticketId: z.string(),
    reopenedBy: commonSchemas.userId,
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    ticketId: z.string(),
    reopenedAt: z.string(),
  }),
};

export const addTicketParticipantSchema = {
  input: z.object({
    ticketId: z.string(),
    userId: commonSchemas.userId,
    addedBy: commonSchemas.userId,
  }),
  output: z.object({
    success: z.boolean(),
    ticketId: z.string(),
    participantId: z.string(),
  }),
};

export const removeTicketParticipantSchema = {
  input: z.object({
    ticketId: z.string(),
    userId: commonSchemas.userId,
    removedBy: commonSchemas.userId,
  }),
  output: z.object({
    success: z.boolean(),
    ticketId: z.string(),
    participantId: z.string(),
  }),
};

export const addTicketNoteSchema = {
  input: z.object({
    ticketId: z.string(),
    authorId: commonSchemas.userId,
    note: z.string().max(2000),
    internal: z.boolean().default(false),
  }),
  output: z.object({
    success: z.boolean(),
    ticketId: z.string(),
    noteId: z.string(),
  }),
};

export const getTicketSchema = {
  input: z.object({
    ticketId: z.string(),
  }),
  output: z.object({
    ticket: z.object({
      id: z.string(),
      number: z.number(),
      type: z.string(),
      status: z.string(),
      priority: z.string(),
      subject: z.string(),
      description: z.string(),
      creatorId: z.string(),
      creatorName: z.string(),
      assigneeId: z.string().nullable(),
      assigneeName: z.string().nullable(),
      participants: z.array(z.string()),
      channelId: z.string(),
      threadId: z.string().nullable(),
      tags: z.array(z.string()),
      openedAt: z.string(),
      claimedAt: z.string().nullable(),
      closedAt: z.string().nullable(),
      closedBy: z.string().nullable(),
      closedReason: z.string().nullable(),
    }),
    events: z.array(z.object({
      id: z.string(),
      type: z.string(),
      userId: z.string(),
      userName: z.string(),
      description: z.string(),
      metadata: z.record(z.unknown()),
      createdAt: z.string(),
    })),
  }),
};

export const listTicketsSchema = {
  input: z.object({
    status: z.enum(['OPEN', 'CLAIMED', 'IN_PROGRESS', 'WAITING_USER', 'WAITING_STAFF', 'RESOLVED', 'CLOSED', 'REOPENED']).optional(),
    assigneeId: commonSchemas.userId.optional(),
    creatorId: commonSchemas.userId.optional(),
    type: z.enum(['SUPPORT', 'REPORT', 'APPEAL', 'GENERAL', 'STAFF_ONLY']).optional(),
    limit: z.number().int().positive().max(100).default(25),
    offset: z.number().int().min(0).default(0),
  }),
  output: z.object({
    tickets: z.array(z.object({
      id: z.string(),
      number: z.number(),
      type: z.string(),
      status: z.string(),
      priority: z.string(),
      subject: z.string(),
      creatorId: z.string(),
      creatorName: z.string(),
      assigneeId: z.string().nullable(),
      openedAt: z.string(),
      claimedAt: z.string().nullable(),
    })),
    total: z.number(),
  }),
};

export const generateTranscriptSchema = {
  input: z.object({
    ticketId: z.string(),
    format: z.enum(['text', 'html', 'json']).default('text'),
    includeInternalNotes: z.boolean().default(false),
  }),
  output: z.object({
    success: z.boolean(),
    transcriptId: z.string(),
    content: z.string().optional(),
    url: z.string().optional(),
  }),
};