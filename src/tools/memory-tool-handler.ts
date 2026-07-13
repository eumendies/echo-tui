import {addAgentMemory, readAgentMemoryCatalog, removeAgentMemoryCatalog, removeAgentMemoryItem, updateAgentMemoryCatalog, updateAgentMemoryItem} from '../memory/agent-memory-store';
import {createUserMemory, deleteUserMemory, readUserMemories, updateUserMemory} from '../memory/memory-store';

import type {AgentMemoryScope} from '../types/memory';
import type {BaseToolExecutionResult, ToolCall, ToolHandler} from '../types/tool';

const READ_MEMORY_TOOL_NAME = 'read_memory';
const ADD_MEMORY_TOOL_NAME = 'add_memory';
const UPDATE_MEMORY_TOOL_NAME = 'update_memory';
const REMOVE_MEMORY_TOOL_NAME = 'remove_memory';
const MEMORY_MUTATION_TOOL_NAMES = new Set([ADD_MEMORY_TOOL_NAME, UPDATE_MEMORY_TOOL_NAME, REMOVE_MEMORY_TOOL_NAME]);

/** 创建 user 与 agent memory 共用的四个工具，并在执行时读取当前 cwd。 */
function createMemoryToolHandlers(cwd: string | (() => string) = process.cwd): ToolHandler[] {
  const getCwd = typeof cwd === 'function' ? cwd : () => cwd;

  return [
    createHandler(
      READ_MEMORY_TOOL_NAME,
      'Read user memories or one relevant agent memory catalog. The agent catalog index is already present in the system prompt; avoid rereading a catalog already loaded in this conversation.',
      ['type'],
      {type: enumProperty(['user', 'agent']), catalog: stringProperty(), scope: enumProperty(['global', 'project'])},
      (args, call) => executeRead(args, call, getCwd())
    ),
    createHandler(
      ADD_MEMORY_TOOL_NAME,
      'Persist a stable memory. Use type user for explicit user preferences/facts, or type agent for reusable agent knowledge. Agent catalogs are created automatically when missing. Do not store credentials or transient task state.',
      ['type', 'content'],
      {type: enumProperty(['user', 'agent']), content: stringProperty(), catalog: stringProperty(), catalogDescription: stringProperty(), scope: enumProperty(['global', 'project'])},
      (args, call) => executeAdd(args, call, getCwd())
    ),
    createHandler(
      UPDATE_MEMORY_TOOL_NAME,
      'Update a user memory item, agent catalog metadata, or agent memory item.',
      ['type', 'target'],
      {type: enumProperty(['user', 'agent']), target: enumProperty(['catalog', 'item']), itemId: stringProperty(), catalog: stringProperty(), scope: enumProperty(['global', 'project']), content: stringProperty(), name: stringProperty(), description: stringProperty()},
      (args, call) => executeUpdate(args, call, getCwd())
    ),
    createHandler(
      REMOVE_MEMORY_TOOL_NAME,
      'Remove a user memory item, agent catalog, or agent memory item. Removing the final agent item also removes its empty catalog.',
      ['type', 'target'],
      {type: enumProperty(['user', 'agent']), target: enumProperty(['catalog', 'item']), itemId: stringProperty(), catalog: stringProperty(), scope: enumProperty(['global', 'project'])},
      (args, call) => executeRemove(args, call, getCwd())
    )
  ];
}

function createHandler(name: string, description: string, required: string[], properties: Record<string, unknown>, execute: (args: Record<string, unknown>, call: ToolCall) => BaseToolExecutionResult): ToolHandler {
  return {
    definition: {
      name,
      description,
      parameters: {type: 'object', additionalProperties: false, required, properties}
    },
    execute
  };
}

function executeRead(args: Record<string, unknown>, call: ToolCall, cwd: string): BaseToolExecutionResult {
  const type = parseType(args.type);

  if (!type.ok) {
    return failure(call, type.error);
  }

  if (type.value === 'user') {
    const result = readUserMemories();
    return result.ok
      ? success(call, JSON.stringify({type: 'user', memories: result.memories}, null, 2))
      : failure(call, result.error);
  }

  const catalog = requiredString(args.catalog, 'catalog must be a non-empty string for agent memory');
  const scope = parseScope(args.scope);

  if (!catalog.ok) {
    return failure(call, catalog.error);
  }

  if (!scope.ok) {
    return failure(call, scope.error);
  }

  const result = readAgentMemoryCatalog(cwd, catalog.value, scope.value);
  return result.ok
    ? success(call, JSON.stringify({
      type: 'agent',
      catalog: {name: result.catalog.name, description: result.catalog.description},
      memories: result.memories
    }, null, 2))
    : failure(call, result.error);
}

function executeAdd(args: Record<string, unknown>, call: ToolCall, cwd: string): BaseToolExecutionResult {
  const type = parseType(args.type);
  const content = requiredString(args.content, 'content must be a non-empty string');

  if (!type.ok) {
    return failure(call, type.error);
  }

  if (!content.ok) {
    return failure(call, content.error);
  }

  if (type.value === 'user') {
    const result = createUserMemory(content.value);
    return result.ok
      ? success(call, JSON.stringify({type: 'user', memory: result.memories.at(-1)}, null, 2))
      : failure(call, result.error);
  }

  const catalog = requiredString(args.catalog, 'catalog must be a non-empty string for agent memory');
  const description = optionalString(args.catalogDescription, 'catalogDescription must be a string');
  const scope = parseScope(args.scope);

  if (!catalog.ok) {
    return failure(call, catalog.error);
  }

  if (!description.ok) {
    return failure(call, description.error);
  }

  if (!scope.ok) {
    return failure(call, scope.error);
  }

  const result = addAgentMemory(cwd, {
    catalog: catalog.value,
    content: content.value,
    ...(description.value ? {description: description.value} : {}),
    ...(scope.value ? {scope: scope.value} : {})
  });
  return result.ok
    ? success(call, JSON.stringify({type: 'agent', catalog: result.catalog, memory: result.memories?.at(-1)}, null, 2))
    : failure(call, result.error);
}

function executeUpdate(args: Record<string, unknown>, call: ToolCall, cwd: string): BaseToolExecutionResult {
  const type = parseType(args.type);
  const target = parseTarget(args.target);

  if (!type.ok) {
    return failure(call, type.error);
  }

  if (!target.ok) {
    return failure(call, target.error);
  }

  if (type.value === 'user') {
    if (target.value !== 'item') {
      return failure(call, 'user memory target must be item');
    }

    return updateUserMemoryFromTool(args, call);
  }

  return updateAgentMemoryFromTool(args, call, cwd, target.value);
}

function updateUserMemoryFromTool(args: Record<string, unknown>, call: ToolCall): BaseToolExecutionResult {
  const id = requiredString(args.itemId, 'itemId must be a non-empty string');
  const content = requiredString(args.content, 'content must be a non-empty string');

  if (!id.ok) {
    return failure(call, id.error);
  }

  if (!content.ok) {
    return failure(call, content.error);
  }

  const result = updateUserMemory(id.value, content.value);
  return result.ok
    ? success(call, JSON.stringify({type: 'user', memory: result.memories.find((item) => item.id === id.value)}, null, 2))
    : failure(call, result.error);
}

/** agent catalog 与 item 的更新共享 catalog/scope 解析，目标字段决定后续存储调用。 */
function updateAgentMemoryFromTool(args: Record<string, unknown>, call: ToolCall, cwd: string, target: 'catalog' | 'item'): BaseToolExecutionResult {
  const catalog = requiredString(args.catalog, 'catalog must be a non-empty string');
  const scope = parseScope(args.scope);

  if (!catalog.ok) {
    return failure(call, catalog.error);
  }

  if (!scope.ok) {
    return failure(call, scope.error);
  }

  if (target === 'catalog') {
    return updateAgentCatalogFromTool(args, call, cwd, catalog.value, scope.value);
  }

  const id = requiredString(args.itemId, 'itemId must be a non-empty string');
  const content = requiredString(args.content, 'content must be a non-empty string');

  if (!id.ok) {
    return failure(call, id.error);
  }

  if (!content.ok) {
    return failure(call, content.error);
  }

  const result = updateAgentMemoryItem(cwd, catalog.value, id.value, content.value, scope.value);
  return result.ok
    ? success(call, JSON.stringify({type: 'agent', catalog: result.catalog, memory: result.memories?.find((item) => item.id === id.value)}, null, 2))
    : failure(call, result.error);
}

function updateAgentCatalogFromTool(args: Record<string, unknown>, call: ToolCall, cwd: string, catalog: string, scope?: AgentMemoryScope['kind']): BaseToolExecutionResult {
  const name = optionalString(args.name, 'name must be a string');
  const description = optionalString(args.description, 'description must be a string');

  if (!name.ok) {
    return failure(call, name.error);
  }

  if (!description.ok) {
    return failure(call, description.error);
  }

  if (!name.value && !description.value) {
    return failure(call, 'name or description is required');
  }

  const result = updateAgentMemoryCatalog(cwd, catalog, {
    ...(name.value ? {name: name.value} : {}),
    ...(description.value ? {description: description.value} : {})
  }, scope);
  return result.ok
    ? success(call, JSON.stringify({type: 'agent', catalog: result.catalog}, null, 2))
    : failure(call, result.error);
}

function executeRemove(args: Record<string, unknown>, call: ToolCall, cwd: string): BaseToolExecutionResult {
  const type = parseType(args.type);
  const target = parseTarget(args.target);

  if (!type.ok) {
    return failure(call, type.error);
  }

  if (!target.ok) {
    return failure(call, target.error);
  }

  if (type.value === 'user') {
    if (target.value !== 'item') {
      return failure(call, 'user memory target must be item');
    }

    const id = requiredString(args.itemId, 'itemId must be a non-empty string');
    if (!id.ok) {
      return failure(call, id.error);
    }

    const result = deleteUserMemory(id.value);
    return result.ok
      ? success(call, JSON.stringify({type: 'user', removedItemId: id.value}, null, 2))
      : failure(call, result.error);
  }

  const catalog = requiredString(args.catalog, 'catalog must be a non-empty string');
  const scope = parseScope(args.scope);

  if (!catalog.ok) {
    return failure(call, catalog.error);
  }

  if (!scope.ok) {
    return failure(call, scope.error);
  }

  if (target.value === 'catalog') {
    const result = removeAgentMemoryCatalog(cwd, catalog.value, scope.value);
    return result.ok
      ? success(call, JSON.stringify({type: 'agent', removedCatalog: catalog.value}, null, 2))
      : failure(call, result.error);
  }

  const id = requiredString(args.itemId, 'itemId must be a non-empty string');
  if (!id.ok) {
    return failure(call, id.error);
  }

  const result = removeAgentMemoryItem(cwd, catalog.value, id.value, scope.value);
  return result.ok
    ? success(call, JSON.stringify({type: 'agent', removedItemId: id.value, removedCatalog: result.removedCatalog || false}, null, 2))
    : failure(call, result.error);
}

function parseType(value: unknown): {ok: true; value: 'user' | 'agent'} | {ok: false; error: string} {
  return value === 'user' || value === 'agent'
    ? {ok: true, value}
    : {ok: false, error: 'type must be user or agent'};
}

function parseTarget(value: unknown): {ok: true; value: 'catalog' | 'item'} | {ok: false; error: string} {
  return value === 'catalog' || value === 'item'
    ? {ok: true, value}
    : {ok: false, error: 'target must be catalog or item'};
}

function parseScope(value: unknown): {ok: true; value?: AgentMemoryScope['kind']} | {ok: false; error: string} {
  if (value === undefined) {
    return {ok: true};
  }

  return value === 'global' || value === 'project'
    ? {ok: true, value}
    : {ok: false, error: 'scope must be global or project'};
}

function requiredString(value: unknown, error: string): {ok: true; value: string} | {ok: false; error: string} {
  return typeof value === 'string' && value.trim() !== ''
    ? {ok: true, value: value.trim()}
    : {ok: false, error};
}

function optionalString(value: unknown, error: string): {ok: true; value?: string} | {ok: false; error: string} {
  if (value === undefined) {
    return {ok: true};
  }

  return typeof value === 'string'
    ? {ok: true, value: value.trim() || undefined}
    : {ok: false, error};
}

function enumProperty(values: string[]): Record<string, unknown> {
  return {type: 'string', enum: values};
}

function stringProperty(): Record<string, unknown> {
  return {type: 'string'};
}

function success(call: ToolCall, text: string): BaseToolExecutionResult {
  return {callId: call.callId, toolName: call.toolName, ok: true, text};
}

function failure(call: ToolCall, text: string): BaseToolExecutionResult {
  return {callId: call.callId, toolName: call.toolName, ok: false, text};
}

function isMemoryMutationToolName(name: string): boolean {
  return MEMORY_MUTATION_TOOL_NAMES.has(name);
}

export {
  ADD_MEMORY_TOOL_NAME,
  READ_MEMORY_TOOL_NAME,
  REMOVE_MEMORY_TOOL_NAME,
  UPDATE_MEMORY_TOOL_NAME,
  createMemoryToolHandlers,
  isMemoryMutationToolName
};
