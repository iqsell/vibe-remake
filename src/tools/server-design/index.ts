import { ChannelType } from 'discord.js';
import { ToolRegistration, ToolContext } from '../registry.js';
import { prisma } from '../../db/client.js';
import { fetchGuild, fetchTextChannel, isoSafe } from '../helpers.js';
import {
  inspectServerLayoutSchema,
  proposeServerLayoutSchema,
  applyServerLayoutSchema,
  createChannelSchema,
  editChannelSchema,
  deleteChannelSchema,
  createCategorySchema,
  editCategorySchema,
  deleteCategorySchema,
  moveChannelSchema,
  detectDuplicateChannelsSchema,
} from '../schemas/server-design.js';

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
    auditEventType: name.split('.').pop()?.toUpperCase() ?? 'SERVER_DESIGN',
    timeoutMs: 20000,
    retryable: false,
    handler,
    ...opts,
  };
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

export function registerServerDesignTools(registry: any): void {
  registry.register(registration(
    'server-design.inspectServerLayout',
    'Inspect the current server layout including categories, channels and roles',
    inspectServerLayoutSchema,
    'NONE',
    async (input: any, context: ToolContext) => {
      const guild = await fetchGuild(context.discordClient, context.guildId);

      const categories = guild.channels.cache
        .filter((c: any) => c.type === ChannelType.GuildCategory)
        .sort((a: any, b: any) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
        .map((cat: any) => ({
          id: cat.id,
          name: cat.name,
          position: cat.rawPosition ?? 0,
          channels: guild.channels.cache
            .filter((c: any) => c.parentId === cat.id)
            .sort((a: any, b: any) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
            .map((c: any) => ({
              id: c.id,
              name: c.name,
              type: c.type,
              topic: 'topic' in c ? (c.topic ?? null) : null,
              nsfw: 'nsfw' in c ? !!c.nsfw : false,
              rateLimitPerUser: 'rateLimitPerUser' in c ? (c.rateLimitPerUser ?? 0) : 0,
              position: c.rawPosition ?? 0,
            })),
        }));

      const roles = guild.roles.cache
        .filter((r: any) => r.name !== '@everyone')
        .sort((a: any, b: any) => b.position - a.position)
        .map((r: any) => ({
          id: r.id,
          name: r.name,
          color: r.color,
          position: r.position,
          permissions: r.permissions.toString(),
          memberCount: r.members?.size ?? 0,
        }));

      const result: any = { categories, roles };

      if (input.includeUnused) {
        result.unusedChannels = guild.channels.cache
          .filter((c: any) => typeof c.isTextBased === 'function' && c.isTextBased())
          .map((c: any) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            lastMessageAt: c.lastMessageAt ? isoSafe(c.lastMessageAt) : null,
          }));
      }

      return result;
    },
    { readOnly: true }
  ));

  registry.register(registration(
    'server-design.proposeServerLayout',
    'Propose a target server layout and compute the changes required',
    proposeServerLayoutSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const guild = await fetchGuild(context.discordClient, context.guildId);

      const currentCategories = guild.channels.cache
        .filter((c: any) => c.type === ChannelType.GuildCategory)
        .map((cat: any) => ({
          id: cat.id,
          name: cat.name,
          position: cat.rawPosition ?? 0,
          channels: guild.channels.cache
            .filter((c: any) => c.parentId === cat.id)
            .map((c: any) => ({ id: c.id, name: c.name, type: c.type })),
        }));

      const proposedLayout = {
        categories: input.structure.categories.map((cat: any, index: number) => ({
          name: cat.name,
          position: cat.position ?? index,
          channels: (cat.channels ?? []).map((ch: any) => ({
            name: ch.name,
            type: ch.type ?? 0,
            topic: ch.topic,
            nsfw: ch.nsfw ?? false,
            slowmode: ch.slowmode ?? 0,
          })),
        })),
      };

      const createCategories = proposedLayout.categories
        .filter((pc: any) => !currentCategories.some((cc: any) => cc.name === pc.name))
        .map((pc: any) => ({ name: pc.name, position: pc.position }));

      const deleteCategories = currentCategories
        .filter((cc: any) => !proposedLayout.categories.some((pc: any) => pc.name === cc.name))
        .filter((cc: any) => !input.preserveCategories.includes(cc.id))
        .map((cc: any) => ({ id: cc.id, name: cc.name }));

      const changes = {
        createCategories,
        deleteCategories,
        createChannels: [] as any[],
        deleteChannels: [] as any[],
        moveChannels: [] as any[],
        renameChannels: [] as any[],
        renameCategories: [] as any[],
      };

      const warnings: string[] = [];
      if (deleteCategories.length > 0) {
        warnings.push(`${deleteCategories.length} categor(ies) will be deleted`);
      }

      const proposal = await prisma.layoutProposal.create({
        data: {
          guildId: context.guildId,
          createdBy: context.userId,
          proposal: { currentLayout: { categories: currentCategories }, proposedLayout, changes, warnings } as any,
          status: 'PENDING',
        },
      });

      return {
        proposalId: proposal.id,
        currentLayout: { categories: currentCategories },
        proposedLayout,
        changes,
        warnings,
      };
    }
  ));

  registry.register(registration(
    'server-design.applyServerLayout',
    'Apply a previously proposed server layout (requires confirmation)',
    applyServerLayoutSchema,
    'CRITICAL',
    async (input: any, context: ToolContext) => {
      if (!input.confirm) {
        throw new Error('applyServerLayout requires confirm=true');
      }

      const proposal = await prisma.layoutProposal.findFirst({
        where: { id: input.proposalId, guildId: context.guildId },
      });
      if (!proposal) throw new Error('Layout proposal not found');

      const guild = await fetchGuild(context.discordClient, context.guildId);
      const data = proposal.proposal as any;

      const appliedSteps: any[] = [];
      const failedSteps: any[] = [];

      const allSteps = input.steps ?? [
        'CREATE_CATEGORIES',
        'DELETE_CATEGORIES',
        'CREATE_CHANNELS',
        'DELETE_CHANNELS',
        'MOVE_CHANNELS',
        'RENAME_CHANNELS',
        'RENAME_CATEGORIES',
      ];

      for (const step of allSteps) {
        try {
          if (step === 'CREATE_CATEGORIES') {
            for (const cat of data.changes?.createCategories ?? []) {
              await guild.channels.create({
                name: cat.name,
                type: ChannelType.GuildCategory,
                position: cat.position,
              });
            }
          } else if (step === 'DELETE_CATEGORIES') {
            for (const cat of data.changes?.deleteCategories ?? []) {
              const channel = guild.channels.cache.get(cat.id);
              if (channel) await channel.delete('Server layout applied');
            }
          } else if (step === 'CREATE_CHANNELS') {
            for (const cat of data.proposedLayout?.categories ?? []) {
              const parent = guild.channels.cache.find(
                (c: any) => c.type === ChannelType.GuildCategory && c.name === cat.name
              );
              for (const ch of cat.channels ?? []) {
                await guild.channels.create({
                  name: ch.name,
                  type: ch.type === 2 ? ChannelType.GuildVoice : ChannelType.GuildText,
                  parent: parent?.id,
                  topic: ch.topic,
                  nsfw: ch.nsfw,
                  rateLimitPerUser: ch.slowmode,
                });
              }
            }
          } else if (step === 'DELETE_CHANNELS') {
            for (const ch of data.changes?.deleteChannels ?? []) {
              const channel = guild.channels.cache.get(ch.id);
              if (channel) await channel.delete('Server layout applied');
            }
          } else if (step === 'MOVE_CHANNELS') {
            for (const mv of data.changes?.moveChannels ?? []) {
              const channel = guild.channels.cache.get(mv.id);
              if (channel) await channel.setParent(mv.toCategoryId, { lockPermissions: false });
            }
          }

          appliedSteps.push({ step, success: true, details: 'Applied' });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          appliedSteps.push({ step, success: false, details: 'Failed', error: message });
          failedSteps.push({ step, error: message });
        }
      }

      await prisma.layoutProposal.update({
        where: { id: proposal.id },
        data: { status: failedSteps.length === 0 ? 'APPLIED' : 'PARTIALLY_APPLIED', appliedAt: new Date() },
      });

      const finalLayout = {
        categories: guild.channels.cache
          .filter((c: any) => c.type === ChannelType.GuildCategory)
          .map((cat: any) => ({
            id: cat.id,
            name: cat.name,
            position: cat.rawPosition ?? 0,
            channels: guild.channels.cache
              .filter((c: any) => c.parentId === cat.id)
              .map((c: any) => ({ id: c.id, name: c.name, type: c.type })),
          })),
      };

      return { success: failedSteps.length === 0, appliedSteps, failedSteps, finalLayout };
    }
  ));

  registry.register(registration(
    'server-design.createChannel',
    'Create a new channel',
    createChannelSchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const guild = await fetchGuild(context.discordClient, context.guildId);
      const channel = await guild.channels.create({
        name: input.name,
        type: input.type,
        parent: input.categoryId,
        topic: input.type === 0 || input.type === 5 ? input.topic : undefined,
        nsfw: input.nsfw,
        rateLimitPerUser: input.type === 0 ? input.rateLimitPerUser : undefined,
        position: input.position,
        permissionOverwrites: input.permissionOverwrites,
        reason: input.reason,
      });
      return { success: true, channelId: channel.id, name: channel.name, type: channel.type };
    }
  ));

  registry.register(registration(
    'server-design.editChannel',
    'Edit an existing channel',
    editChannelSchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const channel = await fetchTextChannel(context.discordClient, input.channelId);
      const changes: Record<string, unknown> = {};

      if (input.name !== undefined) changes.name = input.name;
      if (input.topic !== undefined) changes.topic = input.topic;
      if (input.nsfw !== undefined) changes.nsfw = input.nsfw;
      if (input.rateLimitPerUser !== undefined) changes.rateLimitPerUser = input.rateLimitPerUser;
      if (input.position !== undefined) changes.position = input.position;
      if (input.categoryId !== undefined) changes.parent = input.categoryId;

      await channel.edit({ ...changes, reason: input.reason });
      return { success: true, channelId: input.channelId, changes };
    }
  ));

  registry.register(registration(
    'server-design.deleteChannel',
    'Delete a channel (requires confirmation)',
    deleteChannelSchema,
    'HIGH',
    async (input: any, context: ToolContext) => {
      const channel = await fetchTextChannel(context.discordClient, input.channelId);
      const name = channel.name;
      await channel.delete(input.reason);
      return { success: true, channelId: input.channelId, name };
    }
  ));

  registry.register(registration(
    'server-design.createCategory',
    'Create a new channel category',
    createCategorySchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const guild = await fetchGuild(context.discordClient, context.guildId);
      const category = await guild.channels.create({
        name: input.name,
        type: ChannelType.GuildCategory,
        position: input.position,
        permissionOverwrites: input.permissionOverwrites,
        reason: input.reason,
      });
      return { success: true, categoryId: category.id, name: category.name };
    }
  ));

  registry.register(registration(
    'server-design.editCategory',
    'Edit an existing category',
    editCategorySchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const channel = await fetchTextChannel(context.discordClient, input.categoryId);
      const changes: Record<string, unknown> = {};
      if (input.name !== undefined) changes.name = input.name;
      if (input.position !== undefined) changes.position = input.position;
      await channel.edit({ ...changes, reason: input.reason });
      return { success: true, categoryId: input.categoryId, changes };
    }
  ));

  registry.register(registration(
    'server-design.deleteCategory',
    'Delete a channel category, optionally moving its channels',
    deleteCategorySchema,
    'HIGH',
    async (input: any, context: ToolContext) => {
      const guild = await fetchGuild(context.discordClient, context.guildId);
      const category = guild.channels.cache.get(input.categoryId);
      if (!category) throw new Error('Category not found');

      const name = category.name;
      const movedChannels: string[] = [];

      if (input.moveChannelsTo) {
        for (const child of guild.channels.cache.filter((c: any) => c.parentId === input.categoryId).values()) {
          try {
            await child.setParent(input.moveChannelsTo, { lockPermissions: false });
            movedChannels.push(child.id);
          } catch {
            // ignore individual move failures
          }
        }
      }

      await category.delete(input.reason);
      return { success: true, categoryId: input.categoryId, name, movedChannels };
    }
  ));

  registry.register(registration(
    'server-design.moveChannel',
    'Move a channel to a different category and/or position',
    moveChannelSchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const channel = await fetchTextChannel(context.discordClient, input.channelId);
      const oldCategoryId = channel.parentId ?? null;
      await channel.setParent(input.categoryId, { lockPermissions: false });
      if (input.position !== undefined) {
        await channel.setPosition(input.position);
      }
      return {
        success: true,
        channelId: input.channelId,
        oldCategoryId,
        newCategoryId: input.categoryId ?? null,
      };
    }
  ));

  registry.register(registration(
    'server-design.detectDuplicateChannels',
    'Detect channels with similar or duplicate names',
    detectDuplicateChannelsSchema,
    'NONE',
    async (input: any, context: ToolContext) => {
      const guild = await fetchGuild(context.discordClient, context.guildId);
      const channels = guild.channels.cache
        .filter((c: any) => c.type !== ChannelType.GuildCategory)
        .map((c: any) => ({
          id: c.id,
          name: c.name,
          categoryId: c.parentId ?? null,
          messageCount: 0,
          lastActivity: c.lastMessageAt ? isoSafe(c.lastMessageAt) : null,
        }));

      const duplicates: any[] = [];
      for (let i = 0; i < channels.length; i++) {
        for (let j = i + 1; j < channels.length; j++) {
          const score = similarity(channels[i].name.toLowerCase(), channels[j].name.toLowerCase());
          if (score >= input.similarityThreshold) {
            duplicates.push({
              channels: [channels[i], channels[j]],
              similarity: Number(score.toFixed(2)),
              suggestion: `Consider merging or renaming "${channels[i].name}" and "${channels[j].name}"`,
            });
          }
        }
      }

      return { duplicates };
    },
    { readOnly: true }
  ));
}
