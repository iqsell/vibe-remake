import {
  ButtonInteraction,
  ModalSubmitInteraction,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import { prisma } from '../../db/client.js';
import { logger, createGuildLogger } from '../../observability/logger.js';
import {
  registerButtonHandler,
  registerModalHandler,
  parseCustomId,
} from '../events/interaction-create.js';

const MAX_MODAL_INPUTS = 5;

async function handleApplyButton(interaction: ButtonInteraction): Promise<void> {
  const guildLogger = createGuildLogger(interaction.guildId ?? 'unknown');
  const { params } = parseCustomId(interaction.customId);
  const [panelId] = params;

  if (!panelId || !interaction.guildId) {
    await interaction.reply({
      content: 'This application panel is no longer available.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const panel = await prisma.applicationPanel.findFirst({
    where: { id: panelId, guildId: interaction.guildId },
  });

  if (!panel || panel.status !== 'ACTIVE') {
    await interaction.reply({
      content: 'This application panel is no longer accepting applications.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const questions = Array.isArray(panel.questions) ? (panel.questions as any[]) : [];
  const modal = new ModalBuilder()
    .setCustomId(`applications:submit:${panelId}`)
    .setTitle(panel.title.slice(0, 45));

  for (const question of questions.slice(0, MAX_MODAL_INPUTS)) {
    const input = new TextInputBuilder()
      .setCustomId(question.id)
      .setLabel(String(question.label).slice(0, 45))
      .setStyle(question.type === 'PARAGRAPH' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(question.required !== false);

    if (question.placeholder) {
      input.setPlaceholder(String(question.placeholder).slice(0, 100));
    }

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }

  guildLogger.debug({ target: 'discord.interactions.applications', panelId }, 'Opened application modal');
  await interaction.showModal(modal);
}

async function handleSubmitModal(interaction: ModalSubmitInteraction): Promise<void> {
  const guildLogger = createGuildLogger(interaction.guildId ?? 'unknown');
  const { params } = parseCustomId(interaction.customId);
  const [panelId] = params;

  if (!panelId || !interaction.guildId) {
    await interaction.reply({
      content: 'This application panel is no longer available.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const panel = await prisma.applicationPanel.findFirst({
    where: { id: panelId, guildId: interaction.guildId },
  });

  if (!panel || panel.status !== 'ACTIVE') {
    await interaction.reply({
      content: 'This application panel is no longer accepting applications.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const questions = Array.isArray(panel.questions) ? (panel.questions as any[]) : [];
  const answers: Record<string, unknown> = {};
  for (const question of questions.slice(0, MAX_MODAL_INPUTS)) {
    try {
      answers[question.id] = interaction.fields.getTextInputValue(question.id);
    } catch {
      // field not present in this modal
    }
  }

  const aggregate = await prisma.application.aggregate({
    where: { guildId: interaction.guildId },
    _max: { number: true },
  });

  const application = await prisma.application.create({
    data: {
      guildId: interaction.guildId,
      number: (aggregate._max.number ?? 0) + 1,
      panelId: panel.id,
      type: panel.type,
      status: 'PENDING',
      applicantId: interaction.user.id,
      applicantName: interaction.user.tag ?? interaction.user.username,
      answers: answers as any,
    },
  });

  guildLogger.info(
    { target: 'discord.interactions.applications', applicationId: application.id, number: application.number },
    'Application submitted'
  );

  await interaction.reply({
    content: `Your application **#${application.number}** has been submitted. Thank you!`,
    flags: MessageFlags.Ephemeral,
  });
}

export function registerApplicationInteractions(): void {
  registerButtonHandler('applications', async (interaction) => {
    try {
      await handleApplyButton(interaction);
    } catch (error) {
      logger.error({ err: error, target: 'discord.interactions.applications' }, 'Failed to open application modal');
    }
  });

  registerModalHandler('applications', async (interaction) => {
    try {
      await handleSubmitModal(interaction);
    } catch (error) {
      logger.error({ err: error, target: 'discord.interactions.applications' }, 'Failed to handle application submission');
    }
  });
}
