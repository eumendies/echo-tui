import {createAgentLoopRuntime} from '../agent/agent-loop-runtime';
import {createTranscriptStore} from '../persistence/transcript-store';
import {createUsageStore} from '../persistence/usage-store';
import {readTuiTheme} from '../config/theme-config';
import {UserConfigContext} from '../config/user-config-context';
import {createDebugContext, summarizeText} from '../debug/debug-context';
import {createLifecycleHookDispatcher} from '../hooks/dispatcher';
import {McpManager, sanitizeMcpError} from '../mcp/manager';
import {createAppRenderer} from '../render/app-renderer';
import {runBashCommand} from '../tools/bash-command-runner';
import {createToolResultStore} from '../tools/tool-result-offloading';
import {setupTerminal} from '../terminal/tty';
import {createDefaultSlashCommandHandlers, createSlashCommandDescriptors, resolveSlashCommand} from '../commands/resolve-slash-command';
import {runAssistantTurn} from './assistant-turn-runner';
import {ComposerSubmissionController} from './composer-submission-controller';
import {InputEventController} from './input-event-controller';
import {createCommandHost} from './command/command-host';
import {createCommandRuntime} from './command/command-runtime';
import {AppContext} from './state/app-context';
import {FilePickerContext} from './state/file-picker-context';
import {ToolApprovalContext} from './state/tool-approval-context';
import {UserQuestionContext} from './state/user-question-context';
import {BtwConversationController} from './btw-conversation-controller';
import {createToolApprovalReviewer} from './tool-approval-resolver';

import type {RunAgent} from '../types/agent';
import type {AppController} from '../types/app';
import type {CommandSurface} from '../types/command';
import type {DebugContext} from '../debug/debug-context';
import type {LifecycleHookDispatcher} from '../types/hooks';
import type {AppendRecordOptions, RenderState} from '../types/render';
import type {TranscriptRecord} from '../types/transcript';
import type {UsageStore} from '../types/usage';
import type {AssistantTurnSubmission} from './composer-submission-controller';

/**
 * 创建 app 编排控制器，串联真实 terminal、input、render 和 agent runtime。
 */
function createApp(runAgent: RunAgent, mcpManager: McpManager, hooks: LifecycleHookDispatcher, debug: DebugContext, usageStore: UsageStore, userConfigContext: UserConfigContext): AppController {
  if (!userConfigContext) {
    throw new Error('createApp 必须注入共享的 UserConfigContext');
  }
  // app 层负责把 terminal、input、render 和 agent 串起来，不直接拼 ANSI 细节。
  const input = process.stdin;
  const output = process.stdout;
  const terminal = setupTerminal(input, output);
  const renderer = createAppRenderer(output);
  const transcriptStore = createTranscriptStore();
  const theme = readTuiTheme();

  // AppContext 只组合语义 context，具体状态由子 context 持有。
  const appContext = new AppContext(terminal, transcriptStore, process.cwd, process.version, theme, undefined, userConfigContext);
  const toolResultStore = createToolResultStore({cwd: () => appContext.getCurrentCwd()});
  let started = false;
  let initialRenderComplete = false;
  let activeShellController: AbortController | null = null;
  let mcpDiagnosticSurface: CommandSurface | null = null;
  let referenceErrorSurface: CommandSurface | null = null;
  const btwConversation = new BtwConversationController({
    runAgent,
    getParentSession: () => appContext.getAgentSession(),
    captureUserConfigSnapshot: () => appContext.captureUserConfigSnapshot(),
    getParentTurnState: () => ({
      pending: appContext.turnContext.getPending(),
      responding: appContext.turnContext.responding
    }),
    appendVisible: appendBtwRecords,
    renderFooter,
    repaint: renderResizeRecovery
  });
  // 活动重绘 timer 完全下沉到 turnContext；spinner 与高频 pending 共用这一刷新时钟。
  appContext.turnContext.configureSpinnerTimer({
    onTick: () => renderFooter()
  });

  /**
   * 组合 AppContext 与 command runtime 的瞬时状态，交给 renderer 统一投影。
   */
  function createRenderState(): RenderState {
    // 渲染投影优先展示 modal 和本地诊断 surface；输入消费顺序由 input controller 独立维护。
    const highPrioritySurface = userQuestion.getSurface() || toolApproval.getSurface() || filePicker.getSurface();
    // 本地诊断 surface 的输入优先级低于 command session；BTW 活跃时先隐藏，避免显示与输入所有者错位。
    const modalSurface = highPrioritySurface || (btwConversation.isActive() ? null : referenceErrorSurface || mcpDiagnosticSurface);
    const commandSurface = modalSurface || (btwConversation.isActive() ? null : commandRuntime.getSurface());
    const base = appContext.createRenderState({commandSurface, toolApproval});
    return btwConversation.isActive() ? btwConversation.createRenderState(base) : base;
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
    btwConversation.close();
    appContext.conversationReferenceContext.clear();
    userConfigContext.close();
    void mcpManager.close();
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
    if (btwConversation.isActive()) {
      // BTW 活跃时，只重绘 footer，不添加会话记录到主 transcript。
      renderFooter();
      return;
    }
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
    if (btwConversation.isActive()) {
      // BTW 活跃时，只重绘 footer，不添加会话记录到主 transcript。
      renderFooter();
      return;
    }
    renderer.appendRecords({
      records,
      ...createRenderState()
    });
    rememberTerminalSize();
  }

  /** 仅把 BTW 临时 records 追加到当前 BTW 投影，不触碰主 transcript。 */
  function appendBtwRecords(records: TranscriptRecord[]): void {
    if (!btwConversation.isActive() || records.length === 0) return;
    renderer.appendRecords({records, ...createRenderState()});
    rememberTerminalSize();
  }

  /**
   * 当列宽变化时执行 destructive full replay，并把 footer renderer 与当前可见 footer 同步。
   */
  function renderResizeRecovery(): void {
    debug.emit('resize_recovery', {
      recordCount: appContext.transcriptContext.records.length,
      terminalSize: terminal.getSize()
    });
    // 进入btw时使用destructive render，效果类似于新开了一个窗口，同时使用btw controller内存中保存的records
    renderer.renderDestructive({
      bannerContext: btwConversation.isActive()
        ? {...appContext.renderContext.createBannerContext(), variant: 'btw', parentActivity: btwConversation.getParentActivity()}
        : appContext.renderContext.createBannerContext(),
      records: btwConversation.isActive() ? btwConversation.getRecords() : appContext.transcriptContext.records,
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
    btw: {
      open: (initialQuestion) => btwConversation.open(initialQuestion),
      handleEvent: (event) => btwConversation.handleEvent(event),
      close: () => btwConversation.close()
    },
    exit,
    hooks,
    mcpManager,
    renderFooter,
    renderResizeRecovery,
    usageStore,
    userConfigContext
  });
  const toolApproval = new ToolApprovalContext(() => renderFooter());
  const toolApprovalReviewer = createToolApprovalReviewer({
    cwd: () => appContext.getCurrentCwd(),
    debug,
    usageStore
  });
  const userQuestion = new UserQuestionContext(() => renderFooter());
  const filePicker = new FilePickerContext(appContext.composerContext.composer, {
    cwd: () => appContext.getCurrentCwd(),
    onChange: () => renderFooter(),
    rows: () => terminal.getSize().rows
  });
  const slashCommandHandlers = createDefaultSlashCommandHandlers(
    () => userConfigContext.capture().getAppSettings().agentInstructionFileName
  );
  const commandRuntime = createCommandRuntime({
    resolveSlashCommand: (text: string) => resolveSlashCommand(text, slashCommandHandlers),
    host: commandHost
  });
  const submissionController = new ComposerSubmissionController({
    appContext,
    command: {
      hasActiveSession: commandRuntime.hasActiveSession,
      matches: (text: string) => Boolean(resolveSlashCommand(text, slashCommandHandlers)),
      startFromText: commandRuntime.startFromText
    },
    reference: commandHost.reference,
    async startAssistantTurn(submission: AssistantTurnSubmission): Promise<void> {
      debug.emit('user_submit', {
        interactionMode: appContext.getInteractionMode(),
        text: summarizeText(submission.userText, 0),
        displayText: submission.displayText ? summarizeText(submission.displayText, 0) : undefined,
        attachmentCount: submission.attachments?.length || 0,
        recordCount: appContext.transcriptContext.records.length
      });
      await runAssistantTurn({
        appContext,
        runAgent,
        toolApproval,
        toolApprovalReviewer,
        userQuestion,
        ...submission,
        debug,
        appendRecord,
        appendRecords,
        hooks,
        renderFooter
      });
    },
    submitShellCommand,
    showReferenceError(error: string): void {
      referenceErrorSurface = {
        kind: 'info',
        title: '会话引用准备失败',
        lines: [error],
        dismissHint: 'Enter/Esc 关闭'
      };
    },
    renderFooter
  });
  const inputController = new InputEventController({
    appContext,
    userQuestion,
    toolApproval,
    filePicker,
    command: commandRuntime,
    localSurface: {
      hasActive: () => Boolean(referenceErrorSurface || mcpDiagnosticSurface),
      dismiss(): void {
        if (referenceErrorSurface) {
          referenceErrorSurface = null;
        } else {
          mcpDiagnosticSurface = null;
        }
      }
    },
    cancelReferencePreparation: () => {
      commandHost.reference.cancelPreparation();
    },
    dispatchPendingMessage: () => submissionController.dispatchPendingMessage(),
    submitComposer: () => submissionController.submitComposer(),
    interruptActiveShellCommand,
    interruptActiveTurn,
    exit,
    renderFooter
  });

  appContext.configureSlashSuggestions(
    () => [...createSlashCommandDescriptors(slashCommandHandlers), ...commandHost.skills.listEnabledSkillDescriptors()]
      .filter((descriptor, index, descriptors) => descriptors.findIndex((item) => item.name === descriptor.name) === index),
    () => commandRuntime.hasActiveSession()
  );

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
    void submissionController.dispatchPendingMessage();

    return true;
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
      userConfigContext.subscribe((change) => {
        const modelChanged = change.domains.llm ? appContext.applyModelConfigSnapshot(change.snapshot) : false;
        const settingsRefresh = change.domains.appSettings
          ? appContext.applyAppSettingsSnapshot(change.snapshot)
          : null;

        if ((change.domains.llm && !modelChanged) || change.domains.tools) {
          appContext.clearContextUsage();
        }
        if (!initialRenderComplete) {
          return;
        }
        if (settingsRefresh?.reasoningVisibilityChanged) {
          renderResizeRecovery();
        } else if (modelChanged || settingsRefresh?.slashSuggestionLimitChanged) {
          renderFooter();
        }
      });
      userConfigContext.startWatching(
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
    initialRenderComplete = true;

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
      input.on('data', inputController.handleChunk);
    }

    if (typeof output.on === 'function') {
      output.on('resize', handleResize);
    }
  }

  return {
    exit,
    handleChunk: inputController.handleChunk,
    handleEvent: inputController.handleEvent,
    renderFooter,
    renderResizeRecovery,
    start
  };
}

/**
 * 启动整个 TUI 应用，串联终端初始化、输入事件、渲染和真实 LLM agent 生命周期。
 */
function run(): void {
  // TUI 组合根只创建一个用户配置来源，并把同一实例注入所有消费者。
  const cwd = process.cwd();
  const userConfigContext = new UserConfigContext();
  const mcpManager = new McpManager({loadConfig: () => userConfigContext.capture().getMcpConfig()});
  const debug = createDebugContext({cwd});
  const usageStore = createUsageStore();
  const hooks = createLifecycleHookDispatcher({
    config: userConfigContext.capture().getLifecycleHookConfig(),
    cwd
  });

  createApp(
    createAgentLoopRuntime(cwd, userConfigContext, mcpManager, hooks, debug, usageStore),
    mcpManager,
    hooks,
    debug,
    usageStore,
    userConfigContext
  ).start();
}

export {
  createApp,
  run
};
