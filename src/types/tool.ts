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

export type GlobToolExecutionResult = ToolExecutionResultBase & {
  toolName: 'glob';
  details: {
    kind: 'glob';
    exitCode?: number | null;
    truncated: boolean;
  };
};

export type GrepToolExecutionResult = ToolExecutionResultBase & {
  toolName: 'grep';
  details: {
    kind: 'grep';
    exitCode?: number | null;
    truncated: boolean;
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
    display?: ToolResultDisplayMetadata;
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
