import { logger, createTaskLogger } from '../observability/logger.js';
import { prisma } from '../db/client.js';
import { ToolRegistry, ToolRegistration } from '../tools/registry.js';

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  toolCalls?: any[];
  toolCallId?: string;
  name?: string;
}

export interface ServerContext {
  guildConfig: any;
  roles: any[];
  channels: any[];
  categories: any[];
  memberCount: number;
  botPermissions: any;
}

export interface UserContext {
  id: string;
  username: string;
  globalName: string | null;
  roles: string[];
  permissions: string;
  isStaff: boolean;
  isAdmin: boolean;
}

export interface TaskContext {
  taskId: string;
  guildId: string;
  channelId: string;
  userId: string;
  rawInput: string;
  sanitizedInput: string;
  mentionType: 'mention' | 'reply' | 'conversational';
  parsedMentions: any;
  conversationHistory: ConversationMessage[];
  serverContext: ServerContext;
  userContext: UserContext;
  availableTools: ToolRegistration[];
  previousSteps: any[];
  currentStepIndex: number;
}

const MAX_CONVERSATION_HISTORY = 20;
const MAX_CONTEXT_TOKENS = 8000;

export class ContextBuilder {
  private toolRegistry: ToolRegistry;

  constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  async buildContext(
    taskId: string,
    guildId: string,
    channelId: string,
    userId: string,
    rawInput: string,
    sanitizedInput: string,
    mentionType: 'mention' | 'reply' | 'conversational',
    parsedMentions: any
  ): Promise<TaskContext> {
    const taskLogger = createTaskLogger(taskId);

    // Fetch conversation history
    const conversationHistory = await this.getConversationHistory(guildId, channelId, userId);
    
    // Fetch server context
    const serverContext = await this.getServerContext(guildId);
    
    // Fetch user context
    const userContext = await this.getUserContext(guildId, userId);
    
    // Get available tools (filtered by user permissions)
    const availableTools = this.getAvailableTools(userContext, serverContext);
    
    // Get previous task steps if resuming
    const previousSteps = await this.getPreviousSteps(taskId);

    taskLogger.debug({ 
      target: 'agent.context', 
      historyLength: conversationHistory.length,
      toolCount: availableTools.length,
      previousSteps: previousSteps.length,
    }, 'Context built');

    return {
      taskId,
      guildId,
      channelId,
      userId,
      rawInput,
      sanitizedInput,
      mentionType,
      parsedMentions,
      conversationHistory,
      serverContext,
      userContext,
      availableTools,
      previousSteps,
      currentStepIndex: previousSteps.length,
    };
  }

  private async getConversationHistory(
    guildId: string, 
    channelId: string, 
    userId: string
  ): Promise<ConversationMessage[]> {
    try {
      const context = await prisma.conversationContext.findUnique({
        where: { guildId_channelId_userId: { guildId, channelId, userId } },
      });

      if (!context || !context.messages) {
        return [];
      }

      const messages = context.messages as unknown as ConversationMessage[];
      return messages.slice(-MAX_CONVERSATION_HISTORY);
    } catch (error) {
      logger.warn({ err: error, target: 'agent.context' }, 'Failed to fetch conversation history');
      return [];
    }
  }

  private async getServerContext(guildId: string): Promise<ServerContext> {
    try {
      const [guildConfig, roles, channels] = await Promise.all([
        prisma.guildConfig.findUnique({ where: { guildId } }),
        prisma.guildConfig.findUnique({ 
          where: { guildId },
          select: { /* roles would be fetched from Discord */ }
        }),
        prisma.guildConfig.findUnique({ 
          where: { guildId },
          select: { /* channels would be fetched from Discord */ }
        }),
      ]);

      // Note: Actual roles/channels would be fetched from Discord API
      // This is a placeholder structure
      return {
        guildConfig,
        roles: [],
        channels: [],
        categories: [],
        memberCount: 0,
        botPermissions: {},
      };
    } catch (error) {
      logger.warn({ err: error, target: 'agent.context' }, 'Failed to fetch server context');
      return {
        guildConfig: null,
        roles: [],
        channels: [],
        categories: [],
        memberCount: 0,
        botPermissions: {},
      };
    }
  }

  private async getUserContext(guildId: string, userId: string): Promise<UserContext> {
    try {
      // Check if user has staff/admin roles from guild config
      const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId } });
      
      const staffRoles = guildConfig?.trustedStaffRoles ?? [];
      const adminRoles = guildConfig?.adminRoles ?? [];
      const moderatorRoles = guildConfig?.moderatorRoles ?? [];
      
      // In reality, we'd fetch member from Discord to get their roles
      // For now, return basic structure
      return {
        id: userId,
        username: 'unknown',
        globalName: null,
        roles: [],
        permissions: '',
        isStaff: false,
        isAdmin: false,
      };
    } catch (error) {
      logger.warn({ err: error, target: 'agent.context' }, 'Failed to fetch user context');
      return {
        id: userId,
        username: 'unknown',
        globalName: null,
        roles: [],
        permissions: '',
        isStaff: false,
        isAdmin: false,
      };
    }
  }

  private getAvailableTools(userContext: UserContext, serverContext: ServerContext): ToolRegistration[] {
    const allTools = this.toolRegistry.getAll();
    
    // Filter tools based on user permissions and server config
    return allTools.filter(tool => {
      // Check if user has required permissions
      if (tool.requiredUserPermissions.length > 0) {
        // In reality, check against userContext.permissions
        // For now, allow if user is staff or admin
        if (!userContext.isStaff && !userContext.isAdmin) {
          // Allow read-only tools for everyone
          if (!tool.readOnly) return false;
        }
      }
      
      // Check bot permissions
      if (tool.requiredPermissions.length > 0) {
        // Check against serverContext.botPermissions
        // Placeholder for now
      }
      
      return true;
    });
  }

  private async getPreviousSteps(taskId: string): Promise<any[]> {
    try {
      const steps = await prisma.taskStep.findMany({
        where: { taskId },
        orderBy: { stepIndex: 'asc' },
      });
      return steps;
    } catch (error) {
      logger.warn({ err: error, target: 'agent.context' }, 'Failed to fetch previous steps');
      return [];
    }
  }

  async updateConversationContext(
    guildId: string,
    channelId: string,
    userId: string,
    messages: ConversationMessage[]
  ): Promise<void> {
    try {
      await prisma.conversationContext.upsert({
        where: { guildId_channelId_userId: { guildId, channelId, userId } },
        update: {
          messages: messages.slice(-MAX_CONVERSATION_HISTORY) as unknown as any,
          lastMessageAt: new Date(),
          messageCount: messages.length,
        },
        create: {
          guildId,
          channelId,
          userId,
          messages: messages.slice(-MAX_CONVERSATION_HISTORY) as unknown as any,
          lastMessageAt: new Date(),
          messageCount: messages.length,
        },
      });
    } catch (error) {
      logger.warn({ err: error, target: 'agent.context' }, 'Failed to update conversation context');
    }
  }

  async summarizeConversation(
    guildId: string,
    channelId: string,
    userId: string
  ): Promise<string | null> {
    try {
      const context = await prisma.conversationContext.findUnique({
        where: { guildId_channelId_userId: { guildId, channelId, userId } },
      });
      return context?.summary ?? null;
    } catch (error) {
      logger.warn({ err: error, target: 'agent.context' }, 'Failed to get conversation summary');
      return null;
    }
  }
}