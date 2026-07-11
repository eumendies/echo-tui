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
  preview?: string;
  previewTitle?: string;
};

export type ToolRiskAssessment =
  | {risk: 'safe'}
  | {risk: 'approval_required'; approval?: ToolApprovalRequest}
  | {risk: 'rejected'; message: string; reason?: 'plan_mode'};

export type ApplyPatchDisplayLine = {
  kind: 'context' | 'removed' | 'added';
  text: string;
  postLine: number | null;
};

export type ApplyPatchDisplayFile = {
  path: string;
  kind: 'added' | 'updated' | 'deleted';
  lines: ApplyPatchDisplayLine[];
};

export type ToolResultDisplayMetadata = {
  kind: 'apply_patch';
  files: ApplyPatchDisplayFile[];
};

export type ToolResultImageAttachment = {
  kind: 'image';
  mediaType: SupportedToolResultImageMediaType;
  dataBase64: string;
  path: string;
  sizeBytes: number;
};

export type ToolResultAttachment = ToolResultImageAttachment;

export type BaseToolExecutionResult = {
  callId: string;
  toolName: string;
  ok: boolean;
  text: string;
  attachments?: ToolResultAttachment[];
};

export type BashToolExecutionResult = BaseToolExecutionResult & {
  toolName: 'run_bash_command';
  exitCode?: number | null;
  timedOut?: boolean;
  truncated?: boolean;
  durationMs?: number;
};

export type GlobToolExecutionResult = BaseToolExecutionResult & {
  toolName: 'glob';
  exitCode?: number | null;
  truncated: boolean;
};

export type GrepToolExecutionResult = BaseToolExecutionResult & {
  toolName: 'grep';
  exitCode?: number | null;
  truncated: boolean;
};

export type ReadFilesToolExecutionResult = BaseToolExecutionResult & {
  toolName: 'read_files';
  truncated: boolean;
};

export type WebFetchToolExecutionResult = BaseToolExecutionResult & {
  toolName: 'web_fetch';
  timedOut: boolean;
  truncated: boolean;
};

export type WebSearchToolExecutionResult = BaseToolExecutionResult & {
  toolName: 'web_search';
  timedOut: boolean;
  truncated: boolean;
};

export type ApplyPatchToolExecutionResult = BaseToolExecutionResult & {
  toolName: 'apply_patch';
  display?: ToolResultDisplayMetadata;
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

export type AskUserQuestionsToolExecutionResult = BaseToolExecutionResult & {
  toolName: 'ask_user_questions';
};

export type UseSkillToolExecutionResult = BaseToolExecutionResult & {
  toolName: 'use_skill';
};

export type ToolExecutionResult =
  | BaseToolExecutionResult
  | BashToolExecutionResult
  | GlobToolExecutionResult
  | GrepToolExecutionResult
  | ReadFilesToolExecutionResult
  | WebFetchToolExecutionResult
  | WebSearchToolExecutionResult
  | ApplyPatchToolExecutionResult
  | AskUserQuestionsToolExecutionResult
  | UseSkillToolExecutionResult;

export type ToolExecutionOptions = {
  abortSignal?: AbortSignal;
  changeRecorder?: ChangeFileRecorder;
};

export type ToolHandler = {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>, call: ToolCall, options?: ToolExecutionOptions) => Promise<ToolExecutionResult> | ToolExecutionResult;
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
