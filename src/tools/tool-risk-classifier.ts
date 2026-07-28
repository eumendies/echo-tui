import {APPLY_PATCH_TOOL_NAME, createApplyPatchCallLabel} from './apply-patch-tool-handler';
import {PLAN_READONLY_BASH_REJECTION, RUN_BASH_COMMAND_TOOL_NAME, isPlanReadonlyBashCommand} from './bash-tool-handler';
import {isMcpToolName} from '../mcp/manager';
import {isMemoryMutationToolName} from './memory-tool-handler';
import {EDIT_FILE_TOOL_NAME, createEditFileCallLabel} from './edit-file-tool-handler';

import type {InteractionMode} from '../types/agent';
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

/**
 * 对 provider 产出的 tool call 做执行前策略分类：安全执行、请求审批，或按当前 mode 直接拒绝。
 */
function classifyToolCallRisk(call: ToolCall, interactionMode: InteractionMode = 'normal', getMcpApproval?: (toolName: string) => 'always' | 'never' | undefined): ToolRiskAssessment {
  if (isMemoryMutationToolName(call.toolName)) {
    if (interactionMode === 'plan') return {
      risk: 'rejected', reason: 'plan_mode', message: PLAN_WRITE_TOOL_REJECTION
    };
    return {
      risk: 'approval_required', 
      approval: {preview: createMemoryApprovalPreview(call), previewTitle: 'memory change'}
    };
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

    if (getMcpApproval?.(call.toolName) === 'never') {
      return {risk: 'safe'};
    }

    return {
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
    return isPlanReadonlyBashCommand(command)
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

function createMemoryApprovalPreview(call: ToolCall): string {
  let args: Record<string, unknown> = {};
  try { 
    const parsed: unknown = JSON.parse(call.argumentsText); 
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      args = parsed as Record<string, unknown>;
    } 
  } catch {
    return '';
  }

  const lines: string[] = [];
  if (args.scope === 'global') lines.push('Scope: GLOBAL');
  else if (args.scope) lines.push(`Scope: ${String(args.scope)}`);

  if (args.catalog) lines.push(`Catalog: ${String(args.catalog)}`);
  if (args.target) lines.push(`Target: ${String(args.target)}`);
  if (args.itemId) lines.push(`Item: ${String(args.itemId)}`);
  
  const content = args.content || args.description || args.name;
  if (content) {
    lines.push('', String(content));
  }
  return lines.join('\n');
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

function hasBashRisk(command: string): boolean {
  const normalizedCommand = command.replace(/\r\n?/g, '\n');
  return BASH_RISK_PATTERNS.some((pattern) => pattern.test(normalizedCommand));
}

export {
  classifyToolCallRisk,
  createMemoryApprovalPreview,
  createMcpApprovalPreview,
  parseBashCommand
};
