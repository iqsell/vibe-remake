import { Interaction, Events, ButtonInteraction, ModalSubmitInteraction, StringSelectMenuInteraction, MessageFlags } from 'discord.js';
import { logger, createGuildLogger } from '../../observability/logger.js';
import { prisma } from '../../db/client.js';

interface InteractionHandler {
  customId: string;
  handler: (interaction: any) => Promise<void>;
}

const buttonHandlers = new Map<string, InteractionHandler>();
const modalHandlers = new Map<string, InteractionHandler>();
const selectMenuHandlers = new Map<string, InteractionHandler>();

export function registerButtonHandler(customId: string, handler: (interaction: ButtonInteraction) => Promise<void>): void {
  buttonHandlers.set(customId, { customId, handler });
}

export function registerModalHandler(customId: string, handler: (interaction: ModalSubmitInteraction) => Promise<void>): void {
  modalHandlers.set(customId, { customId, handler });
}

export function registerSelectMenuHandler(customId: string, handler: (interaction: StringSelectMenuInteraction) => Promise<void>): void {
  selectMenuHandlers.set(customId, { customId, handler });
}

export async function handleInteractionCreate(interaction: Interaction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) {
    // Ignore DM interactions for now
    return;
  }

  const guildLogger = createGuildLogger(interaction.guildId);

  try {
    if (interaction.isButton()) {
      await handleButtonInteraction(interaction, guildLogger);
    } else if (interaction.isModalSubmit()) {
      await handleModalInteraction(interaction, guildLogger);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelectMenuInteraction(interaction, guildLogger);
    }
  } catch (error) {
    guildLogger.error({ 
      err: error, 
      target: 'discord.events.interaction',
      interactionId: interaction.id,
      type: interaction.type,
    }, 'Error handling interaction');
    
    // Try to respond if not already responded
    const repliable = interaction as any;
    if (!repliable.replied && !repliable.deferred) {
      try {
        await repliable.reply({ 
          content: 'An error occurred while processing your interaction.', 
          flags: MessageFlags.Ephemeral 
        });
      } catch {
        // Ignore response errors
      }
    }
  }
}

async function handleButtonInteraction(interaction: ButtonInteraction, guildLogger: any): Promise<void> {
  // Extract handler key from customId (format: "handlerName:param1:param2")
  const [handlerKey] = interaction.customId.split(':');
  const handler = buttonHandlers.get(handlerKey);

  if (!handler) {
    guildLogger.debug({ 
      target: 'discord.events.interaction', 
      customId: interaction.customId,
      handlerKey 
    }, 'No handler for button interaction');
    return;
  }

  // Check if interaction is already handled
  if (interaction.replied || interaction.deferred) {
    return;
  }

  guildLogger.debug({ 
    target: 'discord.events.interaction', 
    customId: interaction.customId 
  }, 'Handling button interaction');

  await handler.handler(interaction);
}

async function handleModalInteraction(interaction: ModalSubmitInteraction, guildLogger: any): Promise<void> {
  const [handlerKey] = interaction.customId.split(':');
  const handler = modalHandlers.get(handlerKey);

  if (!handler) {
    guildLogger.debug({ 
      target: 'discord.events.interaction', 
      customId: interaction.customId,
      handlerKey 
    }, 'No handler for modal interaction');
    return;
  }

  if (interaction.replied || interaction.deferred) {
    return;
  }

  guildLogger.debug({ 
    target: 'discord.events.interaction', 
    customId: interaction.customId 
  }, 'Handling modal interaction');

  await handler.handler(interaction);
}

async function handleSelectMenuInteraction(interaction: StringSelectMenuInteraction, guildLogger: any): Promise<void> {
  const [handlerKey] = interaction.customId.split(':');
  const handler = selectMenuHandlers.get(handlerKey);

  if (!handler) {
    guildLogger.debug({ 
      target: 'discord.events.interaction', 
      customId: interaction.customId,
      handlerKey 
    }, 'No handler for select menu interaction');
    return;
  }

  if (interaction.replied || interaction.deferred) {
    return;
  }

  guildLogger.debug({ 
    target: 'discord.events.interaction', 
    customId: interaction.customId 
  }, 'Handling select menu interaction');

  await handler.handler(interaction);
}

export function registerInteractionHandlers(client: any): void {
  client.on(Events.InteractionCreate, handleInteractionCreate);
}

// Helper to create namespaced custom IDs
export function createCustomId(namespace: string, action: string, ...params: string[]): string {
  return `${namespace}:${action}:${params.join(':')}`;
}

export function parseCustomId(customId: string): { namespace: string; action: string; params: string[] } {
  const parts = customId.split(':');
  return {
    namespace: parts[0] ?? '',
    action: parts[1] ?? '',
    params: parts.slice(2),
  };
}