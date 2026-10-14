import { ToolRegistration, ToolContext } from '../registry.js';
import { prisma } from '../../db/client.js';
import { fetchGuild, fetchMember } from '../helpers.js';
import {
  setStaffDutySchema,
  getStaffDutySchema,
  getStaffActivitySchema,
  checkPermissionsSchema,
  getRoleHierarchySchema,
  createReportSchema,
  getReportsSchema,
  scheduleReminderSchema,
  cancelReminderSchema,
} from '../schemas/staff.js';

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
    auditEventType: name.split('.').pop()?.toUpperCase() ?? 'STAFF',
    timeoutMs: 15000,
    retryable: false,
    handler,
    ...opts,
  };
}

export function registerStaffTools(registry: any): void {
  registry.register(registration(
    'staff.setStaffDuty',
    'Set the duty status for a staff member',
    setStaffDutySchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const member = await fetchMember(context.discordClient, context.guildId, input.userId);
      const userName = member.user?.tag ?? member.user?.username ?? input.userId;

      const duty = await prisma.staffDuty.create({
        data: {
          guildId: context.guildId,
          userId: input.userId,
          userName,
          role: input.role,
          status: input.status,
          reason: input.reason,
          endedAt: input.status === 'OFF_DUTY' ? new Date() : null,
        },
      });

      return {
        success: true,
        dutyId: duty.id,
        userId: duty.userId,
        role: duty.role,
        status: duty.status,
        startedAt: duty.startedAt.toISOString(),
        endedAt: duty.endedAt?.toISOString() ?? null,
      };
    }
  ));

  registry.register(registration(
    'staff.getStaffDuty',
    'List staff duty records with optional filters',
    getStaffDutySchema,
    'NONE',
    async (input: any, context: ToolContext) => {
      const where: any = { guildId: context.guildId };
      if (input.userId) where.userId = input.userId;
      if (input.role) where.role = input.role;
      if (input.status) where.status = input.status;

      const duties = await prisma.staffDuty.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: 100,
      });

      return {
        duties: duties.map((d) => ({
          id: d.id,
          userId: d.userId,
          userName: d.userName,
          role: d.role,
          status: d.status,
          startedAt: d.startedAt.toISOString(),
          endedAt: d.endedAt?.toISOString() ?? null,
          reason: d.reason,
        })),
      };
    },
    { readOnly: true }
  ));

  registry.register(registration(
    'staff.getStaffActivity',
    'Aggregate staff activity by user, role and action type',
    getStaffActivitySchema,
    'NONE',
    async (input: any, context: ToolContext) => {
      const where: any = { guildId: context.guildId };
      if (input.userId) where.userId = input.userId;
      if (input.role) where.role = input.role;
      if (input.startDate || input.endDate) {
        where.recordedAt = {};
        if (input.startDate) where.recordedAt.gte = new Date(input.startDate);
        if (input.endDate) where.recordedAt.lte = new Date(input.endDate);
      }

      const records = await prisma.staffActivity.findMany({
        where,
        orderBy: { recordedAt: 'desc' },
        take: input.limit * 10,
      });

      const grouped = new Map<string, any>();
      for (const r of records) {
        const key = `${r.userId}|${r.role}|${r.actionType}|${r.period}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.count += r.count;
        } else {
          grouped.set(key, {
            userId: r.userId,
            userName: r.userName,
            role: r.role,
            actionType: r.actionType,
            count: r.count,
            period: r.period,
          });
        }
      }

      return { activity: Array.from(grouped.values()).slice(0, input.limit) };
    },
    { readOnly: true }
  ));

  registry.register(registration(
    'staff.checkPermissions',
    'Check whether a member holds the requested permissions',
    checkPermissionsSchema,
    'NONE',
    async (input: any, context: ToolContext) => {
      const guild = await fetchGuild(context.discordClient, context.guildId);
      const member = await fetchMember(context.discordClient, context.guildId, input.userId);

      let permissions = member.permissions;
      if (input.channelId) {
        const channel = guild.channels.cache.get(input.channelId);
        if (channel) {
          permissions = channel.permissionsFor(member) ?? member.permissions;
        }
      }

      const isOwner = guild.ownerId === input.userId;
      const isAdmin = permissions.has('Administrator');

      const details = input.permissions.map((permission: string) => {
        const has = permissions.has(permission as any);
        let source: 'ROLE' | 'OWNER' | 'ADMINISTRATOR' | 'CHANNEL_OVERRIDE' = 'ROLE';
        if (isOwner) source = 'OWNER';
        else if (isAdmin) source = 'ADMINISTRATOR';
        else if (input.channelId) source = 'CHANNEL_OVERRIDE';
        return { permission, has, source };
      });

      const missing = details.filter((d: any) => !d.has).map((d: any) => d.permission);

      return {
        hasAll: missing.length === 0,
        hasAny: details.some((d: any) => d.has),
        missing,
        details,
      };
    },
    { readOnly: true }
  ));

  registry.register(registration(
    'staff.getRoleHierarchy',
    'Compare role hierarchy between the bot and target member/role',
    getRoleHierarchySchema,
    'NONE',
    async (input: any, context: ToolContext) => {
      const guild = await fetchGuild(context.discordClient, context.guildId);
      const me = await guild.members.fetchMe();
      const botHighest = me.roles.highest;

      let userHighest: any = null;
      if (input.userId) {
        const member = await fetchMember(context.discordClient, context.guildId, input.userId);
        userHighest = member.roles.highest;
      }

      let targetHighest: any = null;
      if (input.roleId) {
        targetHighest = guild.roles.cache.get(input.roleId) ?? null;
      } else if (userHighest) {
        targetHighest = userHighest;
      }

      const canActOnUser = userHighest ? botHighest.position > userHighest.position : false;
      const canActOnRole = targetHighest ? botHighest.position > targetHighest.position : false;

      return {
        botHighestRole: { id: botHighest.id, name: botHighest.name, position: botHighest.position },
        userHighestRole: userHighest
          ? { id: userHighest.id, name: userHighest.name, position: userHighest.position }
          : null,
        targetHighestRole: targetHighest
          ? { id: targetHighest.id, name: targetHighest.name, position: targetHighest.position }
          : null,
        canActOnUser,
        canActOnRole,
        canAssignRole: canActOnRole && targetHighest.name !== '@everyone',
      };
    },
    { readOnly: true }
  ));

  registry.register(registration(
    'staff.createReport',
    'Create a user report for staff review',
    createReportSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const result = await prisma.report.aggregate({
        where: { guildId: context.guildId },
        _max: { number: true },
      });
      const number = (result._max.number ?? 0) + 1;

      let reportedUserName = input.reportedUserId;
      try {
        const guild = await fetchGuild(context.discordClient, context.guildId);
        const member = await guild.members.fetch(input.reportedUserId);
        reportedUserName = member.user?.tag ?? member.user?.username ?? input.reportedUserId;
      } catch {
        // ignore
      }

      let reportedByName = input.reportedById;
      try {
        const guild = await fetchGuild(context.discordClient, context.guildId);
        const member = await guild.members.fetch(input.reportedById);
        reportedByName = member.user?.tag ?? member.user?.username ?? input.reportedById;
      } catch {
        // ignore
      }

      const report = await prisma.report.create({
        data: {
          guildId: context.guildId,
          number,
          reportedUserId: input.reportedUserId,
          reportedUserName,
          reportedById: input.reportedById,
          reportedByName,
          reason: input.reason,
          evidence: (input.evidence ?? []) as any,
          status: 'OPEN',
          assignedToId: input.assignedToId,
        },
      });

      return {
        success: true,
        reportId: report.id,
        reportNumber: report.number,
        ticketId: report.ticketId ?? undefined,
      };
    }
  ));

  registry.register(registration(
    'staff.getReports',
    'List user reports with optional filters',
    getReportsSchema,
    'NONE',
    async (input: any, context: ToolContext) => {
      const where: any = { guildId: context.guildId };
      if (input.status) where.status = input.status;
      if (input.reportedUserId) where.reportedUserId = input.reportedUserId;
      if (input.assignedToId) where.assignedToId = input.assignedToId;

      const [reports, total] = await Promise.all([
        prisma.report.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: input.limit,
          skip: input.offset,
        }),
        prisma.report.count({ where }),
      ]);

      return {
        reports: reports.map((r) => ({
          id: r.id,
          number: r.number,
          reportedUserId: r.reportedUserId,
          reportedUserName: r.reportedUserName,
          reportedById: r.reportedById,
          reportedByName: r.reportedByName,
          reason: r.reason,
          status: r.status,
          assignedToId: r.assignedToId,
          createdAt: r.createdAt.toISOString(),
        })),
        total,
      };
    },
    { readOnly: true }
  ));

  registry.register(registration(
    'staff.scheduleReminder',
    'Schedule a reminder for a user',
    scheduleReminderSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const scheduledAt = new Date(input.at);
      if (Number.isNaN(scheduledAt.getTime())) {
        throw new Error('Invalid reminder date');
      }

      const reminder = await prisma.reminder.create({
        data: {
          guildId: context.guildId,
          userId: input.userId,
          message: input.message,
          scheduledAt,
          recurring: (input.recurring ?? null) as any,
          status: 'SCHEDULED',
        },
      });

      return {
        success: true,
        reminderId: reminder.id,
        scheduledAt: reminder.scheduledAt.toISOString(),
      };
    }
  ));

  registry.register(registration(
    'staff.cancelReminder',
    'Cancel a scheduled reminder',
    cancelReminderSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const reminder = await prisma.reminder.findFirst({
        where: { id: input.reminderId, guildId: context.guildId },
      });
      if (!reminder) throw new Error('Reminder not found');

      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { status: 'CANCELLED' },
      });

      return { success: true, reminderId: reminder.id };
    }
  ));
}
