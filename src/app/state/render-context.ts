import path from 'node:path';

import type {TerminalController} from '../../types/app';
import type {CommandSurface} from '../../types/command';
import type {InteractionMode} from '../../types/agent';
import type {BannerContext, PendingState, RenderState, SlashSuggestionState, StatusLineMode, StatusLineModelRenderState, StatusLineState, WorkingState} from '../../types/render';
import type {TuiTheme} from '../../config/theme-config';

type ContextUsageState = StatusLineState['contextUsage'];

type ComposerStateOwner = {
  composer: RenderState['composer'];
};

type TurnStateOwner = {
  canInterruptAssistantTurn: () => boolean;
  getPending: () => PendingState | null;
  getWorking: () => WorkingState | null;
};

type BootstrapStateOwner = {
  getMcpBootstrapStatus: () => 'idle' | 'initializing' | 'ready';
};

/**
 * 管理 banner 和 footer 所需的派生渲染状态。
 */
class RenderContext {
  terminal: TerminalController;
  getCurrentCwd: () => string;
  getNodeVersion: () => string;
  composerContext: ComposerStateOwner;
  turnContext: TurnStateOwner;
  bootstrapStateOwner: BootstrapStateOwner;
  getInteractionMode: () => InteractionMode;
  theme: TuiTheme;
  previousColumns: number;
  previousRows: number;

  constructor(
    terminal: TerminalController,
    getCurrentCwd: () => string,
    getNodeVersion: () => string,
    composerContext: ComposerStateOwner,
    turnContext: TurnStateOwner,
    bootstrapStateOwner: BootstrapStateOwner,
    getInteractionMode: () => InteractionMode,
    theme: TuiTheme
  ) {
    this.terminal = terminal;
    this.getCurrentCwd = getCurrentCwd;
    this.getNodeVersion = getNodeVersion;
    this.composerContext = composerContext;
    this.turnContext = turnContext;
    this.bootstrapStateOwner = bootstrapStateOwner;
    this.getInteractionMode = getInteractionMode;
    this.theme = theme;
    const terminalSize = this.terminal.getSize();
    this.previousColumns = terminalSize.columns;
    this.previousRows = terminalSize.rows;
  }

  /**
   * 生成 banner 所需的运行时上下文，避免渲染层直接依赖 process 全局状态。
   */
  createBannerContext(): BannerContext {
    return {
      cwd: this.getCurrentCwd(),
      nodeVersion: this.getNodeVersion(),
      terminalSize: this.terminal.getSize(),
      mode: 'current terminal'
    };
  }

  /**
   * 组合渲染层需要的瞬时状态，避免 main.ts 反复散落访问实例字段。
   */
  createRenderState(options: {allowAllTools?: boolean; commandSurface?: CommandSurface | null; contextUsage?: ContextUsageState | null; model?: StatusLineModelRenderState; slashSuggestions?: SlashSuggestionState | null} = {}): RenderState {
    const terminalSize = this.terminal.getSize();
    const commandSurface = options.commandSurface ?? null;
    const slashSuggestions = options.slashSuggestions ?? null;
    const pending = this.turnContext.getPending();
    const working = this.turnContext.getWorking();

    return {
      composer: this.composerContext.composer,
      commandSurface,
      slashSuggestions,
      pending,
      working,
      theme: this.theme,
      statusLine: commandSurface ? undefined : this.createStatusLineState(options.model, pending, working, slashSuggestions, options.contextUsage ?? null, options.allowAllTools || false),
      rows: terminalSize.rows,
      width: terminalSize.columns
    };
  }

  /**
   * 根据当前普通 composer 上下文派生 status line；command surface 使用自身提示，不创建全局状态栏。
   */
  private createStatusLineState(model: StatusLineModelRenderState | undefined, pending: PendingState | null, working: WorkingState | null, slashSuggestions: SlashSuggestionState | null, contextUsage: ContextUsageState | null, allowAllTools: boolean): StatusLineState {
    const mode = this.bootstrapStateOwner.getMcpBootstrapStatus() === 'initializing'
      ? 'mcp'
      : resolveStatusLineMode(pending, slashSuggestions, this.getInteractionMode());
    const normalizedModel: StatusLineModelRenderState = model
      ? {...model, label: model.label.trim() !== '' ? model.label : 'model unavailable'}
      : {kind: 'default', label: 'model unavailable'};
    const keyHint = resolveStatusLineKeyHint(
      mode,
      this.turnContext.canInterruptAssistantTurn(),
      Boolean(working)
    );

    return {
      projectName: path.basename(this.getCurrentCwd()) || this.getCurrentCwd(),
      model: normalizedModel,
      mode,
      ...(allowAllTools ? {allowAllTools: true} : {}),
      ...(contextUsage ? {contextUsage} : {}),
      detail: pending && pending.kind === 'tool_call' ? pending.toolName : undefined,
      activity: working ? {kind: 'working', elapsedMs: working.elapsedMs} : pending?.kind === 'thinking' ? {kind: 'thinking', elapsedMs: pending.elapsedMs} : undefined,
      ...(keyHint ? {keyHint} : {})
    };
  }
}

function resolveStatusLineKeyHint(mode: StatusLineMode, canInterruptAssistantTurn: boolean, hasWorkingState: boolean): string | undefined {
  if (mode === 'command') {
    return 'Tab 补全 · Enter 执行 · ↑/↓ 选择';
  }

  if (canInterruptAssistantTurn || hasWorkingState && (mode === 'shell' || mode === 'shell-local')) {
    return 'Esc 中断';
  }

  return undefined;
}

function resolveStatusLineMode(pending: PendingState | null, slashSuggestions: SlashSuggestionState | null, interactionMode: InteractionMode): StatusLineMode {
  if (pending?.kind === 'thinking') {
    if (interactionMode !== 'normal') {
      return interactionMode;
    }

    return 'thinking';
  }

  if (pending?.kind === 'streaming') {
    if (interactionMode !== 'normal') {
      return interactionMode;
    }

    return 'streaming';
  }

  if (pending?.kind === 'tool_call') {
    return 'tool';
  }

  if (slashSuggestions) {
    return 'command';
  }

  if (interactionMode !== 'normal') {
    return interactionMode;
  }

  return 'idle';
}

export {
  RenderContext
};
