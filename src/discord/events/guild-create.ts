import { Guild, Events } from 'discord.js';
import { logger, createGuildLogger } from '../../observability/logger.js';
import { prisma } from '../../db/client.js';
import { getEnv } from '../../config/env.js';

export async function handleGuildCreate(guild: Guild): Promise<void> {
  const guildLogger = createGuildLogger(guild.id);
  
  try {
    guildLogger.info({ 
      target: 'discord.events.guild', 
      name: guild.name,
      memberCount: guild.memberCount,
    }, 'Joined new guild');

    // Check if guild config exists
    const existingConfig = await prisma.guildConfig.findUnique({
      where: { guildId: guild.id },
    });

    if (!existingConfig) {
      // Create default guild config
      await prisma.guildConfig.create({
        data: {
          guildId: guild.id,
          // Defaults from schema will be applied
        },
      });
      guildLogger.info({ target: 'discord.events.guild' }, 'Created default guild config');
    }

    // Cache guild info
    // TODO: Update any in-memory guild cache

  } catch (error) {
    guildLogger.error({ err: error, target: 'discord.events.guild' }, 'Error handling guild create');
  }
}

export async function handleGuildDelete(guild: Guild): Promise<void> {
  const guildLogger = createGuildLogger(guild.id);
  
  try {
    guildLogger.info({ 
      target: 'discord.events.guild', 
      name: guild.name 
    }, 'Left guild');

    // Optionally clean up guild data or mark as inactive
    // For now, we keep the data for potential re-join
    // Could add a 'deletedAt' field or similar

  } catch (error) {
    guildLogger.error({ err: error, target: 'discord.events.guild' }, 'Error handling guild delete');
  }
}

export function registerGuildHandlers(client: any): void {
  client.on(Events.GuildCreate, handleGuildCreate);
  client.on(Events.GuildDelete, handleGuildDelete);
}