import type {SkillCatalogEntry} from './skill';
import type {ChangeFileRecorder} from './change-history';

export const SUPPORTED_TOOL_RESULT_IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export type SupportedToolResultImageMediaType = typeof SUPPORTED_TOOL_RESULT_IMAGE_MEDIA_TYPES[number];

export function isSupportedToolResultImageMediaType(mediaType: string): mediaType is SupportedToolResultImageMediaType {
  return (SUPPORTED_TOOL_RESULT_IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType);
}

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolCall = {
  callId: string;
  toolName: string;
  argumentsText: string;
};

export type ToolApprovalRequest = {
  preview?: string; // 人工 surface 展示的受信任本地动作摘要。
  previewTitle?: string; // preview 代码块或消息块的短标题。
  origin?: {
    kind: 'subagent'; // 标识该审批由受控子 Agent 的内部工具调用触发。
    agentName: string; // 发起内部调用的子 Agent 稳定名称。
    runId: string; // 关联当前子 Agent 运行，供迟到请求隔离。
  };
};

export type ToolRiskAssessment =
  | {risk: 'safe'}
  | {risk: 'approval_required'; approval?: ToolApprovalRequest}
  | {risk: 'rejected'; message: string; reason?: 'plan_mode' | 'readonly_policy'};

export type FileEditDisplayLine = {
  kind: 'context' | 'removed' | 'added';
  text: string;
  postLine: number | null;
};

export type FileEditDisplayFile = {
  path: string;
  kind: 'added' | 'updated' | 'deleted';
  lines: FileEditDisplayLine[];
};

export type FileEditDisplayKind = 'apply_patch' | 'edit_file';

export type FileEditDisplayMetadata<Kind extends FileEditDisplayKind> = {
  kind: Kind;
  files: FileEditDisplayFile[];
};

export type ApplyPatchDisplayLine = FileEditDisplayLine;
export type ApplyPatchDisplayFile = FileEditDisplayFile;
export type ApplyPatchDisplayMetadata = FileEditDisplayMetadata<'apply_patch'>;
export type EditFileDisplayMetadata = FileEditDisplayMetadata<'edit_file'>;
export type ToolResultDisplayMetadata = ApplyPatchDisplayMetadata | EditFileDisplayMetadata;

export type ToolResultImageAttachment = {
  kind: 'image';
  mediaType: SupportedToolResultImageMediaType;
  dataBase64: string;
  path: string;
  sizeBytes: number;
};

export type ToolResultAttachment = ToolResultImageAttachment;

type ToolExecutionResultBase = {
  callId: string;
  toolName: string;
  ok: boolean;
  text: string;
  attachments?: ToolResultAttachment[];
};

export type GenericToolExecutionResult = ToolExecutionResultBase & {
  details: {kind: 'generic'};
};

export type BashToolExecutionResult = ToolExecutionResultBase & {
  toolName: 'run_bash_command';
  details: {
    kind: 'bash';
    exitCode?: number | null;
    timedOut?: boolean;
    truncated?: boolean;
    durationMs?: number;
  };
};

export type GlobDisplayMetadata = {
  kind: 'glob'; // 标识该 metadata 只能供 glob 专属终端投影使用。
  paths: string[]; // handler 实际保留的有序文件路径，不代表截断后的完整结果集。
};

export type GlobToolExecutionResult = ToolExecutionResultBase & {
  toolName: 'glob';
  details: {
    kind: 'glob';
    exitCode?: number | null;
    truncated: boolean;
    display?: GlobDisplayMetadata; // 只供终端投影和会话重放使用，不进入 provider-visible 文本。
  };
};

export type GrepDisplayMatch = {
  column: number; // ripgrep 返回的 1-based 首个命中列号。
  line: number; // 命中所在文件的 1-based 行号。
  path: string; // 相对或绝对命中文件路径，保持 handler 返回顺序中的原值。
  text: string; // 去除末尾换行后的完整命中逻辑行文本。
};

export type GrepDisplayMetadata = {
  kind: 'grep'; // 标识该 metadata 只能供 grep 专属终端投影使用。
  matches: GrepDisplayMatch[]; // handler 实际保留的有序匹配项，不代表截断后的完整总数。
};

export type GrepToolExecutionResult = ToolExecutionResultBase & {
  toolName: 'grep';
  details: {
    kind: 'grep';
    exitCode?: number | null;
    truncated: boolean;
    display?: GrepDisplayMetadata; // 只供终端投影和会话重放使用，不进入 provider-visible 文本。
  };
};

export type ReadFilesToolExecutionResult = ToolExecutionResultBase & {
  toolName: 'read_files';
  details: {
    kind: 'read_files';
    truncated: boolean;
  };
};

export type WebFetchToolExecutionResult = ToolExecutionResultBase & {
  toolName: 'web_fetch';
  details: {
    kind: 'web_fetch';
    timedOut: boolean;
    truncated: boolean;
  };
};

export type WebSearchToolExecutionResult = ToolExecutionResultBase & {
  toolName: 'web_search';
  details: {
    kind: 'web_search';
    timedOut: boolean;
    truncated: boolean;
  };
};

export type ApplyPatchToolExecutionResult = ToolExecutionResultBase & {
  toolName: 'apply_patch';
  details: {
    kind: 'apply_patch';
    display?: ApplyPatchDisplayMetadata;
  };
};

export type EditFileToolExecutionResult = ToolExecutionResultBase & {
  toolName: 'edit_file';
  details: {
    kind: 'edit_file';
    display?: EditFileDisplayMetadata;
  };
};

export type AskUserQuestionsOption = {
  label: string;
  description?: string;
};

export type AskUserQuestion = {
  question: string;
  multiSelect?: boolean;
  options: AskUserQuestionsOption[];
};

export type AskUserQuestionsRequest = {
  questions: AskUserQuestion[];
};

export type AskUserQuestionsSingleAnswer = {
  question: string;
  multiSelect?: false;
  selectedOption: AskUserQuestionsOption;
  customText?: string;
};

export type AskUserQuestionsMultiAnswer = {
  question: string;
  multiSelect: true;
  selectedOptions: AskUserQuestionsOption[];
  customText?: string;
};

export type AskUserQuestionsAnswer = AskUserQuestionsSingleAnswer | AskUserQuestionsMultiAnswer;

export type AskUserQuestionsToolExecutionResult = GenericToolExecutionResult & {
  toolName: 'ask_user_questions';
};

export type UseSkillToolExecutionResult = GenericToolExecutionResult & {
  toolName: 'use_skill';
};

export type ToolExecutionResult =
  | GenericToolExecutionResult
  | BashToolExecutionResult
  | GlobToolExecutionResult
  | GrepToolExecutionResult
  | ReadFilesToolExecutionResult
  | WebFetchToolExecutionResult
  | WebSearchToolExecutionResult
  | ApplyPatchToolExecutionResult
  | EditFileToolExecutionResult
  | AskUserQuestionsToolExecutionResult
  | UseSkillToolExecutionResult;

export type ToolExecutionOptions = {
  abortSignal?: AbortSignal;
  changeRecorder?: ChangeFileRecorder;
};

export type ToolHandler = {
  definition: ToolDefinition; // 暴露给 provider并用于 registry查找的工具 schema。
  execute: (args: Record<string, unknown>, call: ToolCall, options?: ToolExecutionOptions) => Promise<ToolExecutionResult> | ToolExecutionResult; // 在统一 executor 边界内执行已解析参数。
  transcriptCommitMode?: 'call_before_execute' | 'pair_after_execute'; // 声明工具执行期间是否会先发布本地 transcript 记录。
};

export type ToolRegistry = {
  listDefinitions: () => ToolDefinition[];
  listSkillCatalog?: () => SkillCatalogEntry[];
  getHandler: (name: string) => ToolHandler | undefined;
  isEmpty: () => boolean;
};

export type ToolExecutor = {
  execute: (call: ToolCall, options?: ToolExecutionOptions) => Promise<ToolExecutionResult>;
};
