import type {TodoItem, TodoState} from '../types/transcript';
import type {BaseToolExecutionResult, ToolCall, ToolHandler} from '../types/tool';

const CREATE_TODOS_TOOL_NAME = 'create_todos';
const COMPLETE_TODO_TOOL_NAME = 'complete_todo';
const MAX_TODO_ITEMS = 20;

type TodoToolExecutionResult = BaseToolExecutionResult & {
  toolName: typeof CREATE_TODOS_TOOL_NAME | typeof COMPLETE_TODO_TOOL_NAME;
};

type TodoToolStateUpdateResult =
  | {ok: true; result: TodoToolExecutionResult; todoState: TodoState}
  | {ok: false; result: TodoToolExecutionResult};

/**
 * 创建 todo 状态工具定义；真实状态更新由 agent loop 在执行器之前完成。
 */
function createTodoToolHandlers(): ToolHandler[] {
  return [
    {
      definition: {
        name: CREATE_TODOS_TOOL_NAME,
        description: 'Create or replace the current session todo list. Use this for multi-step work that should remain visible until completed.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              minItems: 0,
              maxItems: MAX_TODO_ITEMS,
              items: {
                type: 'string'
              }
            }
          }
        }
      },
      execute(_args: Record<string, unknown>, call: ToolCall): TodoToolExecutionResult {
        return createTodoFailureResult(call, 'create_todos must be handled by the agent loop todo state runtime');
      }
    },
    {
      definition: {
        name: COMPLETE_TODO_TOOL_NAME,
        description: 'Mark one or more current session todo items as completed by id.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['ids'],
          properties: {
            ids: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_TODO_ITEMS,
              items: {
                type: 'string'
              }
            }
          }
        }
      },
      execute(_args: Record<string, unknown>, call: ToolCall): TodoToolExecutionResult {
        return createTodoFailureResult(call, 'complete_todo must be handled by the agent loop todo state runtime');
      }
    }
  ];
}

/**
 * 判断工具名是否属于会话 todo 状态工具。
 */
function isTodoToolName(toolName: string): toolName is typeof CREATE_TODOS_TOOL_NAME | typeof COMPLETE_TODO_TOOL_NAME {
  return toolName === CREATE_TODOS_TOOL_NAME || toolName === COMPLETE_TODO_TOOL_NAME;
}

/**
 * 解析并执行 todo 状态变更，返回可直接写入 transcript 的 tool result。
 */
function executeTodoToolCall(call: ToolCall, currentState: TodoState | undefined, now = new Date().toISOString()): TodoToolStateUpdateResult {
  const parsed = parseJsonObject(call.argumentsText);

  if (!parsed.ok) {
    return {ok: false, result: createTodoFailureResult(call, parsed.message)};
  }

  if (call.toolName === CREATE_TODOS_TOOL_NAME) {
    return executeCreateTodos(call, parsed.value, now);
  }

  if (call.toolName === COMPLETE_TODO_TOOL_NAME) {
    return executeCompleteTodo(call, parsed.value, currentState, now);
  }

  return {ok: false, result: createTodoFailureResult(call, `Unknown todo tool: ${call.toolName}`)};
}

function executeCreateTodos(call: ToolCall, args: Record<string, unknown>, now: string): TodoToolStateUpdateResult {
  const items = parseTodoTexts(args.items);

  if (!items.ok) {
    return {ok: false, result: createTodoFailureResult(call, items.message)};
  }

  const todoState: TodoState = {
    updatedAt: now,
    items: items.value.map((text, index): TodoItem => ({
      id: `todo_${index + 1}`,
      text,
      status: 'open'
    }))
  };

  return {
    ok: true,
    todoState,
    result: createTodoSuccessResult(call, {
      action: 'create_todos',
      createdIds: todoState.items.map((item) => item.id),
      items: todoState.items,
      openTodos: getOpenTodos(todoState)
    })
  };
}

function executeCompleteTodo(call: ToolCall, args: Record<string, unknown>, currentState: TodoState | undefined, now: string): TodoToolStateUpdateResult {
  const ids = parseTodoIds(args.ids);

  if (!ids.ok) {
    return {ok: false, result: createTodoFailureResult(call, ids.message)};
  }

  const existingState = normalizeTodoState(currentState);
  const idSet = new Set(ids.value);
  const completedIds: string[] = [];
  const items = existingState.items.map((item): TodoItem => {
    if (!idSet.has(item.id)) {
      return item;
    }

    completedIds.push(item.id);
    return {...item, status: 'completed'};
  });
  const knownIds = new Set(existingState.items.map((item) => item.id));
  const notFoundIds = ids.value.filter((id) => !knownIds.has(id));
  const todoState: TodoState = {
    updatedAt: completedIds.length > 0 ? now : existingState.updatedAt,
    items
  };

  return {
    ok: true,
    todoState,
    result: createTodoSuccessResult(call, {
      action: 'complete_todo',
      completedIds,
      notFoundIds,
      items: todoState.items,
      openTodos: getOpenTodos(todoState)
    })
  };
}

function parseTodoTexts(value: unknown): {ok: true; value: string[]} | {ok: false; message: string} {
  if (!Array.isArray(value)) {
    return {ok: false, message: 'items must be an array'};
  }

  if (value.length > MAX_TODO_ITEMS) {
    return {ok: false, message: `items must contain at most ${MAX_TODO_ITEMS} entries`};
  }

  const items: string[] = [];

  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string') {
      return {ok: false, message: `items[${index}] must be a string`};
    }

    const text = item.trim();

    if (text === '') {
      return {ok: false, message: `items[${index}] must not be empty`};
    }

    items.push(text);
  }

  return {ok: true, value: items};
}

function parseTodoIds(value: unknown): {ok: true; value: string[]} | {ok: false; message: string} {
  if (!Array.isArray(value) || value.length === 0) {
    return {ok: false, message: 'ids must be a non-empty array'};
  }

  if (value.length > MAX_TODO_ITEMS) {
    return {ok: false, message: `ids must contain at most ${MAX_TODO_ITEMS} entries`};
  }

  const ids: string[] = [];

  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || item.trim() === '') {
      return {ok: false, message: `ids[${index}] must be a non-empty string`};
    }

    ids.push(item.trim());
  }

  return {ok: true, value: Array.from(new Set(ids))};
}

function parseJsonObject(text: string): {ok: true; value: Record<string, unknown>} | {ok: false; message: string} {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return {ok: false, message: 'todo tool arguments are not valid JSON'};
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {ok: false, message: 'todo tool arguments must be a JSON object'};
  }

  return {ok: true, value: parsed as Record<string, unknown>};
}

function createTodoSuccessResult(call: ToolCall, payload: Record<string, unknown>): TodoToolExecutionResult {
  return {
    callId: call.callId,
    toolName: call.toolName as typeof CREATE_TODOS_TOOL_NAME | typeof COMPLETE_TODO_TOOL_NAME,
    ok: true,
    text: JSON.stringify(payload)
  };
}

function createTodoFailureResult(call: ToolCall, message: string): TodoToolExecutionResult {
  return {
    callId: call.callId,
    toolName: call.toolName as typeof CREATE_TODOS_TOOL_NAME | typeof COMPLETE_TODO_TOOL_NAME,
    ok: false,
    text: message
  };
}

function normalizeTodoState(todoState: TodoState | undefined): TodoState {
  return {
    updatedAt: todoState?.updatedAt || '',
    items: (todoState?.items || []).filter((item) => item.status === 'open' || item.status === 'completed')
  };
}

function getOpenTodos(todoState: TodoState): TodoItem[] {
  return todoState.items.filter((item) => item.status === 'open');
}

export {
  COMPLETE_TODO_TOOL_NAME,
  CREATE_TODOS_TOOL_NAME,
  createTodoToolHandlers,
  executeTodoToolCall,
  isTodoToolName
};

export type {
  TodoToolExecutionResult,
  TodoToolStateUpdateResult
};
