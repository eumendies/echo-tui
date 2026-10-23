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
import {createMcpResourceToolHandlers} from './mcp-resource-tools';
import {resolveBashSandboxContext} from '../sandbox/provider';

import type {McpManager} from '../mcp/manager';
import type {AgentExecutionMode, LlmConfig, SubagentToolPort} from '../types/agent';
import type {SandboxModeOverride} from '../sandbox/types';
import type {SkillRegistry} from '../types/skill';
import type {ToolHandler, ToolRegistry} from '../types/tool';
import type {ToolResultStore} from './tool-result-offloading';

type DefaultToolRegistryOptions = {
  allowedToolNames?: ReadonlySet<string>; // 缺省暴露完整默认目录；存在时只保留明确允许的 handler。
  executionMode?: AgentExecutionMode; // 本次运行执行模式;headless full-access 强制关闭沙箱包装。
  mcpManager?: McpManager; // 注入共享 MCP manager 时注册资源读取工具；缺省时不注册。
  sandboxModeOverride?: SandboxModeOverride; // 本次运行的沙箱收紧;非 off 配置收紧为 read-only。
  skillRegistry?: SkillRegistry; // 注入运行级 Skill 快照 scope；缺省时按旧行为重新创建 SkillManager。
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
 * 创建包含双编辑工具的默认目录；主运行另行应用禁用名单，子运行按自身 allowlist 筛选。
 * Bash 在调用启动时读取运行级沙箱，其余工具沿用初始化快照。
 */
function createDefaultToolRegistry(config: LlmConfig, cwd: string | (() => string) = process.cwd, toolResultStore: ToolResultStore = createToolResultStore({cwd}), options: DefaultToolRegistryOptions = {}): ToolRegistry {
  const skillRegistry = options.skillRegistry || createSkillManager({cwd});
  const handlers = [
    createBashToolHandler({
      cwd,
      toolResultStore,
      maxOutputBytes: config.tools.bash.maxOutputBytes,
      // 每个调用启动时固定自己的沙箱；后续引导不会改变已经执行中的命令。
      get sandbox() {
        const modeOverride = options.sandboxModeOverride;
        return resolveBashSandboxContext(config.tools.sandbox, options.executionMode, modeOverride ? {modeOverride} : {}) ?? undefined;
      },
      timeoutMs: config.tools.bash.timeoutMs
    }),
    createApplyPatchToolHandler({cwd}),
    createEditFileToolHandler({cwd}),
    createAskUserQuestionsToolHandler(),
    createGlobToolHandler({cwd}),
    createGrepToolHandler({cwd}),
    createReadFilesToolHandler({autoCompressImages: config.tools.autoCompressImages, cwd, toolResultStore}),
    ...createTodoToolHandlers(),
    createUseSkillToolHandler(skillRegistry),
    createWebFetchToolHandler({toolResultStore}),
    createWebSearchToolHandler({}),
    // 资源工具只在 MCP 真正在用时注册；设置目录可独立展示其离线元数据。
    ...(options.mcpManager && options.mcpManager.listServerNames().length > 0
      ? createMcpResourceToolHandlers({manager: options.mcpManager, toolResultStore})
      : []),
    ...(options.subagentPort ? [createRunSubagentToolHandler(options.subagentPort, toolResultStore)] : [])
  ];
  const registry = createToolRegistry(options.allowedToolNames
    ? handlers.filter((handler) => options.allowedToolNames!.has(handler.definition.name))
    : handlers);

  return {
    ...registry,
    listSkillCatalog: skillRegistry.listCatalog
  };
}

export {
  createDefaultToolRegistry,
  createToolRegistry
};

export type {DefaultToolRegistryOptions};
