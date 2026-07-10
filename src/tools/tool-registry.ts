import {createApplyPatchToolHandler} from './apply-patch-tool-handler';
import {createAskUserQuestionsToolHandler} from './ask-user-questions-tool-handler';
import {createBashToolHandler} from './bash-tool-handler';
import {createGlobToolHandler} from './glob-tool-handler';
import {createGrepToolHandler} from './grep-tool-handler';
import {createReadFilesToolHandler} from './read-files';
import {createSkillManager} from '../skills/skill-manager';
import {createUseSkillToolHandler} from './use-skill-tool-handler';
import {createTodoToolHandlers} from './todo-tool-handler';
import {createWebFetchToolHandler} from './web-fetch-tool-handler';
import {createWebSearchToolHandler} from './web-search';

import type {LlmConfig} from '../types/agent';
import type {ToolHandler, ToolRegistry} from '../types/tool';

/**
 * 创建本地工具目录，负责把 provider-neutral 工具名映射到实际 handler。
 */
function createToolRegistry(handlers: ToolHandler[] = []): ToolRegistry {
  const handlersByName = new Map<string, ToolHandler>();

  for (const handler of handlers) {
    handlersByName.set(handler.definition.name, handler);
  }

  return {
    listDefinitions() {
      return Array.from(handlersByName.values()).map((handler) => ({...handler.definition}));
    },
    getHandler(name: string) {
      return handlersByName.get(name);
    },
    isEmpty() {
      return handlersByName.size === 0;
    }
  };
}

/**
 * 创建 CLI 默认工具目录；glob/grep/read_files/web_fetch/web_search 负责观察，apply_patch 负责受控文本编辑。
 */
function createDefaultToolRegistry(config: LlmConfig, cwd: string | (() => string) = process.cwd): ToolRegistry {
  const skillManager = createSkillManager({cwd});
  const registry = createToolRegistry([
    createBashToolHandler({
      cwd,
      maxOutputBytes: config.tools.bash.maxOutputBytes,
      timeoutMs: config.tools.bash.timeoutMs
    }),
    createApplyPatchToolHandler({
      cwd
    }),
    createAskUserQuestionsToolHandler(),
    createGlobToolHandler({
      cwd
    }),
    createGrepToolHandler({
      cwd
    }),
    createReadFilesToolHandler({
      cwd
    }),
    ...createTodoToolHandlers(),
    createUseSkillToolHandler(skillManager),
    createWebFetchToolHandler({
    }),
    createWebSearchToolHandler({
    })
  ]);

  return {
    ...registry,
    listSkillCatalog: skillManager.listCatalog
  };
}

export {
  createDefaultToolRegistry,
  createToolRegistry
};
