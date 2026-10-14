import { z } from 'zod';
import { ProviderRouter } from '../ai/router.js';
import { logger, createTaskLogger } from '../observability/logger.js';

export enum IntentType {
  // Discovery/Read
  SERVER_INSPECTION = 'SERVER_INSPECTION',
  MEMBER_LOOKUP = 'MEMBER_LOOKUP',
  ROLE_LOOKUP = 'ROLE_LOOKUP',
  CHANNEL_LOOKUP = 'CHANNEL_LOOKUP',
  AUDIT_LOG_QUERY = 'AUDIT_LOG_QUERY',
  PERMISSION_CHECK = 'PERMISSION_CHECK',
  CASE_HISTORY = 'CASE_HISTORY',
  TICKET_QUERY = 'TICKET_QUERY',
  APPLICATION_QUERY = 'APPLICATION_QUERY',
  
  // Moderation
  TIMEOUT_MEMBER = 'TIMEOUT_MEMBER',
  REMOVE_TIMEOUT = 'REMOVE_TIMEOUT',
  KICK_MEMBER = 'KICK_MEMBER',
  BAN_MEMBER = 'BAN_MEMBER',
  UNBAN_MEMBER = 'UNBAN_MEMBER',
  ADD_ROLE = 'ADD_ROLE',
  REMOVE_ROLE = 'REMOVE_ROLE',
  SET_NICKNAME = 'SET_NICKNAME',
  DELETE_MESSAGES = 'DELETE_MESSAGES',
  PURGE_MESSAGES = 'PURGE_MESSAGES',
  SET_SLOWMODE = 'SET_SLOWMODE',
  LOCK_CHANNEL = 'LOCK_CHANNEL',
  UNLOCK_CHANNEL = 'UNLOCK_CHANNEL',
  CREATE_CASE = 'CREATE_CASE',
  APPEAL_CASE = 'APPEAL_CASE',
  
  // Server Design
  PROPOSE_LAYOUT = 'PROPOSE_LAYOUT',
  APPLY_LAYOUT = 'APPLY_LAYOUT',
  CREATE_CHANNEL = 'CREATE_CHANNEL',
  EDIT_CHANNEL = 'EDIT_CHANNEL',
  DELETE_CHANNEL = 'DELETE_CHANNEL',
  CREATE_CATEGORY = 'CREATE_CATEGORY',
  EDIT_CATEGORY = 'EDIT_CATEGORY',
  DELETE_CATEGORY = 'DELETE_CATEGORY',
  MOVE_CHANNEL = 'MOVE_CHANNEL',
  
  // Tickets
  CREATE_TICKET = 'CREATE_TICKET',
  CLAIM_TICKET = 'CLAIM_TICKET',
  TRANSFER_TICKET = 'TRANSFER_TICKET',
  CLOSE_TICKET = 'CLOSE_TICKET',
  REOPEN_TICKET = 'REOPEN_TICKET',
  ADD_TICKET_PARTICIPANT = 'ADD_TICKET_PARTICIPANT',
  GENERATE_TRANSCRIPT = 'GENERATE_TRANSCRIPT',
  
  // Applications
  CREATE_APPLICATION_PANEL = 'CREATE_APPLICATION_PANEL',
  SUBMIT_APPLICATION = 'SUBMIT_APPLICATION',
  REVIEW_APPLICATION = 'REVIEW_APPLICATION',
  DECIDE_APPLICATION = 'DECIDE_APPLICATION',
  
  // Staff
  SET_STAFF_DUTY = 'SET_STAFF_DUTY',
  GET_STAFF_ACTIVITY = 'GET_STAFF_ACTIVITY',
  CREATE_REPORT = 'CREATE_REPORT',
  SCHEDULE_REMINDER = 'SCHEDULE_REMINDER',
  
  // General
  GENERAL_QUESTION = 'GENERAL_QUESTION',
  HELP = 'HELP',
  UNKNOWN = 'UNKNOWN',
}

export interface IntentResult {
  primaryIntent: IntentType;
  confidence: number;
  secondaryIntents: Array<{ intent: IntentType; confidence: number }>;
  entities: ExtractedEntities;
  requiresClarification: boolean;
  clarificationQuestions: string[];
  suggestedTools: string[];
  riskLevel: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readOnly: boolean;
}

export interface ExtractedEntities {
  targetUser?: string;
  targetRole?: string;
  targetChannel?: string;
  duration?: number;
  reason?: string;
  channelName?: string;
  categoryName?: string;
  roleName?: string;
  ticketType?: string;
  applicationType?: string;
  caseType?: string;
  [key: string]: any;
}

const INTENT_CLASSIFICATION_PROMPT = `You are an intent classifier for a Discord staff bot. Analyze the user's message and classify the primary intent.

Available intents:
- SERVER_INSPECTION: User wants to see server structure, channels, roles
- MEMBER_LOOKUP: User wants info about a specific member
- ROLE_LOOKUP: User wants info about a role
- CHANNEL_LOOKUP: User wants info about a channel
- AUDIT_LOG_QUERY: User wants to investigate audit logs (who did what)
- PERMISSION_CHECK: User wants to check permissions
- CASE_HISTORY: User wants to see moderation history
- TICKET_QUERY: User wants to see/list tickets
- APPLICATION_QUERY: User wants to see/list applications
- TIMEOUT_MEMBER: User wants to timeout a member
- REMOVE_TIMEOUT: User wants to remove a timeout
- KICK_MEMBER: User wants to kick a member
- BAN_MEMBER: User wants to ban a member
- UNBAN_MEMBER: User wants to unban a member
- ADD_ROLE: User wants to add a role to a member
- REMOVE_ROLE: User wants to remove a role from a member
- SET_NICKNAME: User wants to change a nickname
- DELETE_MESSAGES: User wants to delete specific messages
- PURGE_MESSAGES: User wants to bulk delete messages
- SET_SLOWMODE: User wants to set slowmode
- LOCK_CHANNEL: User wants to lock a channel
- UNLOCK_CHANNEL: User wants to unlock a channel
- CREATE_CASE: User wants to create a moderation case
- APPEAL_CASE: User wants to appeal a case
- PROPOSE_LAYOUT: User wants a server layout proposal
- APPLY_LAYOUT: User wants to apply a layout proposal
- CREATE_CHANNEL: User wants to create a channel
- EDIT_CHANNEL: User wants to edit a channel
- DELETE_CHANNEL: User wants to delete a channel
- CREATE_CATEGORY: User wants to create a category
- EDIT_CATEGORY: User wants to edit a category
- DELETE_CATEGORY: User wants to delete a category
- MOVE_CHANNEL: User wants to move a channel
- CREATE_TICKET: User wants to create a ticket
- CLAIM_TICKET: User wants to claim a ticket
- TRANSFER_TICKET: User wants to transfer a ticket
- CLOSE_TICKET: User wants to close a ticket
- REOPEN_TICKET: User wants to reopen a ticket
- ADD_TICKET_PARTICIPANT: User wants to add participant to ticket
- GENERATE_TRANSCRIPT: User wants to generate a ticket transcript
- CREATE_APPLICATION_PANEL: User wants to create an application panel
- SUBMIT_APPLICATION: User wants to submit an application
- REVIEW_APPLICATION: User wants to review an application
- DECIDE_APPLICATION: User wants to make a decision on an application
- SET_STAFF_DUTY: User wants to set staff duty status
- GET_STAFF_ACTIVITY: User wants staff activity summary
- CREATE_REPORT: User wants to create a report
- SCHEDULE_REMINDER: User wants to schedule a reminder
- GENERAL_QUESTION: General question about bot/server
- HELP: User wants help
- UNKNOWN: Cannot determine intent

Extract entities: targetUser, targetRole, targetChannel, duration (ms), reason, channelName, categoryName, roleName, ticketType, applicationType, caseType

Return JSON only with: primaryIntent, confidence (0-1), secondaryIntents[], entities{}, requiresClarification (bool), clarificationQuestions[], suggestedTools[], riskLevel (NONE/LOW/MEDIUM/HIGH/CRITICAL), readOnly (bool)`;

export class IntentClassifier {
  private router: ProviderRouter;

  constructor(router: ProviderRouter) {
    this.router = router;
  }

  async classify(
    message: string,
    context: any
  ): Promise<IntentResult> {
    const taskLogger = createTaskLogger(context.taskId ?? 'unknown');

    try {
      const prompt = `${INTENT_CLASSIFICATION_PROMPT}

User message: "${message}"

Context:
- Guild: ${context.guildId}
- Channel: ${context.channelId}
- User: ${context.userId} (staff: ${context.userContext?.isStaff}, admin: ${context.userContext?.isAdmin})
- Mention type: ${context.mentionType}
- Parsed mentions: ${JSON.stringify(context.parsedMentions)}`;

      const response = await this.router.generate({
        messages: [
          { role: 'system', content: INTENT_CLASSIFICATION_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        maxTokens: 1000,
        responseFormat: { type: 'json_object' },
      }, {
        taskType: 'intent_classification',
        requiredCapabilities: ['structuredOutput'],
      });

      const result = JSON.parse(response.content ?? '{}');
      
      // Validate and normalize
      return this.normalizeResult(result);
    } catch (error) {
      taskLogger.error({ err: error, target: 'agent.intent' }, 'Intent classification failed');
      return this.getFallbackIntent(message, context);
    }
  }

  private normalizeResult(result: any): IntentResult {
    return {
      primaryIntent: result.primaryIntent ?? IntentType.UNKNOWN,
      confidence: Math.max(0, Math.min(1, result.confidence ?? 0)),
      secondaryIntents: Array.isArray(result.secondaryIntents) 
        ? result.secondaryIntents.slice(0, 3).map((s: any) => ({
            intent: s.intent ?? IntentType.UNKNOWN,
            confidence: Math.max(0, Math.min(1, s.confidence ?? 0)),
          }))
        : [],
      entities: result.entities ?? {},
      requiresClarification: Boolean(result.requiresClarification),
      clarificationQuestions: Array.isArray(result.clarificationQuestions) 
        ? result.clarificationQuestions.slice(0, 3) 
        : [],
      suggestedTools: Array.isArray(result.suggestedTools) 
        ? result.suggestedTools.slice(0, 10) 
        : [],
      riskLevel: ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(result.riskLevel) 
        ? result.riskLevel 
        : 'LOW',
      readOnly: Boolean(result.readOnly),
    };
  }

  private getFallbackIntent(message: string, context: any): IntentResult {
    const lower = message.toLowerCase();
    
    // Simple keyword-based fallback
    if (lower.includes('help') || lower.includes('what can you do')) {
      return {
        primaryIntent: IntentType.HELP,
        confidence: 0.8,
        secondaryIntents: [],
        entities: {},
        requiresClarification: false,
        clarificationQuestions: [],
        suggestedTools: [],
        riskLevel: 'NONE',
        readOnly: true,
      };
    }

    if (lower.includes('who') && (lower.includes('gave') || lower.includes('added') || lower.includes('removed'))) {
      return {
        primaryIntent: IntentType.AUDIT_LOG_QUERY,
        confidence: 0.7,
        secondaryIntents: [],
        entities: {},
        requiresClarification: true,
        clarificationQuestions: ['Which role or action are you referring to?'],
        suggestedTools: ['getAuditLog'],
        riskLevel: 'LOW',
        readOnly: true,
      };
    }

    if (lower.includes('timeout') && !lower.includes('remove')) {
      return {
        primaryIntent: IntentType.TIMEOUT_MEMBER,
        confidence: 0.6,
        secondaryIntents: [],
        entities: {},
        requiresClarification: true,
        clarificationQuestions: ['Which user? For how long?'],
        suggestedTools: ['timeoutMember'],
        riskLevel: 'MEDIUM',
        readOnly: false,
      };
    }

    return {
      primaryIntent: IntentType.UNKNOWN,
      confidence: 0.1,
      secondaryIntents: [],
      entities: {},
      requiresClarification: true,
      clarificationQuestions: ['Could you clarify what you\'d like me to do?'],
      suggestedTools: [],
      riskLevel: 'NONE',
      readOnly: true,
    };
  }
}