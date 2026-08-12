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
import {createToolResultStore} from './tool-result-offloading';
import {createEditFileToolHandler} from './edit-file-tool-handler';
import {createRunSubagentToolHandler} from './run-subagent-tool-handler';

import type {LlmConfig, SubagentToolPort} from '../types/agent';
import type {ToolHandler, ToolRegistry} from '../types/tool';
import type {ToolResultStore} from './tool-result-offloading';

type DefaultToolRegistryOptions = {
  allowedToolNames?: ReadonlySet<string>; // 缺省暴露完整默认目录；存在时只创建明确允许的 handler。
  subagentPort?: SubagentToolPort; // 仅父 run 注入，缺省时不注册 run_subagent。
};

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
function createDefaultToolRegistry(config: LlmConfig, cwd: string | (() => string) = process.cwd, toolResultStore: ToolResultStore = createToolResultStore({cwd}), options: DefaultToolRegistryOptions = {}): ToolRegistry {
  const skillManager = createSkillManager({cwd});
  const fileEditHandler = config.tools.fileEditMode === 'edit_file'
    ? createEditFileToolHandler({cwd})
    : createApplyPatchToolHandler({cwd});
  const handlers = [
    createBashToolHandler({
      cwd,
      maxOutputBytes: config.tools.bash.maxOutputBytes,
      toolResultStore,
      timeoutMs: config.tools.bash.timeoutMs
    }),
    fileEditHandler,
    createAskUserQuestionsToolHandler(),
    createGlobToolHandler({
      cwd
    }),
    createGrepToolHandler({
      cwd
    }),
    createReadFilesToolHandler({
      autoCompressImages: config.tools.autoCompressImages,
      cwd,
      toolResultStore
    }),
    ...createTodoToolHandlers(),
    createUseSkillToolHandler(skillManager),
    createWebFetchToolHandler({
      toolResultStore
    }),
    createWebSearchToolHandler({
    }),
    ...(options.subagentPort ? [createRunSubagentToolHandler(options.subagentPort)] : [])
  ];
  const registry = createToolRegistry(options.allowedToolNames
    ? handlers.filter((handler) => options.allowedToolNames!.has(handler.definition.name))
    : handlers);

  return {
    ...registry,
    listSkillCatalog: skillManager.listCatalog
  };
}

export {
  createDefaultToolRegistry,
  createToolRegistry
};

export type {DefaultToolRegistryOptions};
