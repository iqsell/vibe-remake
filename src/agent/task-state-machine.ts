export enum TaskStatus {
  RECEIVED = 'RECEIVED',
  INTERPRETING = 'INTERPRETING',
  AWAITING_CLARIFICATION = 'AWAITING_CLARIFICATION',
  PLANNING = 'PLANNING',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  EXECUTING = 'EXECUTING',
  VERIFYING = 'VERIFYING',
  COMPLETED = 'COMPLETED',
  PARTIALLY_FAILED = 'PARTIALLY_FAILED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum StepStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
  BLOCKED = 'BLOCKED',
  OUTCOME_UNKNOWN = 'OUTCOME_UNKNOWN',
}

export enum StepType {
  OBSERVATION = 'OBSERVATION',
  MUTATION = 'MUTATION',
  CONFIRMATION = 'CONFIRMATION',
  CLARIFICATION = 'CLARIFICATION',
  SUMMARY = 'SUMMARY',
}

export enum RiskLevel {
  NONE = 'NONE',
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum OperationType {
  READ = 'READ',
  MUTATION = 'MUTATION',
  VERIFICATION = 'VERIFICATION',
}

export enum OperationStatus {
  PLANNED = 'PLANNED',
  AUTHORIZED = 'AUTHORIZED',
  STARTED = 'STARTED',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  OUTCOME_UNKNOWN = 'OUTCOME_UNKNOWN',
  VERIFIED = 'VERIFIED',
}

// Valid state transitions for tasks
const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.RECEIVED]: [TaskStatus.INTERPRETING, TaskStatus.FAILED, TaskStatus.CANCELLED],
  [TaskStatus.INTERPRETING]: [TaskStatus.AWAITING_CLARIFICATION, TaskStatus.PLANNING, TaskStatus.FAILED, TaskStatus.CANCELLED],
  [TaskStatus.AWAITING_CLARIFICATION]: [TaskStatus.INTERPRETING, TaskStatus.PLANNING, TaskStatus.CANCELLED, TaskStatus.FAILED],
  [TaskStatus.PLANNING]: [TaskStatus.AWAITING_APPROVAL, TaskStatus.EXECUTING, TaskStatus.FAILED, TaskStatus.CANCELLED],
  [TaskStatus.AWAITING_APPROVAL]: [TaskStatus.EXECUTING, TaskStatus.CANCELLED, TaskStatus.FAILED],
  [TaskStatus.EXECUTING]: [TaskStatus.VERIFYING, TaskStatus.PARTIALLY_FAILED, TaskStatus.FAILED, TaskStatus.CANCELLED],
  [TaskStatus.VERIFYING]: [TaskStatus.COMPLETED, TaskStatus.PARTIALLY_FAILED, TaskStatus.FAILED],
  [TaskStatus.COMPLETED]: [],
  [TaskStatus.PARTIALLY_FAILED]: [TaskStatus.COMPLETED], // Can be resolved
  [TaskStatus.FAILED]: [TaskStatus.CANCELLED],
  [TaskStatus.CANCELLED]: [],
};

// Valid state transitions for steps
const STEP_TRANSITIONS: Record<StepStatus, StepStatus[]> = {
  [StepStatus.PENDING]: [StepStatus.RUNNING, StepStatus.SKIPPED, StepStatus.BLOCKED],
  [StepStatus.RUNNING]: [StepStatus.COMPLETED, StepStatus.FAILED, StepStatus.OUTCOME_UNKNOWN],
  [StepStatus.COMPLETED]: [],
  [StepStatus.FAILED]: [],
  [StepStatus.SKIPPED]: [],
  [StepStatus.BLOCKED]: [StepStatus.PENDING, StepStatus.FAILED, StepStatus.SKIPPED],
  [StepStatus.OUTCOME_UNKNOWN]: [StepStatus.COMPLETED, StepStatus.FAILED],
};

// Valid state transitions for operations
const OPERATION_TRANSITIONS: Record<OperationStatus, OperationStatus[]> = {
  [OperationStatus.PLANNED]: [OperationStatus.AUTHORIZED, OperationStatus.FAILED],
  [OperationStatus.AUTHORIZED]: [OperationStatus.STARTED, OperationStatus.FAILED],
  [OperationStatus.STARTED]: [OperationStatus.SUCCEEDED, OperationStatus.FAILED, OperationStatus.OUTCOME_UNKNOWN],
  [OperationStatus.SUCCEEDED]: [OperationStatus.VERIFIED],
  [OperationStatus.FAILED]: [],
  [OperationStatus.OUTCOME_UNKNOWN]: [OperationStatus.VERIFIED, OperationStatus.FAILED],
  [OperationStatus.VERIFIED]: [],
};

export class TaskStateMachine {
  static canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
    return TASK_TRANSITIONS[from]?.includes(to) ?? false;
  }

  static canTransitionStep(from: StepStatus, to: StepStatus): boolean {
    return STEP_TRANSITIONS[from]?.includes(to) ?? false;
  }

  static canTransitionOperation(from: OperationStatus, to: OperationStatus): boolean {
    return OPERATION_TRANSITIONS[from]?.includes(to) ?? false;
  }

  static getValidTaskTransitions(from: TaskStatus): TaskStatus[] {
    return TASK_TRANSITIONS[from] ?? [];
  }

  static getValidStepTransitions(from: StepStatus): StepStatus[] {
    return STEP_TRANSITIONS[from] ?? [];
  }

  static getValidOperationTransitions(from: OperationStatus): OperationStatus[] {
    return OPERATION_TRANSITIONS[from] ?? [];
  }

  static isTerminalTaskStatus(status: TaskStatus): boolean {
    return [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED].includes(status);
  }

  static isTerminalStepStatus(status: StepStatus): boolean {
    return [StepStatus.COMPLETED, StepStatus.FAILED, StepStatus.SKIPPED].includes(status);
  }

  static isTerminalOperationStatus(status: OperationStatus): boolean {
    return [OperationStatus.SUCCEEDED, OperationStatus.FAILED, OperationStatus.VERIFIED].includes(status);
  }

  static isActiveTaskStatus(status: TaskStatus): boolean {
    return !this.isTerminalTaskStatus(status);
  }
}

export interface TaskStep {
  id: string;
  taskId: string;
  stepIndex: number;
  type: StepType;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  description: string;
  expectedOutput?: string;
  riskLevel: RiskLevel;
  readOnly: boolean;
  dependsOn: number[];
  status: StepStatus;
  result?: Record<string, unknown>;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  retryCount: number;
  verified: boolean;
  verificationResult?: Record<string, unknown>;
  verifiedAt?: Date;
}

export interface Operation {
  id: string;
  guildId: string;
  taskId?: string;
  stepId?: string;
  userId: string;
  type: OperationType;
  toolName: string;
  toolArgs: Record<string, unknown>;
  targetType?: string;
  targetId?: string;
  authorized: boolean;
  authorizedBy?: string;
  authorizationId?: string;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  confirmationId?: string;
  confirmedBy?: string;
  confirmedAt?: Date;
  confirmationExpires?: Date;
  status: OperationStatus;
  idempotencyKey?: string;
  discordResponse?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  errorClass?: string;
  retryable: boolean;
  verified: boolean;
  verificationResult?: Record<string, unknown>;
  verifiedAt?: Date;
  verificationError?: string;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Task {
  id: string;
  guildId: string;
  channelId: string;
  userId: string;
  messageId?: string;
  threadId?: string;
  status: TaskStatus;
  currentStep: number;
  maxSteps: number;
  maxModelCalls: number;
  modelCallsUsed: number;
  rawInput: string;
  sanitizedInput: string;
  contextSnapshot?: Record<string, unknown>;
  plan?: Plan;
  planVersion: number;
  requiresApproval: boolean;
  approvalId?: string;
  approvalExpires?: Date;
  approvedBy?: string;
  approvedAt?: Date;
  error?: string;
  errorStep?: number;
  retryCount: number;
  maxRetries: number;
  startedAt?: Date;
  completedAt?: Date;
  deadline?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Plan {
  id: string;
  taskId: string;
  version: number;
  steps: PlanStep[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanStep {
  id: string;
  planId: string;
  stepIndex: number;
  type: StepType;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  description: string;
  expectedOutput?: string;
  riskLevel: RiskLevel;
  readOnly: boolean;
  dependsOn: number[];
  status: StepStatus;
}