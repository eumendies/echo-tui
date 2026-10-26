import {isJsonConfigObject} from './json-config-file';

import type {UserConfigSource} from './user-config';

export type MainAgentToolsConfig = {
  disabledTools: string[]; // 主 Agent 按完整名称禁用的工具；不包含 Bash，Todo 必须成对出现。
};

/** 严格校验禁用名单，保留精确名称及未知偏好，并落实 Bash 与 Todo 的运行约束。 */
export function normalizeDisabledTools(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('tools.mainAgent.disabledTools 必须是非空工具名组成的字符串数组');
  }

  const names = new Set<string>();
  for (const name of value) {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error('tools.mainAgent.disabledTools 必须是非空工具名组成的字符串数组');
    }
    if (name !== 'run_bash_command') {
      names.add(name);
    }
  }

  if (names.has('create_todos') || names.has('complete_todo')) {
    names.add('create_todos');
    names.add('complete_todo');
  }
  return [...names];
}

/** 独立解析主工具选择；缺失名单默认全开，不读取旧编辑模式。 */
export function parseMainAgentToolsConfig(root: UserConfigSource): MainAgentToolsConfig {
  const tools = isJsonConfigObject(root.tools) ? root.tools : {};
  const mainAgent = isJsonConfigObject(tools.mainAgent) ? tools.mainAgent : {};
  if (Object.hasOwn(mainAgent, 'disabledTools')) {
    return {disabledTools: normalizeDisabledTools(mainAgent.disabledTools)};
  }

  return {disabledTools: []};
}

/** 仅更新工具页拥有的禁用名单；调用方负责最新根读取和原子保存。 */
export function applyMainAgentToolsDraft(root: UserConfigSource, draft: MainAgentToolsConfig): void {
  const disabledTools = normalizeDisabledTools(draft.disabledTools);
  const tools = isJsonConfigObject(root.tools) ? {...root.tools} : {};
  const mainAgent = isJsonConfigObject(tools.mainAgent) ? {...tools.mainAgent} : {};
  mainAgent.disabledTools = disabledTools;
  tools.mainAgent = mainAgent;
  root.tools = tools;
}
