import { ChannelType } from 'discord.js';
import { ToolRegistration, ToolContext } from '../registry.js';
import { prisma } from '../../db/client.js';
import { fetchGuild, fetchTextChannel, isoSafe } from '../helpers.js';
import {
  createTicketSchema,
  claimTicketSchema,
  transferTicketSchema,
  closeTicketSchema,
  reopenTicketSchema,
  addTicketParticipantSchema,
  removeTicketParticipantSchema,
  addTicketNoteSchema,
  getTicketSchema,
  listTicketsSchema,
  generateTranscriptSchema,
} from '../schemas/tickets.js';

function registration(
  name: string,
  description: string,
  schema: { input: any; output: any },
  riskLevel: ToolRegistration['riskLevel'],
  handler: ToolRegistration['handler'],
  opts: Partial<ToolRegistration> = {}
): ToolRegistration {
  return {
    name,
    version: '1.0.0',
    description,
    inputSchema: schema.input,
    outputSchema: schema.output,
    readOnly: false,
    riskLevel,
    requiredPermissions: [],
    requiredUserPermissions: [],
    confirmationRequired: riskLevel === 'HIGH' || riskLevel === 'CRITICAL',
    auditEventType: name.split('.').pop()?.toUpperCase() ?? 'TICKET',
    timeoutMs: 20000,
    retryable: false,
    handler,
    ...opts,
  };
}

async function getTicketOrThrow(ticketId: string, guildId: string): Promise<any> {
  const ticket = await prisma.ticket.findFirst({ where: { id: ticketId, guildId } });
  if (!ticket) throw new Error('Ticket not found');
  return ticket;
}

async function buildTranscript(
  client: any,
  channelId: string,
  format: string,
  includeInternalNotes: boolean
): Promise<{ content: string; ticketRef: any }> {
  const channel = await fetchTextChannel(client, channelId);
  const fetched: any = await channel.messages.fetch({ limit: 100 });
  const messages = Array.from(fetched.values()).reverse() as any[];

  if (format === 'json') {
    return {
      content: JSON.stringify(
        messages.map((m) => ({
          id: m.id,
          authorId: m.author?.id,
          authorName: m.author?.tag ?? m.author?.username,
          content: m.content,
          timestamp: isoSafe(m.createdAt),
        })),
        null,
        2
      ),
      ticketRef: null,
    };
  }

  const lines = messages.map((m) => {
    const author = m.author?.tag ?? m.author?.username ?? 'unknown';
    return `[${isoSafe(m.createdAt)}] ${author}: ${m.content ?? ''}`;
  });
  const body = lines.join('\n');

  if (format === 'html') {
    const html = `<html><body><pre>${body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</pre></body></html>`;
    return { content: html, ticketRef: null };
  }

  const header = `Transcript generated${includeInternalNotes ? ' (includes internal notes)' : ''}\n\n`;
  return { content: header + body, ticketRef: null };
}

export function registerTicketTools(registry: any): void {
  registry.register(registration(
    'tickets.createTicket',
    'Create a support ticket with a dedicated channel',
    createTicketSchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const guild = await fetchGuild(context.discordClient, context.guildId);
      const config = await prisma.guildConfig.findUnique({ where: { guildId: context.guildId } });

      const result = await prisma.ticket.aggregate({
        where: { guildId: context.guildId },
        _max: { number: true },
      });
      const number = (result._max.number ?? 0) + 1;

      let creatorName = input.creatorId;
      try {
        const member = await guild.members.fetch(input.creatorId);
        creatorName = member.user?.tag ?? member.user?.username ?? input.creatorId;
      } catch {
        // keep fallback name
      }

      const permissionOverwrites: any[] = [
        {
          id: guild.roles.everyone.id,
          deny: ['ViewChannel'],
        },
        {
          id: input.creatorId,
          allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
        },
      ];

      const channel = await guild.channels.create({
        name: `ticket-${number}`,
        type: ChannelType.GuildText,
        parent: config?.ticketCategoryId ?? undefined,
        topic: `Ticket #${number}: ${input.subject}`,
        permissionOverwrites,
        reason: `Ticket #${number} opened`,
      });

      const ticket = await prisma.ticket.create({
        data: {
          guildId: context.guildId,
          number,
          type: input.type,
          status: 'OPEN',
          priority: input.priority,
          subject: input.subject,
          description: input.description,
          creatorId: input.creatorId,
          creatorName,
          assigneeId: input.assigneeId,
          channelId: channel.id,
          tags: input.tags ?? [],
          participants: {
            create: { userId: input.creatorId, addedBy: input.creatorId },
          },
          events: {
            create: {
              type: 'OPENED',
              userId: context.userId,
              userName: creatorName,
              description: `Ticket opened: ${input.subject}`,
              metadata: { type: input.type, priority: input.priority } as any,
            },
          },
        },
      });

      return {
        success: true,
        ticketId: ticket.id,
        ticketNumber: ticket.number,
        channelId: channel.id,
        threadId: undefined,
      };
    }
  ));

  registry.register(registration(
    'tickets.claimTicket',
    'Claim a ticket as its assigned staff member',
    claimTicketSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const ticket = await getTicketOrThrow(input.ticketId, context.guildId);
      const claimedAt = new Date();

      let staffName = input.staffId;
      try {
        const member = await (await fetchGuild(context.discordClient, context.guildId)).members.fetch(input.staffId);
        staffName = member.user?.tag ?? member.user?.username ?? input.staffId;
      } catch {
        // ignore
      }

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          assigneeId: input.staffId,
          assigneeName: staffName,
          status: 'CLAIMED',
          claimedAt,
          events: {
            create: {
              type: 'CLAIMED',
              userId: input.staffId,
              userName: staffName,
              description: `Ticket claimed by ${staffName}`,
              metadata: {} as any,
            },
          },
        },
      });

      return {
        success: true,
        ticketId: ticket.id,
        claimedBy: input.staffId,
        claimedAt: claimedAt.toISOString(),
      };
    }
  ));

  registry.register(registration(
    'tickets.transferTicket',
    'Transfer a ticket to a new assignee',
    transferTicketSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const ticket = await getTicketOrThrow(input.ticketId, context.guildId);

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          assigneeId: input.newAssigneeId,
          status: 'IN_PROGRESS',
          events: {
            create: {
              type: 'TRANSFERRED',
              userId: context.userId,
              userName: context.userId,
              description: input.reason ?? 'Ticket transferred',
              metadata: { newAssigneeId: input.newAssigneeId } as any,
            },
          },
        },
      });

      return { success: true, ticketId: ticket.id, newAssignee: input.newAssigneeId };
    }
  ));

  registry.register(registration(
    'tickets.closeTicket',
    'Close a ticket and optionally generate a transcript',
    closeTicketSchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const ticket = await getTicketOrThrow(input.ticketId, context.guildId);
      const closedAt = new Date();

      let transcriptId: string | undefined;
      let transcriptUrl: string | undefined;

      if (input.generateTranscript) {
        try {
          const { content } = await buildTranscript(
            context.discordClient,
            ticket.channelId,
            'text',
            false
          );
          const transcript = await prisma.transcript.create({
            data: { ticketId: ticket.id, format: 'text', content },
          });
          transcriptId = transcript.id;
          transcriptUrl = transcript.url ?? undefined;
        } catch {
          // transcript generation is best-effort
        }
      }

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          status: 'CLOSED',
          closedAt,
          closedBy: input.closedBy,
          closedReason: input.reason ?? null,
          events: {
            create: {
              type: 'CLOSED',
              userId: input.closedBy,
              userName: input.closedBy,
              description: input.reason ?? 'Ticket closed',
              metadata: { transcriptId: transcriptId ?? null } as any,
            },
          },
        },
      });

      try {
        const channel = await context.discordClient.channels.fetch(ticket.channelId);
        if (channel && 'setLocked' in channel) {
          await (channel as any).permissionOverwrites.edit(ticket.creatorId, { SendMessages: false });
        }
      } catch {
        // best-effort channel lock
      }

      return {
        success: true,
        ticketId: ticket.id,
        closedAt: closedAt.toISOString(),
        transcriptId,
        transcriptUrl,
      };
    }
  ));

  registry.register(registration(
    'tickets.reopenTicket',
    'Reopen a closed ticket',
    reopenTicketSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const ticket = await getTicketOrThrow(input.ticketId, context.guildId);
      const reopenedAt = new Date();

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          status: 'REOPENED',
          closedAt: null,
          events: {
            create: {
              type: 'REOPENED',
              userId: input.reopenedBy,
              userName: input.reopenedBy,
              description: input.reason ?? 'Ticket reopened',
              metadata: {} as any,
            },
          },
        },
      });

      return { success: true, ticketId: ticket.id, reopenedAt: reopenedAt.toISOString() };
    }
  ));

  registry.register(registration(
    'tickets.addTicketParticipant',
    'Add a participant to a ticket channel',
    addTicketParticipantSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const ticket = await getTicketOrThrow(input.ticketId, context.guildId);

      const participant = await prisma.ticketParticipant.upsert({
        where: { ticketId_userId: { ticketId: ticket.id, userId: input.userId } },
        update: {},
        create: { ticketId: ticket.id, userId: input.userId, addedBy: input.addedBy },
      });

      try {
        const channel = await context.discordClient.channels.fetch(ticket.channelId);
        await channel?.permissionOverwrites?.edit(input.userId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });
      } catch {
        // best-effort
      }

      await prisma.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          type: 'PARTICIPANT_ADDED',
          userId: input.addedBy,
          userName: input.addedBy,
          description: `Participant ${input.userId} added`,
          metadata: { userId: input.userId } as any,
        },
      });

      return { success: true, ticketId: ticket.id, participantId: participant.id };
    }
  ));

  registry.register(registration(
    'tickets.removeTicketParticipant',
    'Remove a participant from a ticket channel',
    removeTicketParticipantSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const ticket = await getTicketOrThrow(input.ticketId, context.guildId);

      const participant = await prisma.ticketParticipant.findUnique({
        where: { ticketId_userId: { ticketId: ticket.id, userId: input.userId } },
      });
      if (participant) {
        await prisma.ticketParticipant.delete({ where: { id: participant.id } });
      }

      try {
        const channel = await context.discordClient.channels.fetch(ticket.channelId);
        await channel?.permissionOverwrites?.delete(input.userId);
      } catch {
        // best-effort
      }

      await prisma.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          type: 'PARTICIPANT_REMOVED',
          userId: input.removedBy,
          userName: input.removedBy,
          description: `Participant ${input.userId} removed`,
          metadata: { userId: input.userId } as any,
        },
      });

      return { success: true, ticketId: ticket.id, participantId: participant?.id ?? input.userId };
    }
  ));

  registry.register(registration(
    'tickets.addTicketNote',
    'Add an internal or public note to a ticket',
    addTicketNoteSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const ticket = await getTicketOrThrow(input.ticketId, context.guildId);

      const note = await prisma.ticketNote.create({
        data: {
          ticketId: ticket.id,
          authorId: input.authorId,
          note: input.note,
          internal: input.internal,
        },
      });

      await prisma.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          type: 'NOTE_ADDED',
          userId: input.authorId,
          userName: input.authorId,
          description: input.internal ? 'Internal note added' : 'Note added',
          metadata: { noteId: note.id } as any,
        },
      });

      return { success: true, ticketId: ticket.id, noteId: note.id };
    }
  ));

  registry.register(registration(
    'tickets.getTicket',
    'Get a ticket with its event history',
    getTicketSchema,
    'NONE',
    async (input: any, context: ToolContext) => {
      const ticket = await prisma.ticket.findFirst({
        where: { id: input.ticketId, guildId: context.guildId },
        include: { events: { orderBy: { createdAt: 'asc' } }, participants: true },
      });
      if (!ticket) throw new Error('Ticket not found');

      return {
        ticket: {
          id: ticket.id,
          number: ticket.number,
          type: ticket.type,
          status: ticket.status,
          priority: ticket.priority,
          subject: ticket.subject,
          description: ticket.description,
          creatorId: ticket.creatorId,
          creatorName: ticket.creatorName,
          assigneeId: ticket.assigneeId,
          assigneeName: ticket.assigneeName,
          participants: ticket.participants.map((p) => p.userId),
          channelId: ticket.channelId,
          threadId: ticket.threadId,
          tags: ticket.tags,
          openedAt: ticket.openedAt.toISOString(),
          claimedAt: ticket.claimedAt?.toISOString() ?? null,
          closedAt: ticket.closedAt?.toISOString() ?? null,
          closedBy: ticket.closedBy,
          closedReason: ticket.closedReason,
        },
        events: ticket.events.map((e) => ({
          id: e.id,
          type: e.type,
          userId: e.userId,
          userName: e.userName,
          description: e.description,
          metadata: (e.metadata ?? {}) as Record<string, unknown>,
          createdAt: e.createdAt.toISOString(),
        })),
      };
    },
    { readOnly: true }
  ));

  registry.register(registration(
    'tickets.listTickets',
    'List tickets with optional filters',
    listTicketsSchema,
    'NONE',
    async (input: any, context: ToolContext) => {
      const where: any = { guildId: context.guildId };
      if (input.status) where.status = input.status;
      if (input.assigneeId) where.assigneeId = input.assigneeId;
      if (input.creatorId) where.creatorId = input.creatorId;
      if (input.type) where.type = input.type;

      const [tickets, total] = await Promise.all([
        prisma.ticket.findMany({
          where,
          orderBy: { openedAt: 'desc' },
          take: input.limit,
          skip: input.offset,
        }),
        prisma.ticket.count({ where }),
      ]);

      return {
        tickets: tickets.map((t) => ({
          id: t.id,
          number: t.number,
          type: t.type,
          status: t.status,
          priority: t.priority,
          subject: t.subject,
          creatorId: t.creatorId,
          creatorName: t.creatorName,
          assigneeId: t.assigneeId,
          openedAt: t.openedAt.toISOString(),
          claimedAt: t.claimedAt?.toISOString() ?? null,
        })),
        total,
      };
    },
    { readOnly: true }
  ));

  registry.register(registration(
    'tickets.generateTranscript',
    'Generate a transcript of a ticket channel',
    generateTranscriptSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const ticket = await getTicketOrThrow(input.ticketId, context.guildId);
      const { content } = await buildTranscript(
        context.discordClient,
        ticket.channelId,
        input.format,
        input.includeInternalNotes
      );

      const transcript = await prisma.transcript.create({
        data: { ticketId: ticket.id, format: input.format, content },
      });

      return {
        success: true,
        transcriptId: transcript.id,
        content: transcript.content,
        url: transcript.url ?? undefined,
      };
    }
  ));
}
