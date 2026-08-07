import type {AgentInstructionFileName} from './agent';

export type AgentWorkflowArgumentPolicy = 'none' | 'optional';

export type AgentWorkflowModePolicy = 'preserve' | 'switch_plan_to_normal';

export type AgentWorkflowPromptContext = {
  argumentsText?: string; // Slash command 中传入的可选 workflow 参数。
  fileName?: AgentInstructionFileName; // 当前配置 revision 选择的项目指令文件名。
};

export type AgentWorkflowDefinition = {
  name: string;
  description: string;
  argumentPolicy: AgentWorkflowArgumentPolicy;
  modePolicy: AgentWorkflowModePolicy;
  createPrompt(context: AgentWorkflowPromptContext): string;
};
