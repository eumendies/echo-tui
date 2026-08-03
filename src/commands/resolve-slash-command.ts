import type { MatchableCommandHandler, SlashCommandDescriptor } from '../types/command';
import { createBuiltInAgentWorkflowHandlers } from './agent-workflows/agent-workflow-command-handler';
import { ClearCommandHandler } from './clear-command-handler';
import { BtwCommandHandler } from './btw-command-handler';
import { CompactCommandHandler } from './compact-command-handler';
import { ConfigCommandHandler } from './config/handler';
import { ContextCommandHandler } from './context-command-handler';
import { CopyCommandHandler } from './copy-command-handler';
import { DiffCommandHandler } from './diff-command-handler';
import { EffortCommandHandler } from './effort-command-handler';
import { ForkCommandHandler } from './fork-command-handler';
import { HelpCommandHandler } from './help-command-handler';
import { HooksCommandHandler } from './hooks-command-handler';
import { McpCommandHandler } from './mcp-command-handler';
import { MemoryCommandHandler } from './memory-command-handler';
import { ModelCommandHandler } from './model-command-handler';
import { ModeCommandHandler } from './mode-command-handler';
import { ResumeCommandHandler } from './resume-command-handler';
import { ReferenceCommandHandler } from './reference-command-handler';
import { SkillInvocationCommandHandler } from './skill-invocation-command-handler';
import { SkillsCommandHandler } from './skills-command-handler';
import { StatusCommandHandler } from './status-command-handler';
import { UndoCommandHandler } from './undo-command-handler';
import { UsageCommandHandler } from './usage-command-handler';

/**
 * 装配默认 slash command handlers；具体 app 能力由 CommandHost 在运行时提供。
 *
 */
export function createDefaultSlashCommandHandlers(): MatchableCommandHandler[] {
  return [
    new HelpCommandHandler(),
    new BtwCommandHandler(),
    new ConfigCommandHandler(),
    new ModelCommandHandler(),
    new EffortCommandHandler(),
    new ModeCommandHandler(),
    new StatusCommandHandler(),
    new ContextCommandHandler(),
    new UsageCommandHandler(),
    new CopyCommandHandler(),
    new ClearCommandHandler(),
    new CompactCommandHandler(),
    new DiffCommandHandler(),
    new UndoCommandHandler(),
    new ForkCommandHandler(),
    new ResumeCommandHandler(),
    new ReferenceCommandHandler(),
    new McpCommandHandler(),
    new MemoryCommandHandler(),
    new HooksCommandHandler(),
    new SkillsCommandHandler(),
    ...createBuiltInAgentWorkflowHandlers(),
    new SkillInvocationCommandHandler()
  ];
}

/**
 * 从 slash command handlers 派生命令提示元数据，避免维护第二份命令清单。
 *
 */
export function createSlashCommandDescriptors(handlers: MatchableCommandHandler[]): SlashCommandDescriptor[] {
  return handlers
    .filter((handler): handler is MatchableCommandHandler & SlashCommandDescriptor => Boolean(handler.name && handler.description))
    .map((handler) => ({
      name: handler.name,
      description: handler.description,
      ...(handler.allowDuringAssistantTurn ? {allowDuringAssistantTurn: true} : {})
    }));
}

/**
 * 依次询问 handler 是否命中当前提交文本；命中则直接返回该 handler。
 *
 */
export function resolveSlashCommand(
  text: string,
  handlers: MatchableCommandHandler[]
): MatchableCommandHandler | null {
  for (const handler of handlers) {
    if (handler.match(text)) {
      return handler;
    }
  }

  return null;
}
