import { ChatResponse, ToolCall, ChatMessage, ToolDefinition } from '../types.js';

export interface NormalizedResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: ChatResponse['finishReason'];
  usage?: ChatResponse['usage'];
}

export function normalizeFinishReason(reason: string): ChatResponse['finishReason'] {
  const normalized = reason.toLowerCase();
  
  if (normalized.includes('stop') || normalized === 'end_turn' || normalized === 'completed') {
    return 'stop';
  }
  if (normalized.includes('length') || normalized === 'max_tokens') {
    return 'length';
  }
  if (normalized.includes('tool') || normalized === 'tool_calls' || normalized === 'function_call') {
    return 'tool_calls';
  }
  if (normalized.includes('content') || normalized.includes('filter') || normalized.includes('safety')) {
    return 'content_filter';
  }
  if (normalized.includes('error') || normalized === 'failed') {
    return 'error';
  }
  
  return 'unknown';
}

export function normalizeToolCalls(toolCalls: unknown[]): ToolCall[] {
  if (!Array.isArray(toolCalls)) return [];
  
  return toolCalls
    .filter(tc => tc && typeof tc === 'object')
    .map((tc, index) => {
      const typed = tc as Record<string, unknown>;
      const fn = (typed.function ?? {}) as Record<string, unknown>;
      return {
        id: typeof typed.id === 'string' ? typed.id : `call_${index}_${Date.now()}`,
        type: 'function' as const,
        function: {
          name: typeof fn.name === 'string' ? fn.name : '',
          arguments: typeof fn.arguments === 'string' 
            ? fn.arguments 
            : JSON.stringify(fn.arguments ?? {}),
        },
      };
    })
    .filter(tc => tc.function.name);
}

export function normalizeUsage(usage: unknown): ChatResponse['usage'] {
  if (!usage || typeof usage !== 'object') return undefined;
  
  const typed = usage as Record<string, unknown>;
  const promptTokens = typeof typed.prompt_tokens === 'number' ? typed.prompt_tokens :
                       typeof typed.input_tokens === 'number' ? typed.input_tokens : 0;
  const completionTokens = typeof typed.completion_tokens === 'number' ? typed.completion_tokens :
                           typeof typed.output_tokens === 'number' ? typed.output_tokens : 0;
  const totalTokens = typeof typed.total_tokens === 'number' ? typed.total_tokens :
                      promptTokens + completionTokens;
  
  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

export function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content ?? '',
    toolCalls: msg.toolCalls,
    toolCallId: msg.toolCallId,
    name: msg.name,
  }));
}

export function normalizeToolDefinitions(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

export function createToolCall(
  id: string, 
  name: string, 
  args: Record<string, unknown>
): ToolCall {
  return {
    id,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}