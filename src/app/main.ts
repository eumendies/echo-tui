import {createAgentLoopRuntime} from '../agent/loop-runtime/agent-loop-runtime';
import {createTranscriptStore} from '../persistence/transcript-store';
import {createUsageStore} from '../persistence/usage-store';
import {readTuiTheme} from '../config/theme-config';
import {UserConfigContext} from '../config/user-config-context';
import {createDebugContext} from '../debug/debug-context';
import {createLifecycleHookDispatcher} from '../hooks/dispatcher';
import {createObservation} from '../observation/observation-projector';
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
import {createToolApprovalReviewer} from './tool-approval/resolver';

import type {RunAgent} from '../types/agent';
import type {AppController} from '../types/app';
import type {CommandSurface} from '../types/command';
import type {LifecycleHookDispatcher} from '../types/hooks';
import type {AssistantTurnScope, Observation} from '../observation/observation';
import type {RenderState} from '../types/render';
import type {TranscriptRecord} from '../types/transcript';
import type {UsageStore} from '../types/usage';
import type {AssistantTurnSubmission} from './composer-submission-controller';

const ACTIVITY_REDRAW_INTERVAL_MS = 100;

/**
 * 创建 app 编排控制器，串联真实 terminal、input、render 和 agent runtime。
 */
function createApp(runAgent: RunAgent, mcpManager: McpManager, hooks: LifecycleHookDispatcher, observation: Observation, usageStore: UsageStore, userConfigContext: UserConfigContext): AppController {
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
  let activityTimer: NodeJS.Timeout | null = null;
  let activeShellController: AbortController | null = null;
  let mcpDiagnosticSurface: CommandSurface | null = null;
  let referenceErrorSurface: CommandSurface | null = null;
  let activeTurnObservationScope: AssistantTurnScope | null = null;
  const btwConversation = new BtwConversationController({
    runAgent,
    getParentSession: () => appContext.getAgentSession(),
    captureUserConfigSnapshot: () => appContext.captureUserConfigSnapshot(),
    getParentTurnState: () => ({
      pending: appContext.turnContext.getPending(),
      responding: appContext.turnContext.responding
    }),
    render: (finalizeRecord) => render(finalizeRecord, 'btw'),
    renderRecords: (records) => renderRecords(records, 'btw'),
    repaint: renderResizeRecovery
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
    return btwConversation.isActive()
      ? btwConversation.createRenderState({...base, streamingOwner: 'btw'})
      : {...base, streamingOwner: 'main'};
  }

  /**
   * 停止 spinner、渲染最终 transcript，并在退出前恢复终端状态。
   */
  function exit(): void {
    observation.appExiting({cwd: appContext.getCurrentCwd(), interactionMode: appContext.getInteractionMode()});
    activeShellController?.abort();
    if (activityTimer) clearInterval(activityTimer);
    activityTimer = null;
    btwConversation.close();
    appContext.conversationReferenceContext.clear();
    userConfigContext.close();
    void mcpManager.close();
    appContext.turnContext.stopSpinner();
    renderer.clearFooter();
    terminal.cleanup();
    output.write('\n');
    observation.close();
    process.exit(0);
  }

  /** 提交流式稳定前缀、按需完成当前流式 record，并重绘当前可见 owner 的 footer。 */
  function render(
    finalizeRecord?: Extract<TranscriptRecord, {role: 'assistant' | 'reasoning_summary'}>,
    owner?: 'main' | 'btw'
  ): void {
    const visibleOwner = btwConversation.isActive() ? 'btw' : 'main';
    renderer.render(createRenderState(), owner === undefined || owner === visibleOwner ? finalizeRecord : undefined);
    rememberTerminalSize();
  }

  /** 常驻 timer 仅在当前可见 owner 有计时活动时触发统一渲染。 */
  function renderTimedActivity(): void {
    const hasTimedActivity = btwConversation.isActive()
      ? btwConversation.hasTimedActivity()
      : appContext.turnContext.hasTimedActivity() || appContext.subagentRunContext.hasTimedActivity();
    if (hasTimedActivity) render();
  }

  /** 渲染指定 owner 已经写入会话状态的普通 records，并保留 tool pair 批处理。 */
  function renderRecords(records: TranscriptRecord[], owner: 'main' | 'btw'): void {
    if (records.length === 0) return;
    if (owner === 'main') {
      observation.transcriptBatchRendered({records});
    }

    const visibleOwner = btwConversation.isActive() ? 'btw' : 'main';
    if (owner !== visibleOwner) {
      render();
      return;
    }

    renderer.renderRecords({records, ...createRenderState()});
    rememberTerminalSize();
  }

  /**
   * 当列宽变化时清屏重绘完整界面，并同步 footer 的当前布局。
   */
  function renderResizeRecovery(): void {
    observation.resizeRecovered({recordCount: appContext.transcriptContext.records.length, terminalSize: terminal.getSize()});
    const btwActive = btwConversation.isActive();
    const renderState = createRenderState();
    // BTW 活跃时重画临时会话，否则重画主会话；流式显示进度由 renderer 同步。
    renderer.renderDestructive({
      bannerContext: btwActive
        ? {...appContext.renderContext.createBannerContext(), variant: 'btw', parentActivity: btwConversation.getParentActivity()}
        : appContext.renderContext.createBannerContext(),
      records: btwActive ? btwConversation.getRecords() : appContext.transcriptContext.records,
      ...renderState
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
   * 根据终端尺寸变化决定是否需要清屏重绘；行数压缩时旧 footer 可能已经进入终端历史区。
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
    renderRecords: (records) => renderRecords(records, 'main'),
    btw: {
      open: (initialQuestion) => btwConversation.open(initialQuestion),
      handleEvent: (event) => btwConversation.handleEvent(event),
      close: () => btwConversation.close()
    },
    exit,
    hooks,
    mcpManager,
    render,
    renderResizeRecovery,
    usageStore,
    userConfigContext
  });
  const toolApproval = new ToolApprovalContext(() => render());
  const toolApprovalReviewer = createToolApprovalReviewer({
    cwd: () => appContext.getCurrentCwd(),
    usageStore
  });
  const userQuestion = new UserQuestionContext(() => render());
  const filePicker = new FilePickerContext(appContext.composerContext.composer, {
    cwd: () => appContext.getCurrentCwd(),
    onChange: () => render(),
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
      const turnObservationScope: AssistantTurnScope = {interactionMode: appContext.getInteractionMode(), runtimeKind: 'tui'};
      activeTurnObservationScope = turnObservationScope;
      observation.userSubmitted({
        interactionMode: appContext.getInteractionMode(),
        text: submission.userText,
        displayText: submission.displayText,
        attachmentCount: submission.attachments?.length || 0,
        recordCount: appContext.transcriptContext.records.length
      });
      try {
        await runAssistantTurn({
          appContext,
          runAgent,
          toolApproval,
          toolApprovalReviewer,
          userQuestion,
          ...submission,
          observation,
          observationScope: turnObservationScope,
          renderRecords: (records) => renderRecords(records, 'main'),
          render: (finalizeRecord) => render(finalizeRecord, 'main')
        });
      } finally {
        if (activeTurnObservationScope === turnObservationScope) activeTurnObservationScope = null;
      }
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
    render
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
    render
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
    render();

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
      renderRecords([appContext.turnContext.finishShellCommand(result, includeInContext)], 'main');
    } catch (error: unknown) {
      renderRecords([appContext.turnContext.failShellCommand(error)], 'main');
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

    if (result.reasoningRecord) {
      render(result.reasoningRecord, 'main');
    }

    if (result.partialRecord) {
      render(result.partialRecord, 'main');
    }

    if (result.noticeRecord) {
      renderRecords([result.noticeRecord], 'main');
    }
    if (activeTurnObservationScope) observation.assistantTurnCancelled({scope: activeTurnObservationScope});
    activeTurnObservationScope = null;
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
          render();
        }
      });
      userConfigContext.startWatching(
        (error) => observation.configurationWatchFailed({error})
      );
    } catch (error: unknown) {
      observation.configurationWatchFailed({error});
    }
    observation.appStarted({
      scope: {cwd: appContext.getCurrentCwd(), nodeVersion: appContext.getNodeVersion(), pid: process.pid},
      terminalSize: terminal.getSize()
    });
    renderer.renderInitial({
      bannerContext: appContext.renderContext.createBannerContext(),
      ...createRenderState()
    });
    rememberTerminalSize();
    initialRenderComplete = true;
    activityTimer = setInterval(renderTimedActivity, ACTIVITY_REDRAW_INTERVAL_MS);

    if (mcpManager) {
      appContext.setMcpBootstrapStatus('initializing');
      appContext.turnContext.startSpinner('working');
      render();
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

        render();
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
    render,
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
  const observation = createObservation(debug, hooks, process.stdout);

  createApp(
    createAgentLoopRuntime(cwd, userConfigContext, mcpManager, observation, usageStore),
    mcpManager,
    hooks,
    observation,
    usageStore,
    userConfigContext
  ).start();
}

export {
  createApp,
  run
};
