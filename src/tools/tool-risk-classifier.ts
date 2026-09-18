import {APPLY_PATCH_TOOL_NAME, createApplyPatchCallLabel} from './apply-patch-tool-handler';
import {PLAN_READONLY_BASH_REJECTION, RUN_BASH_COMMAND_TOOL_NAME, isPlanReadonlyBashCommand} from './bash-tool-handler';
import {isMcpToolName} from '../mcp/manager';
import {EDIT_FILE_TOOL_NAME, createEditFileCallLabel} from './edit-file-tool-handler';
import {isTodoToolName} from './todo-tool-handler';
import {RUN_SUBAGENT_TOOL_NAME} from './run-subagent-tool-handler';
import {LIST_MCP_RESOURCES_TOOL_NAME, MCP_RESOURCE_TOOL_NAMES, READ_MCP_RESOURCE_TOOL_NAME} from './mcp-resource-tools';

import type {InteractionMode, SubagentRunMetadata} from '../types/agent';
import type {ToolCall, ToolRiskAssessment} from '../types/tool';

const BASH_RISK_PATTERNS: RegExp[] = [
  // 文件创建、删除、移动、复制、权限和属主变更都可能修改工作区或系统状态。
  /(?:^|[;&|()]\s*|\bxargs\s+|\bsudo\s+)(?:rm|rmdir|unlink|mv|cp|touch|chmod|chown|chgrp|truncate)\b/,
  // shell 重定向会写入或追加文件内容，属于显式文件变更。
  /(?:^|[^<])(?:\d?>|>>|&>|>\|)/,
  // sed/perl 的 in-place 模式会直接改写文件。
  /\b(?:sed|perl)\b[^\n;&|]*\s-(?:[A-Za-z]*i[A-Za-z]*|p?i)\b/,
  // find 搭配 delete 或 exec rm 会批量删除匹配文件。
  /\bfind\b[\s\S]*(?:\s-delete\b|\s-exec\s+(?:sudo\s+)?rm\b)/,
  // 包管理器安装或更新会改动依赖、锁文件或系统包状态。
  /(?:^|[;&|()]\s*)(?:(?:npm|pnpm|yarn)\s+(?:install|i|add|update|upgrade)\b|pip(?:3)?\s+install\b|python(?:3)?\s+-m\s+pip\s+install\b|cargo\s+(?:add|install|update)\b|go\s+get\b|brew\s+(?:install|upgrade|update)\b)/,
  // 这些 git 操作会改写工作区、提交历史或远端状态。
  /(?:^|[;&|()]\s*)git\s+(?:reset\b|clean\b|rebase\b|commit\b|push\b|checkout\s+--(?:\s|$)|restore\b)/,
  // 下载远端脚本并直接交给 shell 执行需要显式确认。
  /\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/
];
const PLAN_WRITE_TOOL_REJECTION = 'In plan mode, tools that modify files or system state are not available. To make changes, exit plan mode first.';
const READONLY_TOOL_REJECTION = 'This run only allows read-only tools. The requested tool was not executed.';
const READONLY_MCP_TOOL_REJECTION = 'This run only allows read-only tools. The requested MCP tool is not declared read-only by its server.';
const READONLY_SUBAGENT_REJECTION = 'This run only allows delegating to read-only subagents. The requested subagent was not started.';
const READONLY_OBSERVATION_TOOL_NAMES: ReadonlySet<string> = new Set(['read_files', 'glob', 'grep', 'web_fetch', 'web_search', 'use_skill', LIST_MCP_RESOURCES_TOOL_NAME, READ_MCP_RESOURCE_TOOL_NAME]);

/**
 * 对 BTW、/review 等单次 readonly run 做 fail-closed 分类；工具 schema 保持不变，执行边界在本地强制。
 * run_subagent 仅当目标属于本轮只读 subagent 名称集合时放行，缺省集合视为不可委派。
 * MCP 工具仅当名称落在 run 启动时固定的只读集合内才放行;没有 server 级信任开关。
 * bashSandboxed 为 true 时 bash 已由生效的只读沙箱兜底:豁免文本白名单,效果边界由内核保证。
 */
function classifyReadonlyToolCall(call: ToolCall, readonlySubagentNames?: ReadonlySet<string>, bashSandboxed = false, readonlyMcpToolNames?: ReadonlySet<string>): ToolRiskAssessment {
  if (isMcpToolName(call.toolName)) {
    return readonlyMcpToolNames?.has(call.toolName) === true
      ? {risk: 'safe'}
      : {risk: 'rejected', reason: 'readonly_policy', message: READONLY_MCP_TOOL_REJECTION};
  }

  if (isTodoToolName(call.toolName) || READONLY_OBSERVATION_TOOL_NAMES.has(call.toolName)) {
    return {risk: 'safe'};
  }

  if (call.toolName === RUN_SUBAGENT_TOOL_NAME) {
    const agentName = parseRunSubagentAgentName(call.argumentsText);
    return agentName !== null && readonlySubagentNames?.has(agentName) === true
      ? {risk: 'safe'}
      : {risk: 'rejected', reason: 'readonly_policy', message: READONLY_SUBAGENT_REJECTION};
  }

  if (call.toolName === RUN_BASH_COMMAND_TOOL_NAME) {
    if (bashSandboxed) {
      // 由readonly沙箱兜底的bash命令,不再做文本白名单检查,直接放行。
      return {risk: 'safe'};
    }

    const command = parseBashCommand(call.argumentsText);
    return command && isPlanReadonlyBashCommand(command)
      ? {risk: 'safe'}
      : {risk: 'rejected', reason: 'readonly_policy', message: READONLY_TOOL_REJECTION};
  }

  return {risk: 'rejected', reason: 'readonly_policy', message: READONLY_TOOL_REJECTION};
}

/** 子 Agent 仅让严格白名单 Bash 直通；其余 Bash 固定要求人工单次审批。 */
function classifySubagentToolCall(call: ToolCall, metadata: SubagentRunMetadata): ToolRiskAssessment {
  if (call.toolName !== RUN_BASH_COMMAND_TOOL_NAME) {
    return READONLY_OBSERVATION_TOOL_NAMES.has(call.toolName)
      ? {risk: 'safe'}
      : {risk: 'rejected', reason: 'readonly_policy', message: READONLY_TOOL_REJECTION};
  }

  const command = parseBashCommand(call.argumentsText);
  if (command && isPlanReadonlyBashCommand(command)) {
    return {risk: 'safe'};
  }

  return {
    risk: 'approval_required',
    approval: {
      preview: command || call.argumentsText,
      previewTitle: `${metadata.agentName} bash`,
      origin: {
        kind: 'subagent',
        agentName: metadata.agentName,
        runId: metadata.runId
      }
    }
  };
}

/**
 * 对 provider 产出的 tool call 做执行前策略分类：安全执行、请求审批，或按当前 mode 直接拒绝。
 * MCP 工具没有 server 级审批开关:命中 run 启动时固定的只读集合才免审批,其余一律 approval_required。
 * bashSandboxed 只在 plan 分支被消费:生效只读沙箱已由内核兜底时,plan 的 bash 不再需要文本白名单;
 * normal 分支刻意忽略该参数,保持"沙箱不改变普通审批"的正交性。
 */
function classifyToolCallRisk(call: ToolCall, interactionMode: InteractionMode = 'normal', readonlyMcpToolNames?: ReadonlySet<string>, bashSandboxed = false): ToolRiskAssessment {
  // 资源读取是纯观察:plan 与普通模式都直接放行,不进入审批,也不落入 MCP tools 的只读注解判定。
  if (MCP_RESOURCE_TOOL_NAMES.has(call.toolName)) {
    return {risk: 'safe'};
  }

  if (call.toolName === APPLY_PATCH_TOOL_NAME || call.toolName === EDIT_FILE_TOOL_NAME) {
    if (interactionMode === 'plan') {
      return {risk: 'rejected', reason: 'plan_mode', message: PLAN_WRITE_TOOL_REJECTION};
    }

    return {
      risk: 'approval_required',
      approval: {
        preview: call.toolName === EDIT_FILE_TOOL_NAME
          ? createEditFileCallLabel(call.argumentsText)
          : createApplyPatchCallLabel(call.argumentsText)
      }
    };
  }

  if (isMcpToolName(call.toolName)) {
    if (interactionMode === 'plan') {
      return {risk: 'rejected', reason: 'plan_mode', message: 'MCP tools are not available in plan mode.'};
    }

    return readonlyMcpToolNames?.has(call.toolName) === true
      ? {risk: 'safe'}
      : {
        risk: 'approval_required',
        approval: {
          preview: createMcpApprovalPreview(call),
          previewTitle: 'mcp tool'
        }
      };
  }

  if (call.toolName !== RUN_BASH_COMMAND_TOOL_NAME) {
    return {risk: 'safe'};
  }

  const command = parseBashCommand(call.argumentsText);

  if (!command) {
    return {risk: 'safe'};
  }

  if (interactionMode === 'plan') {
    // 沙箱生效时任意命令进入执行链路,越界效果由内核边界拒绝;不生效才回退严格 allowlist。
    return bashSandboxed || isPlanReadonlyBashCommand(command)
      ? {risk: 'safe'}
      : {risk: 'rejected', reason: 'plan_mode', message: PLAN_READONLY_BASH_REJECTION};
  }

  if (!hasBashRisk(command)) {
    return {risk: 'safe'};
  }

  return {
    risk: 'approval_required',
    approval: {
      preview: command
    }
  };
}

function createMcpApprovalPreview(call: ToolCall): string {
  const [, serverName = 'unknown', ...toolNameParts] = call.toolName.split('__');
  return `Server: ${serverName}\nTool: ${toolNameParts.join('__') || 'unknown'}\nArguments:\n${call.argumentsText || '{}'}`;
}

function parseBashCommand(argumentsText: string): string | null {
  let args: unknown;

  try {
    args = JSON.parse(argumentsText);
  } catch {
    return null;
  }

  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return null;
  }

  const command = (args as {command?: unknown}).command;

  return typeof command === 'string' && command.trim() !== '' ? command : null;
}

/** 解析 run_subagent 参数中的 agent 名称；provider 输出不可信，解析失败返回 null。 */
function parseRunSubagentAgentName(argumentsText: string): string | null {
  let args: unknown;

  try {
    args = JSON.parse(argumentsText);
  } catch {
    return null;
  }

  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return null;
  }

  const agentName = (args as {agent?: unknown}).agent;
  return typeof agentName === 'string' && agentName !== '' ? agentName : null;
}

function hasBashRisk(command: string): boolean {
  const normalizedCommand = command.replace(/\r\n?/g, '\n');
  return BASH_RISK_PATTERNS.some((pattern) => pattern.test(normalizedCommand));
}

export {
  READONLY_OBSERVATION_TOOL_NAMES,
  READONLY_MCP_TOOL_REJECTION,
  READONLY_SUBAGENT_REJECTION,
  READONLY_TOOL_REJECTION,
  classifyReadonlyToolCall,
  classifySubagentToolCall,
  classifyToolCallRisk,
  createMcpApprovalPreview,
  parseBashCommand,
  parseRunSubagentAgentName
};
