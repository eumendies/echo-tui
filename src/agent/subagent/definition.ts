/** 内置只读调查子 Agent；第一版不开放用户级覆盖或运行时选择。 */
type SubagentDefinition = {
  description: string; // 投影给主 Agent的能力与适用场景说明。
  executionPolicy: SubagentExecutionPolicy; // 子 runtime 固定使用的工具风险与执行边界。
  includeMcpTools: boolean; // 是否把父运行已初始化的 MCP 工具合并到独立 registry。
  localToolNames: ReadonlySet<string>; // 子 provider schema与本地 executor共用的本地工具白名单。
  name: string; // 工具参数、transcript和审批来源共用的稳定名称。
  prompt: string; // 注入子 provider system context的专属行为约束。
};

type SubagentExecutionPolicy =
  | {kind: 'readonly_investigation'} // Explorer 固定只读，未知 Bash 只能交互式人工升级。
  | {kind: 'general_purpose'}; // Worker 继承父 mode 与普通工具风险分类。

const explorerSubagent: SubagentDefinition = {
  name: 'explorer',
  description: 'Investigate a broad bounded task with read-only project and web tools, then return concise evidence-backed findings.',
  executionPolicy: {kind: 'readonly_investigation'},
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
  localToolNames: new Set([
    'read_files',
    'glob',
    'grep',
    'run_bash_command',
    'web_fetch',
    'web_search',
    'use_skill'
  ])
};

const workerSubagent: SubagentDefinition = {
  name: 'worker',
  description: 'Execute a self-contained general-purpose task with project editing, commands, validation, web, skills, questions, todos, and available MCP tools.',
  executionPolicy: {kind: 'general_purpose'},
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
  localToolNames: new Set([
    'apply_patch',
    'edit_file',
    'ask_user_questions',
    'complete_todo',
    'create_todos',
    'glob',
    'grep',
    'read_files',
    'run_bash_command',
    'use_skill',
    'web_fetch',
    'web_search'
  ])
};

const SUBAGENT_DEFINITIONS: readonly SubagentDefinition[] = [explorerSubagent, workerSubagent];

/** 返回内置子 Agent目录；定义对象只读共享，不在运行期间修改。 */
function listSubagentDefinitions(): readonly SubagentDefinition[] {
  return SUBAGENT_DEFINITIONS;
}

/** 按稳定名称解析子 Agent定义；未知名称不创建运行。 */
function getSubagentDefinition(name: string): SubagentDefinition | undefined {
  return SUBAGENT_DEFINITIONS.find((definition) => definition.name === name);
}

const MAX_SUBAGENT_CALLS_PER_RUN = 4;

export {
  MAX_SUBAGENT_CALLS_PER_RUN,
  getSubagentDefinition,
  listSubagentDefinitions
};

export type {SubagentDefinition, SubagentExecutionPolicy};
