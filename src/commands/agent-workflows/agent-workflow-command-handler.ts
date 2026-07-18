import {INIT_WORKFLOW} from './init-workflow';
import {REVIEW_WORKFLOW} from './review-workflow';

import type {AgentWorkflowDefinition} from '../../types/agent-workflow';
import type {
  CommandHandler,
  CommandHost,
  CommandStartResult,
  MatchableCommandHandler
} from '../../types/command';

const BUILT_IN_AGENT_WORKFLOWS: AgentWorkflowDefinition[] = [
  INIT_WORKFLOW,
  REVIEW_WORKFLOW
];

function parseAgentWorkflowText(
  text: string,
  definition: AgentWorkflowDefinition
): {argumentsText?: string} | null {
  const match = /^\/([^/\s]+)(?:\s+([\s\S]*))?$/u.exec(String(text));

  if (!match || match[1] !== definition.name) {
    return null;
  }

  const argumentsText = match[2]?.trim();

  if (definition.argumentPolicy === 'none' && argumentsText) {
    return null;
  }

  return {
    ...(argumentsText ? {argumentsText} : {})
  };
}

export class AgentWorkflowCommandHandler implements CommandHandler {
  readonly name: string;
  readonly description: string;

  constructor(private readonly definition: AgentWorkflowDefinition) {
    this.name = definition.name;
    this.description = definition.description;
  }

  /**
   * 按 workflow 定义匹配 slash command；无参数 workflow 不消费带后缀的输入。
   */
  match(text: string): boolean {
    return Boolean(parseAgentWorkflowText(text, this.definition));
  }

  /**
   * 应用 workflow mode 策略，并把内部 prompt 交回普通 user message 提交流程。
   */
  start(text: string, host: CommandHost): CommandStartResult {
    const parsed = parseAgentWorkflowText(text, this.definition);

    if (!parsed) {
      return {kind: 'not_matched'};
    }

    if (
      this.definition.modePolicy === 'switch_plan_to_normal' &&
      host.mode.getInteractionMode() === 'plan'
    ) {
      host.mode.setInteractionMode('normal');
      host.transcript.append({
        role: 'local_notice',
        text: `已从 plan mode 切换到 normal mode 以运行 /${this.definition.name} 流程。`
      });
    }

    return {
      kind: 'submit_user_message',
      text: this.definition.createPrompt(parsed),
      displayText: String(text),
      metadata: {
        agentWorkflow: {
          source: 'builtin',
          name: this.definition.name,
          ...(parsed.argumentsText ? {argumentsText: parsed.argumentsText} : {})
        }
      }
    };
  }
}

/**
 * 为每次默认命令装配创建独立 workflow handlers，避免共享可变命令实例。
 */
function createBuiltInAgentWorkflowHandlers(): MatchableCommandHandler[] {
  return BUILT_IN_AGENT_WORKFLOWS.map((definition) => new AgentWorkflowCommandHandler(definition));
}

export {
  BUILT_IN_AGENT_WORKFLOWS,
  createBuiltInAgentWorkflowHandlers,
  parseAgentWorkflowText
};
