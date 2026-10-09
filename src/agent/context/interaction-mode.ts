import type {InteractionMode} from '../../types/agent';

const PLAN_MODE_INSTRUCTIONS = 'Plan mode is active. Discuss and inspect only; do not modify files, install dependencies, change branch or repository state, run tests or builds, or use MCP tools. Shell commands either run inside a read-only sandbox (no workspace writes, no network access) or, when no sandbox is available, must stay within readonly inspection commands. Ask the user to switch to /mode normal before implementing.';
const NORMAL_MODE_INSTRUCTIONS = 'Normal mode is active. Previous Plan Mode restrictions no longer apply. You may implement changes and use mutation tools, subject to the normal tool approval and risk policies.';

type ModeTransitionUserMessage = {
  metadata: { // 用于持久化并重建模型已知模式的转换事实。
    from: 'normal' | 'plan'; // 本次消息应用前的模型执行语义。
    to: 'normal' | 'plan'; // 用户本次提交选择的模型执行语义。
  };
  text: string; // 带模式说明的 provider-facing 用户文本，展示仍使用原文。
};

/** 普通提交与引导共用模式说明；内部将 shell 系列视为 normal，模型语义不变时保留原文。 */
function createModeTransitionUserMessage(userText: string, from: InteractionMode, to: InteractionMode): ModeTransitionUserMessage | null {
  const fromMode = from === 'plan' ? 'plan' : 'normal';
  const toMode = to === 'plan' ? 'plan' : 'normal';
  if (fromMode === toMode) return null;
  return {
    metadata: {from: fromMode, to: toMode},
    text: [
      '[Interaction Mode Transition]', `from: ${fromMode}`, `to: ${toMode}`, '',
      '[Mode Instructions]', toMode === 'plan' ? PLAN_MODE_INSTRUCTIONS : NORMAL_MODE_INSTRUCTIONS, '',
      '[User Request]', userText
    ].join('\n')
  };
}

export {createModeTransitionUserMessage};
