import type {AgentInstructionFileName, AgentToolPolicy} from './agent';
import type {SandboxModeOverride} from '../sandbox/types';

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
  toolPolicy?: AgentToolPolicy; // 运行级工具策略;readonly 让该 workflow turn 走 fail-closed 只读边界。
  sandboxModeOverride?: SandboxModeOverride; // 运行级沙箱收紧;只读 workflow 把已启用 bash 沙箱收紧为 read-only。
  createPrompt(context: AgentWorkflowPromptContext): string;
};
