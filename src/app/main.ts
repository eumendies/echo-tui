import {createAgentLoopRuntime} from '../agent/agent-loop-runtime';
import * as composerOps from '../input/composer';
import {INPUT_EVENTS} from '../input/event-types';
import {createKeyParser} from '../input/key-parser';
import {createTranscriptStore} from '../persistence/transcript-store';
import {createUsageStore} from '../persistence/usage-store';
import {readTuiTheme} from '../config/theme-config';
import {createDebugContext, summarizeText} from '../debug/debug-context';
import {readLifecycleHookConfig} from '../hooks/config';
import {watchUserConfig} from '../config/user-config';
import {createLifecycleHookDispatcher} from '../hooks/dispatcher';
import {McpManager, sanitizeMcpError} from '../mcp/manager';
import {createAppRenderer} from '../render/app-renderer';
import {runBashCommand} from '../tools/bash-command-runner';
import {createToolResultStore} from '../tools/tool-result-offloading';
import {setupTerminal} from '../terminal/tty';
import {createDefaultSlashCommandHandlers, createSlashCommandDescriptors, resolveSlashCommand} from '../commands/resolve-slash-command';
import {expandFileMentionsForUserText} from './utils';
import {runAssistantTurn} from './assistant-turn-runner';
import {createCommandHost} from './command/command-host';
import {createCommandRuntime} from './command/command-runtime';
import {AppContext} from './state/app-context';
import {FilePickerContext} from './state/file-picker-context';
import {ToolApprovalContext} from './state/tool-approval-context';
import {UserQuestionContext} from './state/user-question-context';

import {isShellInteractionMode} from '../types/agent';
import type {RunAgent} from '../types/agent';
import type {AppController} from '../types/app';
import type {CommandSurface} from '../types/command';
import type {DebugContext} from '../debug/debug-context';
import type {LifecycleHookDispatcher} from '../types/hooks';
import type {InputEvent} from '../types/input';
import type {ToolResultAttachment} from '../types/tool';
import type {AppendRecordOptions, RenderState} from '../types/render';
import type {TranscriptRecord} from '../types/transcript';
import type {UsageStore} from '../types/usage';
import type {UserConfigWatcher} from '../config/user-config';

/**
 * 创建 app 编排控制器，串联真实 terminal、input、render 和 agent runtime。
 */
function createApp(runAgent: RunAgent, mcpManager: McpManager, hooks: LifecycleHookDispatcher, debug: DebugContext, usageStore: UsageStore): AppController {
  // app 层负责把 terminal、input、render 和 agent 串起来，不直接拼 ANSI 细节。
  const input = process.stdin;
  const output = process.stdout;
  const terminal = setupTerminal(input, output);
  const keyParser = createKeyParser();
  const renderer = createAppRenderer(output);
  const transcriptStore = createTranscriptStore();
  const theme = readTuiTheme();

  // AppContext 只组合语义 context，具体状态由子 context 持有。
  const appContext = new AppContext(terminal, transcriptStore, process.cwd, process.version, theme);
  const toolResultStore = createToolResultStore({cwd: () => appContext.getCurrentCwd()});
  let started = false;
  let activeShellController: AbortController | null = null;
  let mcpDiagnosticSurface: CommandSurface | null = null;
  let userConfigWatcher: UserConfigWatcher | null = null;
  // spinner 的 timer 完全下沉到 turnContext；main 仅注入 footer 重绘回调。
  appContext.turnContext.configureSpinnerTimer({
    onTick: () => renderFooter()
  });
  appContext.turnContext.configureStreamingRenderTimer({
    onRender: () => renderFooter()
  });

  /**
   * 组合 AppContext 与 command runtime 的瞬时状态，交给 renderer 统一投影。
   */
  function createRenderState(): RenderState {
    // 判断当前是否有命令 surface打开，优先级：user question -> tool approval -> file picker -> mcp diagnostic -> command runtime surface
    const commandSurface = userQuestion.getSurface() || toolApproval.getSurface() || filePicker.getSurface() || mcpDiagnosticSurface || commandRuntime.getSurface();
    return appContext.createRenderState({commandSurface, toolApproval});
  }

  /**
   * 停止 spinner、渲染最终 transcript，并在退出前恢复终端状态。
   */
  function exit(): void {
    debug.emit('app_exit', {
      cwd: appContext.getCurrentCwd(),
      interactionMode: appContext.getInteractionMode()
    });
    activeShellController?.abort();
    userConfigWatcher?.close();
    userConfigWatcher = null;
    void mcpManager.close();
    appContext.turnContext.cancelStreamingRender();
    appContext.turnContext.stopSpinner();
    renderer.clearFooter();
    terminal.cleanup();
    output.write('\n');
    debug.close();
    process.exit(0);
  }

  /**
   * 只重绘 footer 临时区域，不重新输出 banner 或 transcript。
   */
  function renderFooter(): void {
    renderer.renderFooter(createRenderState());
    rememberTerminalSize();
  }

  /**
   * transcript 发生事实新增时，交给 app renderer 统一执行 clear footer / append / redraw。
   */
  function appendRecord(record: TranscriptRecord): void {
    debug.emit('transcript_append', {
      role: record.role,
      text: summarizeText(record.text, 0)
    });
    renderer.appendRecord({
      record,
      ...createRenderState()
    } as AppendRecordOptions);
    rememberTerminalSize();
  }

  /**
   * transcript 成组新增时一次性 append，确保相邻 tool call/result 可共享渲染状态。
   */
  function appendRecords(records: TranscriptRecord[]): void {
    debug.emit('transcript_append_batch', {
      count: records.length,
      roles: records.map((record) => record.role)
    });
    renderer.appendRecords({
      records,
      ...createRenderState()
    });
    rememberTerminalSize();
  }

  /**
   * 当列宽变化时执行 destructive full replay，并把 footer renderer 与当前可见 footer 同步。
   */
  function renderResizeRecovery(): void {
    appContext.turnContext.cancelStreamingRender();
    debug.emit('resize_recovery', {
      recordCount: appContext.transcriptContext.records.length,
      terminalSize: terminal.getSize()
    });
    renderer.renderDestructive({
      bannerContext: appContext.renderContext.createBannerContext(),
      records: appContext.transcriptContext.records,
      ...createRenderState()
    });
    rememberTerminalSize();
  }

  /**
   * 记录上一次成功绘制时的终端尺寸，用于判断后续 resize 是否需要完整恢复。
   */
  function rememberTerminalSize(): void {
    const terminalSize = terminal.getSize();
    appContext.renderContext.previousColumns = terminalSize.columns;
    appContext.renderContext.previousRows = terminalSize.rows;
  }

  /**
   * 根据终端尺寸变化决定是否需要 destructive replay；行数压缩时旧 footer 可能已进入 scrollback。
   */
  function handleResize(): void {
    const terminalSize = terminal.getSize();

    if (terminalSize.columns !== appContext.renderContext.previousColumns || terminalSize.rows < appContext.renderContext.previousRows) {
      renderResizeRecovery();
      return;
    }

    rememberTerminalSize();
  }

  const commandHost = createCommandHost({
    appContext,
    appendRecord,
    exit,
    hooks,
    mcpManager,
    renderFooter,
    renderResizeRecovery,
    usageStore
  });
  const toolApproval = new ToolApprovalContext(() => renderFooter());
  const userQuestion = new UserQuestionContext(() => renderFooter());
  const filePicker = new FilePickerContext(appContext.composerContext.composer, {
    cwd: () => appContext.getCurrentCwd(),
    onChange: () => renderFooter(),
    rows: () => terminal.getSize().rows
  });
  const slashCommandHandlers = createDefaultSlashCommandHandlers();
  const commandRuntime = createCommandRuntime({
    resolveSlashCommand: (text: string) => resolveSlashCommand(text, slashCommandHandlers),
    host: commandHost
  });

  appContext.configureSlashSuggestions(
    () => [...createSlashCommandDescriptors(slashCommandHandlers), ...commandHost.skills.listEnabledSkillDescriptors()]
      .filter((descriptor, index, descriptors) => descriptors.findIndex((item) => item.name === descriptor.name) === index),
    () => commandRuntime.hasActiveSession()
  );

  /**
   * 按方向浏览 session 输入历史；返回是否消费了本次 Up/Down。
   */
  function browseHistory(direction: number): boolean {
    return appContext.composerContext.browseHistory(direction);
  }

  /**
   * 提交 composer 内容，追加 user record，并驱动 agent 的 thinking / streaming / completion 状态。
   */
  async function submitComposer(): Promise<void> {
    // response lock 阻止重复提交；空输入也不写 transcript。
    if (commandRuntime.hasActiveSession() || appContext.turnContext.responding || appContext.getMcpBootstrapStatus() === 'initializing' || composerOps.isEmpty(appContext.composerContext.composer)) {
      renderFooter();
      return;
    }

    let userText = composerOps.getText(appContext.composerContext.composer);
    const commandResult = commandRuntime.startFromText(userText);

    if (commandResult.kind === 'handled') {
      return;
    }

    let displayText: string | undefined;
    let userMetadata: Record<string, unknown> | undefined;
    let userAttachments: ToolResultAttachment[] | undefined;
    let modelProfileId: string | undefined;

    if (commandResult.kind === 'not_matched' && isShellInteractionMode(appContext.getInteractionMode())) {
      return submitShellCommand(userText);
    }

    if (commandResult.kind === 'submit_user_message') {
      userText = commandResult.text;
      displayText = commandResult.displayText;
      userMetadata = commandResult.metadata;
      modelProfileId = commandResult.modelProfileId;
    }

    const expanded = await expandFileMentionsForUserText(userText, appContext.getCurrentCwd());
    if (expanded.text !== userText || expanded.attachments) {
      displayText = displayText || userText;
      userText = expanded.text;
      userAttachments = expanded.attachments;
    }

    debug.emit('user_submit', {
      interactionMode: appContext.getInteractionMode(),
      text: summarizeText(userText, 0),
      displayText: displayText ? summarizeText(displayText, 0) : undefined,
      attachmentCount: userAttachments?.length || 0,
      recordCount: appContext.transcriptContext.records.length
    });

    return runAssistantTurn({
      appContext,
      runAgent,
      toolApproval,
      userQuestion,
      userText,
      displayText,
      metadata: userMetadata,
      modelProfileId,
      attachments: userAttachments,
      debug,
      appendRecord,
      appendRecords,
      hooks,
      renderFooter
    });
  }

  /**
   * shell 模式执行 composer 命令；普通 shell 保留 bounded context，shell-local 把完整结果写入本地 transcript。
   */
  async function submitShellCommand(command: string): Promise<void> {
    const shellController = new AbortController();
    const includeInContext = appContext.getInteractionMode() === 'shell';
    activeShellController = shellController;
    appContext.turnContext.beginShellCommand(command);
    appContext.turnContext.startSpinner('working');
    renderFooter();

    try {
      const result = await runBashCommand({
        abortSignal: shellController.signal,
        command,
        cwd: appContext.getCurrentCwd(),
        maxOutputBytes: includeInContext ? undefined : null,
        onOutput(event) {
          appContext.turnContext.appendShellOutputPending(event);
          appContext.turnContext.scheduleStreamingRender();
        },
        timeoutMs: null,
        toolResultStore: includeInContext ? toolResultStore : undefined
      });
      appendRecord(appContext.turnContext.finishShellCommand(result, includeInContext));
    } catch (error: unknown) {
      appendRecord(appContext.turnContext.failShellCommand(error));
    } finally {
      if (activeShellController === shellController) {
        activeShellController = null;
      }
    }
  }

  /**
   * 中断当前 shell mode 进程；输出收尾仍等待 runner 的 close 事件生成最终 shell record。
   */
  function interruptActiveShellCommand(): boolean {
    if (!activeShellController || activeShellController.signal.aborted) {
      return false;
    }

    activeShellController.abort();
    return true;
  }

  /**
   * 中断当前普通 assistant turn；modal/command surface 的 Esc 消费在调用前已完成。
   */
  function interruptActiveTurn(): boolean {
    appContext.turnContext.cancelStreamingRender();
    const result = appContext.interruptActiveAssistantTurn();

    if (!result.interrupted) {
      return false;
    }

    if (result.partialRecord) {
      appendRecord(result.partialRecord);
    }

    if (result.noticeRecord) {
      appendRecord(result.noticeRecord);
    }
    hooks.emit('assistant_turn_cancelled', {
      interactionMode: appContext.getInteractionMode(),
      status: 'cancelled'
    });

    return true;
  }

  /**
   * 分发输入事件到对应的 composer 编辑、提交或退出逻辑。
   */
  function handleEvent(event: InputEvent): Promise<void> | void {
    if (userQuestion.hasActiveRequest()) {
      userQuestion.handleEvent(event);
      return undefined;
    }

    if (toolApproval.hasActiveRequest()) {
      toolApproval.handleEvent(event);
      return undefined;
    }

    if (filePicker.hasActiveRequest()) {
      filePicker.handleEvent(event);
      return undefined;
    }

    if (commandRuntime.hasActiveSession()) {
      return commandRuntime.handleEvent(event);
    }

    if (mcpDiagnosticSurface) {
      if (event.type === INPUT_EVENTS.EXIT) {
        exit();
        return undefined;
      }

      if (event.type === INPUT_EVENTS.ESCAPE || event.type === INPUT_EVENTS.SUBMIT) {
        mcpDiagnosticSurface = null;
        renderFooter();
      }

      return undefined;
    }

    if (event.type === INPUT_EVENTS.SHIFT_TAB) {
      toolApproval.toggleAllowAllForSession();
      return undefined;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === '@' && !isShellInteractionMode(appContext.getInteractionMode())) {
      appContext.composerContext.leaveHistoryBrowsing();
      composerOps.insertText(appContext.composerContext.composer, '@');
      filePicker.open(appContext.composerContext.composer.cursor - 1);
      return undefined;
    }

    if (appContext.getMcpBootstrapStatus() !== 'initializing' && appContext.handleSlashSuggestionEvent(event)) {
      renderFooter();
      return undefined;
    }

    if (event.type === INPUT_EVENTS.TAB) {
      if (!appContext.turnContext.responding && appContext.getMcpBootstrapStatus() !== 'initializing') {
        appContext.cycleInteractionMode();
      }
      renderFooter();
      return undefined;
    }

    if (composerOps.applyComposerEditEvent(appContext.composerContext.composer, event)) {
      appContext.composerContext.leaveHistoryBrowsing();
      renderFooter();
      return undefined;
    }

    switch (event.type) {
      case INPUT_EVENTS.MOVE_UP:
        if (!browseHistory(-1)) {
          composerOps.moveUp(appContext.composerContext.composer);
        }
        renderFooter();
        return undefined;
      case INPUT_EVENTS.MOVE_DOWN:
        if (!browseHistory(1)) {
          composerOps.moveDown(appContext.composerContext.composer);
        }
        renderFooter();
        return undefined;
      case INPUT_EVENTS.INSERT_NEWLINE:
        appContext.composerContext.leaveHistoryBrowsing();
        composerOps.insertNewline(appContext.composerContext.composer);
        renderFooter();
        return undefined;
      case INPUT_EVENTS.ESCAPE:
        if (interruptActiveShellCommand()) {
          return undefined;
        }

        if (interruptActiveTurn()) {
          return undefined;
        }

        return undefined;
      case INPUT_EVENTS.SUBMIT:
        return submitComposer();
      case INPUT_EVENTS.EXIT:
        exit();
        return undefined;
      default:
        return undefined;
    }
  }

  function handleChunk(chunk: string | Buffer): Promise<void> {
    const pendingWork: Array<Promise<void>> = [];

    for (const event of keyParser.parse(chunk)) {
      const result = handleEvent(event);

      if (result) {
        pendingWork.push(result);
      }
    }

    return Promise.all(pendingWork).then(() => undefined);
  }

  /**
   * 启动 app 并注册输入/resize 事件监听。
   */
  function start(): void {
    if (started) {
      return;
    }

    started = true;
    try {
      userConfigWatcher = watchUserConfig(
        () => {
          if (appContext.refreshModelStateFromConfig()) {
            renderFooter();
          }
        },
        (error) => debug.emit('user_config_watch_error', {error: {name: error.name, message: error.message}})
      );
    } catch (error: unknown) {
      debug.emit('user_config_watch_error', {
        error: error instanceof Error ? {name: error.name, message: error.message} : {message: String(error)}
      });
    }
    if (debug.enabled && debug.logPath) {
      output.write(`[debug] logging to ${debug.logPath}\n`);
    }
    debug.emit('app_start', {
      cwd: appContext.getCurrentCwd(),
      logPath: debug.logPath,
      nodeVersion: appContext.getNodeVersion(),
      pid: process.pid,
      terminalSize: terminal.getSize()
    });
    renderer.renderInitial({
      bannerContext: appContext.renderContext.createBannerContext(),
      ...createRenderState()
    });
    rememberTerminalSize();

    if (mcpManager) {
      appContext.setMcpBootstrapStatus('initializing');
      appContext.turnContext.startSpinner('working');
      renderFooter();
      void mcpManager.bootstrap().catch((error: unknown) => {
        mcpDiagnosticSurface = {kind: 'info', title: 'MCP initialization', lines: [`bootstrap: ${sanitizeMcpError(error)}`], dismissHint: 'Enter/Esc close'};
      }).then(() => {
        appContext.turnContext.stopSpinner();
        appContext.turnContext.clearWorking();
        appContext.setMcpBootstrapStatus('ready');
        const diagnostics = mcpManager.getDiagnostics();

        if (!mcpDiagnosticSurface && diagnostics.length > 0) {
          mcpDiagnosticSurface = {kind: 'info', title: 'MCP initialization', lines: diagnostics.map((diagnostic) => `${diagnostic.serverName}: ${diagnostic.message}`), dismissHint: 'Enter/Esc close'};
        }

        renderFooter();
      });
    } else {
      appContext.setMcpBootstrapStatus('ready');
    }

    if (typeof input.on === 'function') {
      input.on('data', handleChunk);
    }

    if (typeof output.on === 'function') {
      output.on('resize', handleResize);
    }
  }

  return {
    exit,
    handleChunk,
    handleEvent,
    renderFooter,
    renderResizeRecovery,
    start
  };
}

/**
 * 启动整个 TUI 应用，串联终端初始化、输入事件、渲染和真实 LLM agent 生命周期。
 */
function run(): void {
  // agent loop 每轮通过 prepareAgent 按最新配置装配 provider 与工具。
  const cwd = process.cwd();
  const mcpManager = new McpManager();
  const debug = createDebugContext({cwd});
  const usageStore = createUsageStore();
  const hooks = createLifecycleHookDispatcher({
    config: readLifecycleHookConfig(),
    cwd
  });

  createApp(createAgentLoopRuntime(cwd, mcpManager, hooks, debug, usageStore), mcpManager, hooks, debug, usageStore).start();
}

export {
  createApp,
  run
};
