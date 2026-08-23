import type {MemoryPromptResolution} from '../context/memory-prompt';
import type {SkillCatalogPromptProjection} from '../../skills/skill-catalog-prompt';
import type {ChangeFileRecorder} from '../../types/change-history';
import type {
  AgentExecutionMode,
  AgentInstruction,
  AgentUserConfigSnapshot,
  InteractionMode,
  ReasoningEffort,
  ReasoningUpdate,
  SubagentRunMetadata,
  ToolApprovalDecision
} from '../../types/agent';
import type {SkillCatalogEntry} from '../../types/skill';
import type {AskUserQuestionsRequest, ToolApprovalRequest, ToolCall, ToolExecutionResult} from '../../types/tool';
import type {SubagentDefinition} from '../subagent/definition';

type InheritedAgentRunContext = {
  agentInstructions: AgentInstruction[]; // 父运行启动时已经解析的项目/用户指令链。
  basePrompt?: string; // 父运行已经选择的 system prompt override。
  memoryPrompt: MemoryPromptResolution; // 触发委派的父 provider turn 使用的 memory 投影。
  skillCatalog: SkillCatalogEntry[]; // 父运行已经按预算裁剪的 skill 目录。
  skillCatalogProjection: Pick<SkillCatalogPromptProjection, 'budgetTokens' | 'mode' | 'originalTokens'>; // 父 skill 目录的预算诊断事实。
  skillCatalogTokens: number; // 父 skill 目录投影的估算 token 数。
};

type SubagentLoopInput = {
  abortSignal?: AbortSignal; // 父 turn 传入的取消信号，贯穿子 provider和工具执行。
  configSnapshot: AgentUserConfigSnapshot; // 父 run 捕获的配置 revision，子运行不得自行切换。
  executionMode: AgentExecutionMode; // 父 run 的 interactive/headless 安全边界。
  interactionMode: InteractionMode; // general 策略使用的父 normal/plan 模式；readonly 策略不得读取它来放宽边界。
  metadata: SubagentRunMetadata; // 当前子运行的稳定身份和父工具关联。
  modelProfileId?: string; // 父 run 已解析选择的模型 profile。
  reasoningEffortOverride?: ReasoningEffort; // 父 run 本轮固定的推理强度覆盖。
  task: string; // 唯一进入子 transcript 的委派任务。
};

type SubagentLoopCallbacks = {
  changeRecorder?: ChangeFileRecorder; // 人工允许 Bash 后复用父 turn 的变更追踪边界。
  onAssistantSegment?: (text: string) => void; // 工具 continuation 前已经稳定的 assistant 文本。
  onComplete?: (text: string) => void; // 子 loop 无工具调用时产生的最终报告。
  onReasoningUpdate?: (update: ReasoningUpdate) => void; // 子 provider可见 reasoning 草稿和完成边界。
  onThinking?: () => void; // 子 loop进入等待 provider或工具后的 thinking 阶段。
  onToken?: (token: string, draft: string) => void; // 子 assistant流式 token和完整草稿。
  onToolApprovalRequest?: (call: ToolCall, request?: ToolApprovalRequest) => Promise<ToolApprovalDecision> | ToolApprovalDecision; // 子 Bash人工单次审批请求。
  onToolCall?: (call: ToolCall) => void; // 子 provider产生的内部工具调用。
  onToolResult?: (result: ToolExecutionResult) => void; // 子内部工具执行后的稳定结果。
  onUserQuestionRequest?: (call: ToolCall, request: AskUserQuestionsRequest) => Promise<ToolExecutionResult> | ToolExecutionResult; // 子问题进入父 App 前的专属桥接。
  onWaitingApproval?: (call: ToolCall) => void; // 子 loop等待人工审批的瞬时阶段。
  onWaitingQuestion?: (call: ToolCall) => void; // 子 loop等待用户回答的瞬时阶段。
};

type RunSubagentAgent = (input: SubagentLoopInput, callbacks?: SubagentLoopCallbacks) => Promise<string>;
type SubagentLoopRuntimeFactory = (context: InheritedAgentRunContext, definition: SubagentDefinition) => RunSubagentAgent;

export type {
  InheritedAgentRunContext,
  RunSubagentAgent,
  SubagentLoopCallbacks,
  SubagentLoopInput,
  SubagentLoopRuntimeFactory
};
