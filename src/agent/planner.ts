import { z } from 'zod';
import { ProviderRouter } from '../ai/router.js';
import { ToolRegistry } from '../tools/registry.js';
import { logger, createTaskLogger } from '../observability/logger.js';
import { IntentType, IntentResult } from './intent.js';
import { 
  Task, 
  Plan, 
  PlanStep, 
  StepType, 
  StepStatus, 
  RiskLevel,
  TaskStatus 
} from './task-state-machine.js';

const PLANNING_PROMPT = `You are a planner for a Discord staff bot. Create a structured plan to fulfill the user's request.

Available tools: {{TOOLS}}

Intent: {{INTENT}}
Entities: {{ENTITIES}}
User message: "{{MESSAGE}}"

Context:
- Guild: {{GUILD_ID}}
- User is staff: {{IS_STAFF}}
- User is admin: {{IS_ADMIN}}
- Mention type: {{MENTION_TYPE}}

Create a plan with steps. Each step must have:
- stepIndex: number (0-based)
- type: "OBSERVATION" | "MUTATION" | "CONFIRMATION" | "CLARIFICATION" | "SUMMARY"
- toolName: string (must match available tool exactly)
- toolArgs: object (validated against tool schema)
- description: string
- expectedOutput: string
- riskLevel: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
- readOnly: boolean
- dependsOn: number[] (step indices this step depends on)

Rules:
1. Separate observation steps from mutation steps
2. Never mutate while merely previewing
3. Each step must state what evidence/data it needs and what success looks like
4. Validate every proposed tool exists and arguments match schema
5. Reject dependency cycles
6. Max {{MAX_STEPS}} steps
7. If clarification needed, add CLARIFICATION step first
8. If confirmation needed for mutations, add CONFIRMATION step before mutations
9. End with SUMMARY step

Return JSON only with: steps[], requiresApproval, approvalReason, estimatedDurationMs`;

export interface PlanningResult {
  plan: Plan;
  requiresApproval: boolean;
  approvalReason?: string;
  clarificationNeeded: boolean;
  clarificationQuestions: string[];
}

export class Planner {
  private router: ProviderRouter;
  private toolRegistry: ToolRegistry;

  constructor(router: ProviderRouter, toolRegistry: ToolRegistry) {
    this.router = router;
    this.toolRegistry = toolRegistry;
  }

  async createPlan(
    task: Task,
    intentResult: IntentResult,
    context: any
  ): Promise<PlanningResult> {
    const taskLogger = createTaskLogger(task.id);

    try {
      const tools = this.toolRegistry.getAll();
      const toolDefinitions = tools.map(t => ({
        name: t.name,
        description: t.description,
        readOnly: t.readOnly,
        riskLevel: t.riskLevel,
        inputSchema: t.inputSchema,
      }));

      const prompt = PLANNING_PROMPT
        .replace('{{TOOLS}}', JSON.stringify(toolDefinitions, null, 2))
        .replace('{{INTENT}}', intentResult.primaryIntent)
        .replace('{{ENTITIES}}', JSON.stringify(intentResult.entities))
        .replace('{{MESSAGE}}', task.sanitizedInput)
        .replace('{{GUILD_ID}}', task.guildId)
        .replace('{{IS_STAFF}}', String(context.userContext?.isStaff ?? false))
        .replace('{{IS_ADMIN}}', String(context.userContext?.isAdmin ?? false))
        .replace('{{MENTION_TYPE}}', context?.mentionType ?? 'mention')
        .replace('{{MAX_STEPS}}', String(task.maxSteps));

      const response = await this.router.generate({
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: 'Create the plan.' },
        ],
        temperature: 0.2,
        maxTokens: 2000,
        responseFormat: { type: 'json_object' },
      }, {
        taskType: 'planning',
        requiredCapabilities: ['structuredOutput'],
      });

      const result = JSON.parse(response.content ?? '{}');
      return this.validateAndNormalizePlan(result, intentResult, task);
    } catch (error) {
      taskLogger.error({ err: error, target: 'agent.planner' }, 'Planning failed');
      return this.getFallbackPlan(intentResult, task);
    }
  }

  private validateAndNormalizePlan(
    result: any,
    intentResult: IntentResult,
    task: Task
  ): PlanningResult {
    const steps: PlanStep[] = [];
    const seenIndices = new Set<number>();

    if (!Array.isArray(result.steps)) {
      throw new Error('Invalid plan: steps array missing');
    }

    for (const step of result.steps) {
      // Validate step structure
      if (typeof step.stepIndex !== 'number' || step.stepIndex < 0) {
        throw new Error(`Invalid stepIndex: ${step.stepIndex}`);
      }
      if (seenIndices.has(step.stepIndex)) {
        throw new Error(`Duplicate stepIndex: ${step.stepIndex}`);
      }
      seenIndices.add(step.stepIndex);

      // Validate tool exists
      if (step.toolName) {
        const tool = this.toolRegistry.get(step.toolName);
        if (!tool) {
          throw new Error(`Unknown tool: ${step.toolName}`);
        }

        // Validate arguments against schema
        const validation = this.toolRegistry.validateInput(step.toolName, step.toolArgs ?? {});
        if (!validation.success) {
          throw new Error(`Invalid args for ${step.toolName}: ${validation.error?.message}`);
        }
        step.toolArgs = validation.data;
      }

      // Validate type
      if (!Object.values(StepType).includes(step.type)) {
        throw new Error(`Invalid step type: ${step.type}`);
      }

      // Validate risk level
      if (!Object.values(RiskLevel).includes(step.riskLevel)) {
        step.riskLevel = RiskLevel.LOW;
      }

      // Validate dependencies
      if (!Array.isArray(step.dependsOn)) {
        step.dependsOn = [];
      }
      for (const dep of step.dependsOn) {
        if (!seenIndices.has(dep) && dep !== step.stepIndex) {
          // Allow forward references but warn
        }
      }

      steps.push({
        id: `step_${step.stepIndex}_${Date.now()}`,
        planId: '', // Will be set when plan is saved
        stepIndex: step.stepIndex,
        type: step.type,
        toolName: step.toolName,
        toolArgs: step.toolArgs,
        description: step.description ?? '',
        expectedOutput: step.expectedOutput,
        riskLevel: step.riskLevel,
        readOnly: step.readOnly ?? false,
        dependsOn: step.dependsOn,
        status: StepStatus.PENDING,
      });
    }

    // Sort by stepIndex
    steps.sort((a, b) => a.stepIndex - b.stepIndex);

    // Check for cycles
    if (this.hasCycles(steps)) {
      throw new Error('Plan contains dependency cycles');
    }

    // Check if any mutation steps exist
    const hasMutations = steps.some(s => s.type === StepType.MUTATION);
    const requiresApproval = hasMutations && (result.requiresApproval ?? true);
    const approvalReason = result.approvalReason ?? 'Plan contains mutating actions';

    // Check if clarification steps are needed
    const clarificationSteps = steps.filter(s => s.type === StepType.CLARIFICATION);
    const clarificationNeeded = clarificationSteps.length > 0 || intentResult.requiresClarification;
    const clarificationQuestions = [
      ...(result.clarificationQuestions ?? []),
      ...clarificationSteps.map(s => s.description),
    ];

    return {
      plan: {
        id: `plan_${task.id}_${Date.now()}`,
        taskId: task.id,
        version: task.planVersion + 1,
        steps,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      requiresApproval,
      approvalReason,
      clarificationNeeded,
      clarificationQuestions: [...new Set(clarificationQuestions)].slice(0, 5),
    };
  }

  private hasCycles(steps: PlanStep[]): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const stepMap = new Map(steps.map(s => [s.stepIndex, s]));

    function dfs(index: number): boolean {
      const key = String(index);
      if (recStack.has(key)) return true;
      if (visited.has(key)) return false;

      visited.add(key);
      recStack.add(key);

      const step = stepMap.get(index);
      if (step) {
        for (const dep of step.dependsOn) {
          if (dfs(dep)) return true;
        }
      }

      recStack.delete(key);
      return false;
    }

    for (const step of steps) {
      if (dfs(step.stepIndex)) return true;
    }
    return false;
  }

  private getFallbackPlan(intentResult: IntentResult, task: Task): PlanningResult {
    // Simple fallback: single step using suggested tool
    const toolName = intentResult.suggestedTools[0];
    
    if (!toolName) {
      return {
        plan: {
          id: `plan_${task.id}_${Date.now()}`,
          taskId: task.id,
          version: 1,
          steps: [{
            id: `step_0_${Date.now()}`,
            planId: '',
            stepIndex: 0,
            type: StepType.SUMMARY,
            description: 'Unable to create plan - please clarify your request',
            riskLevel: RiskLevel.NONE,
            readOnly: true,
            dependsOn: [],
            status: StepStatus.PENDING,
          }],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        requiresApproval: false,
        clarificationNeeded: true,
        clarificationQuestions: ['Could you clarify what you\'d like me to do?'],
      };
    }

    const tool = this.toolRegistry.get(toolName);
    const isMutation = tool ? !tool.readOnly : false;

    return {
      plan: {
        id: `plan_${task.id}_${Date.now()}`,
        taskId: task.id,
        version: 1,
        steps: [
          {
            id: `step_0_${Date.now()}`,
            planId: '',
            stepIndex: 0,
            type: isMutation ? StepType.CONFIRMATION : StepType.OBSERVATION,
            toolName: isMutation ? undefined : toolName,
            toolArgs: isMutation ? undefined : intentResult.entities,
            description: isMutation 
              ? `Confirm you want to ${tool?.description.toLowerCase()}` 
              : `Execute ${tool?.description.toLowerCase()}`,
            expectedOutput: isMutation ? 'User confirmation' : 'Tool result',
            riskLevel: isMutation ? RiskLevel.MEDIUM : RiskLevel.LOW,
            readOnly: !isMutation,
            dependsOn: [],
            status: StepStatus.PENDING,
          },
          ...(isMutation ? [{
            id: `step_1_${Date.now()}`,
            planId: '',
            stepIndex: 1,
            type: StepType.MUTATION,
            toolName,
            toolArgs: intentResult.entities,
            description: `Execute ${tool?.description.toLowerCase()}`,
            expectedOutput: 'Mutation result',
            riskLevel: RiskLevel.MEDIUM,
            readOnly: false,
            dependsOn: [0],
            status: StepStatus.PENDING,
          }] : []),
          {
            id: `step_${isMutation ? 2 : 1}_${Date.now()}`,
            planId: '',
            stepIndex: isMutation ? 2 : 1,
            type: StepType.SUMMARY,
            description: 'Summarize results for user',
            expectedOutput: 'User-facing summary',
            riskLevel: RiskLevel.NONE,
            readOnly: true,
            dependsOn: isMutation ? [1] : [0],
            status: StepStatus.PENDING,
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      requiresApproval: isMutation,
      approvalReason: isMutation ? 'Plan contains mutating actions' : undefined,
      clarificationNeeded: intentResult.requiresClarification,
      clarificationQuestions: intentResult.clarificationQuestions,
    };
  }
}