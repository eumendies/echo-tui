export type AgentWorkflowArgumentPolicy = 'none' | 'optional';

export type AgentWorkflowModePolicy = 'preserve' | 'switch_plan_to_normal';

export type AgentWorkflowPromptContext = {
  argumentsText?: string;
};

export type AgentWorkflowDefinition = {
  name: string;
  description: string;
  argumentPolicy: AgentWorkflowArgumentPolicy;
  modePolicy: AgentWorkflowModePolicy;
  createPrompt(context: AgentWorkflowPromptContext): string;
};
