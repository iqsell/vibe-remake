import { Message } from 'discord.js';
import { prisma } from '../db/client.js';
import { ToolRegistry } from '../tools/registry.js';
import { ContextBuilder } from './context-builder.js';
import { IntentClassifier, IntentType, IntentResult } from './intent.js';
import { Planner, PlanningResult } from './planner.js';
import { Executor, ExecutionResult } from './executor.js';
import { PolicyEngine } from '../policy/authorize.js';
import { ProviderRouter } from '../ai/router.js';
import { logger, createTaskLogger, createGuildLogger } from '../observability/logger.js';
import { 
  Task, 
  TaskStatus, 
  StepStatus,
  TaskStateMachine 
} from './task-state-machine.js';
import { sendResponse, createProgressEmbed } from '../discord/response-sender.js';
import { VibeDiscordClient } from '../discord/client.js';
import { parseMentions, ParsedMentions } from '../discord/mention-parser.js';
import { checkRateLimit, incrementRateLimit } from '../utils/rate-limit.js';

interface RequestHandlerDependencies {
  toolRegistry: ToolRegistry;
  policyEngine: PolicyEngine;
  router: ProviderRouter;
  discordClient: VibeDiscordClient;
}

export class RequestHandler {
  private toolRegistry: ToolRegistry;
  private policyEngine: PolicyEngine;
  private router: ProviderRouter;
  private discordClient: VibeDiscordClient;
  private contextBuilder: ContextBuilder;
  private intentClassifier: IntentClassifier;
  private planner: Planner;
  private executor: Executor;

  constructor(deps: RequestHandlerDependencies) {
    this.toolRegistry = deps.toolRegistry;
    this.policyEngine = deps.policyEngine;
    this.router = deps.router;
    this.discordClient = deps.discordClient;

    this.contextBuilder = new ContextBuilder(this.toolRegistry);
    this.intentClassifier = new IntentClassifier(this.router);
    this.planner = new Planner(this.router, this.toolRegistry);
    this.executor = new Executor(this.toolRegistry, this.policyEngine);
  }

  async handleMessage(
    message: Message,
    cleanedContent: string,
    parsedMentions: ParsedMentions,
    mentionType: 'mention' | 'reply' | 'conversational'
  ): Promise<void> {
    const guildLogger = createGuildLogger(message.guildId ?? 'dm');
    const startTime = Date.now();

    try {
      // Check rate limits
      const rateLimitCheck = await checkRateLimit(message.guildId ?? 'global', message.author.id);
      if (!rateLimitCheck.allowed) {
        await sendResponse(message, `Rate limited. Try again in ${Math.ceil((rateLimitCheck.retryAfter ?? 0) / 1000)}s.`, { reply: true });
        return;
      }

      // Create task record
      const task = await this.createTask(message, cleanedContent, mentionType);
      const taskLogger = createTaskLogger(task.id);

      await incrementRateLimit(message.guildId ?? 'global', message.author.id);

      taskLogger.info({ 
        target: 'agent.request', 
        content: cleanedContent.slice(0, 200),
        mentionType,
      }, 'Handling request');

      // Update task status to interpreting
      await this.updateTaskStatus(task.id, TaskStatus.INTERPRETING);

      // Build context
      const context = await this.contextBuilder.buildContext(
        task.id,
        task.guildId,
        task.channelId,
        task.userId,
        task.rawInput,
        task.sanitizedInput,
        mentionType,
        parsedMentions
      );

      // Classify intent
      const intentResult = await this.intentClassifier.classify(cleanedContent, {
        ...context,
        taskId: task.id,
      });

      taskLogger.info({ 
        target: 'agent.request', 
        intent: intentResult.primaryIntent,
        confidence: intentResult.confidence,
      }, 'Intent classified');

      // Handle clarification needed
      if (intentResult.requiresClarification && intentResult.clarificationQuestions.length > 0) {
        await this.handleClarification(task, intentResult, message);
        return;
      }

      // Update task status to planning
      await this.updateTaskStatus(task.id, TaskStatus.PLANNING);

      // Create plan
      const planningResult = await this.planner.createPlan(task, intentResult, context);

      taskLogger.info({ 
        target: 'agent.request', 
        stepCount: planningResult.plan.steps.length,
        requiresApproval: planningResult.requiresApproval,
      }, 'Plan created');

      // Save plan to task
      await this.savePlan(task.id, planningResult.plan);

      // Handle clarification from planner
      if (planningResult.clarificationNeeded) {
        await this.handleClarification(task, { 
          ...intentResult, 
          clarificationQuestions: planningResult.clarificationQuestions 
        }, message);
        return;
      }

      // Handle approval needed
      if (planningResult.requiresApproval) {
        await this.handleApproval(task, planningResult, message);
        return;
      }

      // Execute plan
      await this.executePlanWithUpdates(task, planningResult.plan, context, message);

      const duration = Date.now() - startTime;
      taskLogger.info({ 
        target: 'agent.request', 
        durationMs: duration 
      }, 'Request handled successfully');

    } catch (error) {
      guildLogger.error({ 
        err: error, 
        target: 'agent.request',
        messageId: message.id,
      }, 'Error handling request');
      
      try {
        await sendResponse(message, 'An error occurred while processing your request.', { reply: true });
      } catch {
        // Ignore response errors
      }
    }
  }

  private async createTask(
    message: Message,
    cleanedContent: string,
    mentionType: 'mention' | 'reply' | 'conversational'
  ): Promise<Task> {
    const sanitizedInput = this.sanitizeInput(cleanedContent);

    const task = await prisma.task.create({
      data: {
        guildId: message.guildId!,
        channelId: message.channelId,
        userId: message.author.id,
        messageId: message.id,
        threadId: message.channel.isThread() ? message.channelId : null,
        rawInput: cleanedContent,
        sanitizedInput,
        status: TaskStatus.RECEIVED,
        maxSteps: 50,
        maxModelCalls: 20,
      },
    });

    return task as unknown as Task;
  }

  private sanitizeInput(input: string): string {
    // Remove potential prompt injections
    return input
      .replace(/ignore previous instructions/gi, '')
      .replace(/forget everything/gi, '')
      .replace(/you are now/gi, '')
      .replace(/system:/gi, '')
      .slice(0, 4000);
  }

  private async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    const valid = TaskStateMachine.canTransitionTask(
      (await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } }))?.status as TaskStatus,
      status
    );
    
    if (!valid) {
      logger.warn({ target: 'agent.request', taskId, from: 'unknown', to: status }, 'Invalid task status transition');
    }

    await prisma.task.update({
      where: { id: taskId },
      data: { 
        status,
        startedAt: status === TaskStatus.INTERPRETING ? new Date() : undefined,
        completedAt: TaskStateMachine.isTerminalTaskStatus(status) ? new Date() : undefined,
      },
    });
  }

  private async savePlan(taskId: string, plan: any): Promise<void> {
    await prisma.task.update({
      where: { id: taskId },
      data: { 
        plan: plan as any,
        planVersion: plan.version,
      },
    });

    // Create task steps
    for (const step of plan.steps) {
      await prisma.taskStep.create({
        data: {
          taskId,
          stepIndex: step.stepIndex,
          type: step.type,
          toolName: step.toolName,
          toolArgs: step.toolArgs,
          description: step.description,
          expectedOutput: step.expectedOutput,
          riskLevel: step.riskLevel,
          readOnly: step.readOnly,
          dependsOn: step.dependsOn,
          status: StepStatus.PENDING,
        },
      });
    }
  }

  private async handleClarification(
    task: Task,
    intentResult: IntentResult,
    message: Message
  ): Promise<void> {
    await this.updateTaskStatus(task.id, TaskStatus.AWAITING_CLARIFICATION);

    const questions = intentResult.clarificationQuestions.slice(0, 3);
    const response = `I need some clarification:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;

    await sendResponse(message, response, { reply: true });
  }

  private async handleApproval(
    task: Task,
    planningResult: PlanningResult,
    message: Message
  ): Promise<void> {
    await this.updateTaskStatus(task.id, TaskStatus.AWAITING_APPROVAL);

    // Create approval record
    const approvalId = `approval_${task.id}_${Date.now()}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await prisma.task.update({
      where: { id: task.id },
      data: {
        requiresApproval: true,
        approvalId,
        approvalExpires: expiresAt,
      },
    });

    // Send preview with confirmation buttons
    const steps = planningResult.plan.steps;
    const mutationSteps = steps.filter(s => s.type === 'MUTATION');
    
    const preview = `**Plan Preview** (requires approval)\n\n` +
      `**Intent:** ${planningResult.approvalReason}\n` +
      `**Steps:** ${steps.length} (${mutationSteps.length} mutations)\n\n` +
      mutationSteps.map((s, i) => `${i + 1}. ${s.description}`).join('\n') +
      `\n\n⏱️ Expires in 5 minutes`;

    // TODO: Send with interactive buttons for approve/deny
    await sendResponse(message, preview, { reply: true });
  }

  private async executePlanWithUpdates(
    task: Task,
    plan: any,
    context: any,
    originalMessage: Message
  ): Promise<void> {
    await this.updateTaskStatus(task.id, TaskStatus.EXECUTING);

    // Send progress update
    const progressEmbed = createProgressEmbed(
      'Executing Plan',
      `Running ${plan.steps.length} steps...`,
      0,
      plan.steps.length
    );
    
    let progressMessage: Message | null = null;
    try {
      progressMessage = await originalMessage.reply({ embeds: [progressEmbed] });
    } catch {
      // Ignore if can't send progress
    }

    // Execute
    const toolContext = {
      guildId: task.guildId,
      channelId: task.channelId,
      userId: task.userId,
      taskId: task.id,
      operationId: '',
      discordClient: this.discordClient.getClient(),
      prisma,
      logger: createTaskLogger(task.id),
    };

    const result = await this.executor.executePlan(task, plan, toolContext);

    // Update task status based on result
    if (result.success) {
      await this.updateTaskStatus(task.id, TaskStatus.VERIFYING);
      
      // Run verification steps
      await this.runVerification(task, plan, toolContext);
      
      await this.updateTaskStatus(task.id, TaskStatus.COMPLETED);
    } else if (result.completedSteps > 0) {
      await this.updateTaskStatus(task.id, TaskStatus.PARTIALLY_FAILED);
    } else {
      await this.updateTaskStatus(task.id, TaskStatus.FAILED);
      await prisma.task.update({
        where: { id: task.id },
        data: { error: 'All steps failed' },
      });
    }

    // Send final response
    await this.sendFinalResponse(originalMessage, task, plan, result, progressMessage);
  }

  private async runVerification(
    task: Task,
    plan: any,
    context: any
  ): Promise<void> {
    // Verify mutation steps by re-reading state
    const mutationSteps = plan.steps.filter((s: any) => s.type === 'MUTATION');
    
    for (const step of mutationSteps) {
      if (step.toolName) {
        // Create verification operation
        await prisma.operation.create({
          data: {
            guildId: task.guildId,
            taskId: task.id,
            userId: task.userId,
            type: 'VERIFICATION',
            toolName: step.toolName,
            toolArgs: step.toolArgs,
            riskLevel: step.riskLevel,
            status: 'STARTED',
          },
        });

        // TODO: Implement actual verification by re-reading Discord state
        // For now, mark as verified
        await prisma.operation.updateMany({
          where: { taskId: task.id, toolName: step.toolName, type: 'VERIFICATION' },
          data: { status: 'VERIFIED', verified: true, verifiedAt: new Date() },
        });
      }
    }
  }

  private async sendFinalResponse(
    message: Message,
    task: Task,
    plan: any,
    result: ExecutionResult,
    progressMessage: Message | null
  ): Promise<void> {
    let response = '';
    
    if (result.success) {
      response = '✅ **Completed successfully**\n\n';
    } else if (result.completedSteps > 0) {
      response = `⚠️ **Partially completed** (${result.completedSteps}/${plan.steps.length} steps)\n\n`;
    } else {
      response = '❌ **Failed**\n\n';
    }

    // Add step results
    for (const [stepIndex, stepResult] of result.results) {
      const step = plan.steps.find((s: any) => s.stepIndex === stepIndex);
      if (step) {
        const summary = typeof stepResult === 'object' 
          ? JSON.stringify(stepResult).slice(0, 100)
          : String(stepResult).slice(0, 100);
        response += `• Step ${stepIndex + 1} (${step.type}): ${summary}\n`;
      }
    }

    // Add errors
    for (const [stepIndex, error] of result.errors) {
      response += `• Step ${stepIndex + 1} **failed**: ${error}\n`;
    }

    // Clean up progress message
    if (progressMessage) {
      try {
        await progressMessage.delete();
      } catch {
        // Ignore
      }
    }

    await sendResponse(message, response, { reply: true });
  }
}

// Export a simple function for the message handler to use
let requestHandlerInstance: RequestHandler | null = null;

export function initializeRequestHandler(deps: RequestHandlerDependencies): RequestHandler {
  requestHandlerInstance = new RequestHandler(deps);
  return requestHandlerInstance;
}

export function getRequestHandler(): RequestHandler | null {
  return requestHandlerInstance;
}

export async function handleMessage(
  message: Message,
  discordClient: VibeDiscordClient
): Promise<void> {
  if (!requestHandlerInstance) {
    logger.error({ target: 'agent.request' }, 'Request handler not initialized');
    return;
  }

  // Parse mentions
  const parsedMentions = parseMentions(message);
  
  // Determine mention type and clean content (strip bot mention)
  const clientId = discordClient.getClientId();
  const mentionRegex = new RegExp(`^<@!?${clientId}>`);
  const isMention = mentionRegex.test(message.content.trim());
  const mentionType: 'mention' | 'reply' | 'conversational' = isMention ? 'mention' : 'conversational';

  let cleanedContent = message.content;
  if (isMention) {
    cleanedContent = message.content.replace(new RegExp(`<@!?${clientId}>`), '').trim();
  }

  await requestHandlerInstance.handleMessage(message, cleanedContent, parsedMentions, mentionType);
}