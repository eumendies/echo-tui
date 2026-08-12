/** 内置只读调查子 Agent；第一版不开放用户级覆盖或运行时选择。 */
type SubagentDefinition = {
  description: string; // 投影给主 Agent的能力与适用场景说明。
  name: string; // 工具参数、transcript和审批来源共用的稳定名称。
  prompt: string; // 注入子 provider system context的专属行为约束。
  toolNames: ReadonlySet<string>; // 子 provider schema与本地 executor共用的工具白名单。
};

const explorerSubagent: SubagentDefinition = {
  name: 'explorer',
  description: 'Investigate a broad bounded task with read-only project and web tools, then return concise evidence-backed findings.',
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
  toolNames: new Set([
    'read_files',
    'glob',
    'grep',
    'run_bash_command',
    'web_fetch',
    'web_search',
    'use_skill'
  ])
};

const SUBAGENT_DEFINITIONS: readonly SubagentDefinition[] = [explorerSubagent];

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

export type {SubagentDefinition};
