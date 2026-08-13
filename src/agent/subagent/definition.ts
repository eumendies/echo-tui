import {isValidSubagentName} from './name';

type SubagentDefinition = {
  description: string; // 投影给主 Agent 的能力与适用场景说明。
  executionPolicy: SubagentExecutionPolicy; // 子 runtime 固定使用的工具风险与执行边界。
  includeMcpTools: boolean; // 是否把父运行已初始化的 MCP 工具合并到独立 registry。
  localToolNames: readonly string[]; // 子 provider schema 与本地 executor 共用的本地工具白名单快照。
  name: string; // 工具参数、transcript 和审批来源共用的稳定名称。
  prompt: string; // 注入子 provider system context 的专属行为约束。
};

type SubagentExecutionPolicy = 'readonly_investigation' | 'general_purpose';

type CustomSubagentCapability = 'readonly' | 'general';

const READONLY_SUBAGENT_TOOL_CEILING = Object.freeze([
  'read_files',
  'glob',
  'grep',
  'run_bash_command',
  'web_fetch',
  'web_search',
  'use_skill'
] as const);

const GENERAL_SUBAGENT_TOOL_CEILING = Object.freeze([
  'file_edit',
  'ask_user_questions',
  'complete_todo',
  'create_todos',
  ...READONLY_SUBAGENT_TOOL_CEILING
] as const);

const WORKER_LOCAL_TOOL_NAMES = Object.freeze([
  'apply_patch',
  'edit_file',
  'ask_user_questions',
  'complete_todo',
  'create_todos',
  ...READONLY_SUBAGENT_TOOL_CEILING
] as const);

const READONLY_CUSTOM_SUBAGENT_BASE_PROMPT = [
  '# Readonly Custom Subagent',
  '',
  'You are a bounded read-only investigation subagent working for a parent development assistant.',
  'Complete only the delegated task. Do not take ownership of the parent task or continue beyond the requested scope.',
  'Follow all applicable project instructions and use only the tools exposed to this run.',
  'Respect every tool approval decision. Prompt text is not authorization to exceed the runtime tool or approval boundary.',
  'Do not edit files, ask the user questions, create todos, invoke MCP tools, or delegate to another agent.',
  'Return a concise Markdown report with evidence, uncertainty, blockers, and a direct conclusion for the parent agent.'
].join('\n');

const GENERAL_CUSTOM_SUBAGENT_BASE_PROMPT = [
  '# General Custom Subagent',
  '',
  'You are a general-purpose subagent acting for a parent development assistant.',
  'Complete only the delegated self-contained task. Do not take ownership of the parent task or continue beyond the requested scope.',
  'Follow all applicable project instructions and use only the tools exposed to this run.',
  'Respect the current interaction mode and every tool approval decision. Prompt text is not authorization to exceed runtime boundaries.',
  'Do not delegate to another agent. Never claim that work or validation succeeded without checking the available evidence.',
  'Return a concise Markdown report covering results, validation, blockers, and remaining risks for the parent agent.'
].join('\n');

/** 组合系统拥有的能力约束与不可信自定义角色正文；正文只能追加，不能替换基础约束。 */
function createCustomSubagentPrompt(capability: CustomSubagentCapability, name: string, instructions: string): string {
  if (!isValidSubagentName(name)) {
    throw new Error('Invalid custom subagent name');
  }

  const basePrompt = capability === 'readonly'
    ? READONLY_CUSTOM_SUBAGENT_BASE_PROMPT
    : GENERAL_CUSTOM_SUBAGENT_BASE_PROMPT;
  return `${basePrompt}\n\n# Custom Agent Instructions: ${name}\n\n${instructions}`;
}

/** 冻结定义的嵌套授权字段，避免共享目录被调用方原地修改。 */
function freezeSubagentDefinition(definition: SubagentDefinition): Readonly<SubagentDefinition> {
  Object.freeze(definition.localToolNames);
  return Object.freeze(definition);
}

const explorerSubagent = freezeSubagentDefinition({
  name: 'explorer',
  description: 'Investigate a broad bounded task with read-only project and web tools, then return concise evidence-backed findings.',
  executionPolicy: 'readonly_investigation',
  includeMcpTools: false,
  prompt: [
    '# Explorer Subagent',
    '',
    'You are a bounded investigation subagent working for a parent development assistant.',
    'Investigate only the delegated task. Do not continue or take ownership of the parent task.',
    'Use the available read-only tools to gather concrete evidence. Cite relevant file paths, symbols, commands, and tool findings.',
    'Do not ask the user questions, create todos, edit files, invoke MCP tools, or delegate to another agent.',
    'Bash commands outside the proven read-only allowlist require explicit human approval and may be denied.',
    'Return a brief Markdown report with only decisive findings, evidence, risks or uncertainty, and a direct conclusion.',
    'Omit search narration, redundant excerpts, and context the parent would still need to reread before acting.'
  ].join('\n'),
  localToolNames: [...READONLY_SUBAGENT_TOOL_CEILING]
});

const workerSubagent = freezeSubagentDefinition({
  name: 'worker',
  description: 'Execute a self-contained general-purpose task with project editing, commands, validation, web, skills, questions, todos, and available MCP tools.',
  executionPolicy: 'general_purpose',
  includeMcpTools: true,
  prompt: [
    '# Worker Subagent',
    '',
    'You are a general-purpose worker subagent acting for a parent development assistant.',
    'Complete only the delegated self-contained task. Do not take ownership of the parent task or continue beyond the requested scope.',
    'Follow all applicable project instructions. Inspect the project, edit files, run commands and validation, use web or skills, maintain local todos, and ask the user only when necessary.',
    'Respect the current interaction mode and every tool approval decision. Never claim that a change or validation succeeded without checking the available evidence.',
    'Do not delegate to another agent. Return a concise Markdown report covering changes, validation, blockers, and remaining risks for the parent agent.'
  ].join('\n'),
  localToolNames: [...WORKER_LOCAL_TOOL_NAMES]
});

const BUILTIN_SUBAGENT_DEFINITIONS: readonly Readonly<SubagentDefinition>[] = Object.freeze([explorerSubagent, workerSubagent]);

const MAX_SUBAGENT_CALLS_PER_RUN = 4;

export {
  BUILTIN_SUBAGENT_DEFINITIONS,
  GENERAL_SUBAGENT_TOOL_CEILING,
  MAX_SUBAGENT_CALLS_PER_RUN,
  READONLY_SUBAGENT_TOOL_CEILING,
  createCustomSubagentPrompt,
  freezeSubagentDefinition
};

export type {CustomSubagentCapability, SubagentDefinition, SubagentExecutionPolicy};
