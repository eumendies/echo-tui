import {APPLY_PATCH_TOOL_NAME} from './apply-patch-tool-handler';
import {ASK_USER_QUESTIONS_TOOL_NAME} from './ask-user-questions-tool-handler';
import {RUN_BASH_COMMAND_TOOL_NAME} from './bash-tool-handler';
import {EDIT_FILE_TOOL_NAME} from './edit-file-tool-handler';
import {GLOB_TOOL_NAME} from './glob-tool-handler';
import {GREP_TOOL_NAME} from './grep-tool-handler';
import {MCP_RESOURCE_TOOL_NAMES} from './mcp-resource-tools';
import {READ_FILES_TOOL_NAME} from './read-files';
import {RUN_SUBAGENT_TOOL_NAME} from './run-subagent-tool-handler';
import {CREATE_TODOS_TOOL_NAME, COMPLETE_TODO_TOOL_NAME} from './todo-tool-handler';
import {USE_SKILL_TOOL_NAME} from './use-skill-tool-handler';
import {WEB_FETCH_TOOL_NAME} from './web-fetch-tool-handler';
import {WEB_SEARCH_TOOL_NAME} from './web-search';

import type {McpManager} from '../mcp/manager';
import type {MainAgentToolCatalogEntry} from '../types/tool';

type MainAgentToolCatalogOptions = {
  mcpManager?: McpManager; // 只消费已发现元数据，不建立或刷新连接。
  disabledTools: readonly string[]; // 仅用于补齐未知及离线偏好，不过滤可恢复的候选目录。
};

// 直接引用 handler 的真实名称；名称集合与运行 registry 的一致性由集成测试校验。
const BUILTIN_TOOL_NAMES = [
  RUN_BASH_COMMAND_TOOL_NAME,
  APPLY_PATCH_TOOL_NAME,
  EDIT_FILE_TOOL_NAME,
  ASK_USER_QUESTIONS_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  READ_FILES_TOOL_NAME,
  CREATE_TODOS_TOOL_NAME,
  COMPLETE_TODO_TOOL_NAME,
  USE_SKILL_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  RUN_SUBAGENT_TOOL_NAME
];

/** 列举未经主名单过滤的名称与可用性；不装配执行器、扫描技能或为离线项注册 handler。 */
function createMainAgentToolCatalog(options: MainAgentToolCatalogOptions): MainAgentToolCatalogEntry[] {
  const entries: MainAgentToolCatalogEntry[] = BUILTIN_TOOL_NAMES.map((name) => ({name, available: true}));
  const resourcesAvailable = (options.mcpManager?.listServerNames().length ?? 0) > 0;
  entries.push(...[...MCP_RESOURCE_TOOL_NAMES].map((name) => ({name, available: resourcesAvailable})));
  for (const tool of options.mcpManager?.listTools() || []) {
    entries.push({name: tool.namespacedName, available: true, serverName: tool.serverName});
  }
  const knownNames = new Set(entries.map(({name}) => name));
  for (const name of options.disabledTools) {
    if (!knownNames.has(name)) {
      entries.push({name, available: false, unknown: true});
      knownNames.add(name);
    }
  }
  return entries;
}

export {createMainAgentToolCatalog};
export type {MainAgentToolCatalogEntry, MainAgentToolCatalogOptions};
