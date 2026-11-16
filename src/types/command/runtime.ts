import type {SandboxModeOverride} from '../../sandbox/types';
import type {AgentToolPolicy, ReasoningEffort} from '../agent';
import type {InputEvent, MouseWheelDirection} from '../input';
import type {FooterMouseTarget, FooterWheelPane} from '../render';
import type {UserTranscriptMetadata} from '../transcript';
import type {CommandHostApp} from './host';
import type {CommandSurface} from './surface';

export type CommandHostSession = {
  open<TData extends object = Record<string, unknown>>(session: CommandSession<TData>): void;
  update<TData extends object = Record<string, unknown>>(patch: CommandSessionPatch<TData>): void;
  close(): void;
  getActive(): CommandSession | null;
};

export type CommandHost = CommandHostApp & {
  session: CommandHostSession;
};

export type CommandHandler<TData extends object = Record<string, unknown>> = {
  name?: string;
  description?: string;
  allowDuringAssistantTurn?: boolean; // 指示该 handler 是否可与 active assistant turn 并行启动。
  match?(text: string): boolean;
  start(text: string, host: CommandHost): void | CommandStartResult;
  handleEvent?(session: CommandSession<TData>, event: InputEvent, host: CommandHost): void | Promise<void>;
  handlePointer?(session: CommandSession<TData>, target: FooterMouseTarget, activate: boolean, host: CommandHost): void | Promise<void>; // 已完成 footer frame 与 consumer 校验的语义命中；handler 负责验证 target 是否适用于当前 session。
  handleWheel?(session: CommandSession<TData>, pane: FooterWheelPane, direction: MouseWheelDirection, host: CommandHost): void | Promise<void>; // 仅接收已校验的滚轮栏位与方向；handler 不应将滚轮作为点击或确认。
};

export type CommandStartResult =
  | {kind: 'not_matched'}
  | {kind: 'handled'}
  | {kind: 'submit_user_message'; text: string; displayText?: string; metadata?: UserTranscriptMetadata; modelProfileId?: string; reasoningEffortOverride?: ReasoningEffort; toolPolicy?: AgentToolPolicy; sandboxModeOverride?: SandboxModeOverride};

export type CommandStartOptions = {
  duringAssistantTurn?: boolean; // 指示本次启动发生于仍可中断的 active assistant turn。
};

export type MatchableCommandHandler<TData extends object = Record<string, unknown>> =
  CommandHandler<TData> & {
    match(text: string): boolean;
  };

export type CommandSession<TData extends object = Record<string, unknown>> = {
  commandName: string;
  handler: CommandHandler<TData>;
  surface: CommandSurface;
  data: TData | null;
};

export type CommandSessionPatch<TData extends object = Record<string, unknown>> = {
  surface?: CommandSurface;
  data?: TData | null;
};

export type ResolveSlashCommand = (text: string) => CommandHandler | null;

export type CommandRuntimeDependencies = {
  resolveSlashCommand: ResolveSlashCommand;
  host: CommandHostApp;
};
