import { Client, GatewayIntentBits, Partials, Events, Message, Guild, User } from 'discord.js';
import { logger } from '../observability/logger.js';
import { getEnv } from '../config/env.js';

export interface DiscordClientOptions {
  token: string;
  clientId: string;
}

export class VibeDiscordClient {
  private client: Client;
  private token: string;
  private clientId: string;
  private isReady = false;

  constructor(options: DiscordClientOptions) {
    this.token = options.token;
    this.clientId = options.clientId;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
      ],
      partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
        Partials.GuildMember,
        Partials.User,
      ],
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on(Events.ClientReady, this.onReady.bind(this));
    this.client.on(Events.Error, this.onError.bind(this));
    this.client.on(Events.Warn, this.onWarn.bind(this));
    this.client.on(Events.Debug, this.onDebug.bind(this));
  }

  registerGuildEventHandlers(): void {
    const client = this.client;
    Promise.all([
      import('./events/guild-create.js'),
      import('./events/message-create.js'),
      import('./events/interaction-create.js'),
    ]).then(([guild, message, interaction]) => {
      guild.registerGuildHandlers(client);
      message.registerMessageCreateHandler(client);
      interaction.registerInteractionHandlers(client);
      logger.info({ target: 'discord.client' }, 'Guild event handlers registered');
    }).catch((error) => {
      logger.error({ err: error, target: 'discord.client' }, 'Failed to register event handlers');
    });
  }

  private onReady(): void {
    this.isReady = true;
    logger.info({
      target: 'discord.client',
      user: this.client.user?.tag,
      id: this.client.user?.id,
      guilds: this.client.guilds.cache.size,
    }, 'Discord client ready');
  }

  private onError(error: Error): void {
    logger.error({ err: error, target: 'discord.client' }, 'Discord client error');
  }

  private onWarn(warning: string): void {
    logger.warn({ message: warning, target: 'discord.client' }, 'Discord client warning');
  }

  private onDebug(debug: string): void {
    if (getEnv().LOG_LEVEL === 'debug') {
      logger.debug({ message: debug, target: 'discord.client' });
    }
  }

  async login(): Promise<void> {
    try {
      await this.client.login(this.token);
    } catch (error) {
      logger.fatal({ err: error, target: 'discord.client' }, 'Failed to login to Discord');
      throw error;
    }
  }

  async destroy(): Promise<void> {
    this.isReady = false;
    await this.client.destroy();
    logger.info({ target: 'discord.client' }, 'Discord client destroyed');
  }

  getClient(): Client {
    return this.client;
  }

  getIsReady(): boolean {
    return this.isReady;
  }

  getClientId(): string {
    return this.clientId;
  }

  // Helper methods for common operations
  async fetchGuild(guildId: string): Promise<Guild | null> {
    try {
      return await this.client.guilds.fetch(guildId);
    } catch {
      return null;
    }
  }

  async fetchChannel(channelId: string): Promise<any> {
    try {
      return await this.client.channels.fetch(channelId);
    } catch {
      return null;
    }
  }

  async fetchUser(userId: string): Promise<User | null> {
    try {
      return await this.client.users.fetch(userId);
    } catch {
      return null;
    }
  }
}

export function createDiscordClient(): VibeDiscordClient {
  const env = getEnv();
  return new VibeDiscordClient({
    token: env.DISCORD_TOKEN,
    clientId: env.DISCORD_CLIENT_ID,
  });
}