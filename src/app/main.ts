import {createAgentLoopRuntime} from '../agent/loop-runtime/agent-loop-runtime';
import {createTranscriptStore} from '../persistence/transcript-store';
import {createUsageStore} from '../persistence/usage-store';
import {readTuiTheme} from '../config/theme-config';
import {readPackageVersion} from '../config/package-version';
import {UserConfigContext} from '../config/user-config-context';
import {createDebugContext} from '../debug/debug-context';
import {createLifecycleHookDispatcher} from '../hooks/dispatcher';
import {createObservation} from '../observation/observation-projector';
import {McpManager, sanitizeMcpError} from '../mcp/manager';
import {createAppRenderer} from '../render/app-renderer';
import {runBashCommand} from '../tools/bash-command-runner';
import {createToolResultStore} from '../tools/tool-result-offloading';
import {getText} from '../input/composer';
import {checkForUpdate} from '../update/update-check';
import {runUpdateAndRestart} from '../update/update-runner';
import {getDefaultUpdateStatePath, readUpdateState, writeUpdateState} from '../update/update-state';
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
import {SubagentViewController} from './subagent-view-controller';
import {createToolApprovalReviewer} from './tool-approval/resolver';
import {AutoUpdateController} from './auto-update-controller';
import {FooterPointerController} from './footer-pointer-controller';

import type {RunAgent} from '../types/agent';
import type {AppController} from '../types/app';
import type {CommandSurface} from '../types/command';
import type {LifecycleHookDispatcher} from '../types/hooks';
import type {AssistantTurnScope, Observation} from '../observation/observation';
import type {FooterPointerSnapshot, RenderState} from '../types/render';
import type {TranscriptRecord} from '../types/transcript';
import type {UsageStore} from '../types/usage';
import type {UpdateCheckResult} from '../update/update-check';
import type {AssistantTurnSubmission} from './composer-submission-controller';

const ACTIVITY_REDRAW_INTERVAL_MS = 100;
// 自动弹出的提示要求最近没有输入，避免与"刚按下 Enter / 正在打字"的用户竞争。
const AUTO_UPDATE_INPUT_IDLE_MS = 1000;

type UpdateAppDependencies = {
  applyUpdate?: (latestVersion: string) => Promise<number>; // 前台更新与重启替换缝；缺省执行真实 npm 全局安装
  checkUpdate?: () => Promise<UpdateCheckResult>; // 启动检查替换缝；缺省访问 npm registry
};

/**
 * 创建 app 编排控制器，串联真实 terminal、input、render 和 agent runtime。
 */
function createApp(runAgent: RunAgent, mcpManager: McpManager, hooks: LifecycleHookDispatcher, observation: Observation, usageStore: UsageStore, userConfigContext: UserConfigContext, updateDependencies: UpdateAppDependencies = {}): AppController {
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
  let footerPointer: FooterPointerController | null = null;
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

  // subagent 会话窗口：按 runId 过滤主 transcript 的只读全屏投影；优先级低于 modal、高于 BTW。
  const subagentView = new SubagentViewController({
    getRecords: () => appContext.transcriptContext.records,
    getActivity: (runId) => appContext.subagentRunContext.getActivity(runId),
    hasActiveRuns: () => appContext.subagentRunContext.hasTimedActivity(),
    repaint: renderResizeRecovery
  });

  /**
   * 组合 AppContext 与 command runtime 的瞬时状态，交给 renderer 统一投影。
   */
  function createRenderState(): RenderState {
    // 渲染投影优先展示 modal 和本地诊断 surface；输入消费顺序由 input controller 独立维护。
    const highPrioritySurface = getActiveModalSurface();
    // 当前 owner 接管 footer 输入区时，主会话专属 surface 必须让位，避免显示与输入所有者错位。
    const owner = currentOwner();
    const modalSurface = highPrioritySurface || (owner === 'main' ? referenceErrorSurface || mcpDiagnosticSurface : null);
    const commandSurface = modalSurface || (owner === 'main' ? commandRuntime.getSurface() : null);
    const base = appContext.createRenderState({commandSurface, toolApproval});
    if (owner === 'view') {
      return subagentView.createRenderState({...base, streamingOwner: 'view'});
    }
    return owner === 'btw'
      ? btwConversation.createRenderState({...base, streamingOwner: 'btw'})
      : {...base, streamingOwner: 'main'};
  }

  /** 用户问题、工具审批、文件选择与更新提示按优先级取第一个激活的 modal 表面;激活时 footer 输入区为静态卡片。 */
  function getActiveModalSurface(): CommandSurface | null {
    return userQuestion.getSurface() || toolApproval.getSurface() || filePicker.getSurface() || autoUpdate.getSurface() || null;
  }

  /** 当前接管可见投影的 owner；view 优先于 btw，都不活跃时为 main。 */
  function currentOwner(): 'view' | 'btw' | 'main' {
    if (subagentView.isActive()) {
      return 'view';
    }
    return btwConversation.isActive() ? 'btw' : 'main';
  }

  /**
   * 停止消费 stdin 与 resize 事件并暂停 stdin；更新流程收尾后终端要交给前台子进程，
   * 父进程必须让出输入，也避免 resize 触发对 npm 输出或重启进程画面的破坏性重绘。
   */
  function detachTerminalListeners(): void {
    if (typeof input.off === 'function') {
      input.off('data', inputController.handleChunk);
    }

    if (typeof output.off === 'function') {
      output.off('resize', handleResize);
    }

    // terminal.cleanup 的 pause 只覆盖"启动前已暂停"的情况；这里显式停止 libuv 对 fd 0 的轮询。
    input.pause();
  }

  /**
   * 停止周期任务、关闭视图与资源并恢复终端状态；exit 与前台更新流程共用，不终止进程。
   */
  function shutdown(): void {
    observation.appExiting({cwd: appContext.getCurrentCwd(), interactionMode: appContext.getInteractionMode()});
    activeShellController?.abort();
    if (activityTimer) clearInterval(activityTimer);
    activityTimer = null;
    detachTerminalListeners();
    subagentView.close();
    btwConversation.close();
    appContext.conversationReferenceContext.clear();
    userConfigContext.close();
    void mcpManager.close();
    appContext.turnContext.stopSpinner();
    footerPointer?.dispose();
    renderer.clearFooter();
    terminal.cleanup();
    output.write('\n');
    observation.close();
  }

  /**
   * 停止 spinner、渲染最终 transcript，并在退出前恢复终端状态。
   */
  function exit(): void {
    shutdown();
    process.exit(0);
  }

  /** 提交流式稳定前缀、按需完成当前流式 record，并重绘当前可见 owner 的 footer。 */
  function render(
    finalizeRecord?: Extract<TranscriptRecord, {role: 'assistant' | 'reasoning_summary'}>,
    owner?: 'main' | 'btw'
  ): void {
    const visibleOwner = currentOwner();
    const renderState = createRenderState();
    const snapshot = renderer.render(renderState, owner === undefined || owner === visibleOwner ? finalizeRecord : undefined);
    updateFooterPointer(snapshot);
    rememberTerminalSize();
  }

  /** 将已经实际写入终端的 footer frame 同步给鼠标控制器，并按当前交互 surface 启停报告模式。 */
  function updateFooterPointer(snapshot: FooterPointerSnapshot | undefined): void {
    if (!snapshot) {
      return;
    }
    footerPointer?.update(snapshot);
  }

  /**
   * 常驻 timer 仅在当前可见 owner 有计时活动时触发统一渲染;modal 表面激活时跳过周期重绘,
   * 避免等待输入期间整帧擦写静态卡片造成频闪。
   */
  function renderTimedActivity(): void {
    // 更新提示复用同一 tick 尝试呈现；门控不满足时保持待命，不额外引入轮询 timer。
    autoUpdate.tick();
    const owner = currentOwner();
    const hasTimedActivity = owner === 'view'
      ? subagentView.hasTimedActivity()
      : owner === 'btw'
        ? btwConversation.hasTimedActivity()
        : appContext.turnContext.hasTimedActivity() || appContext.subagentRunContext.hasTimedActivity();
    if (!hasTimedActivity) {
      return;
    }

    // 用户问题/工具审批/文件选择挂起时 spinner 状态行并不展示,周期重绘没有可见变化,只会整帧擦写高多行卡片造成频闪;按键路径仍会即时 render()。
    if (getActiveModalSurface()) {
      return;
    }

    render();
  }

  /** 渲染指定 owner 已经写入会话状态的普通 records，并保留 tool pair 批处理。 */
  function renderRecords(records: TranscriptRecord[], owner: 'main' | 'btw'): void {
    if (records.length === 0) return;
    if (owner === 'main') {
      observation.transcriptBatchRendered({records});
    }

    // 窗口活跃时命中当前 run 的新记录用 destructive 重绘刷新 body；其余批次只刷新 footer。
    if (subagentView.isActive()) {
      if (subagentView.containsRunRecords(records)) {
        renderResizeRecovery();
      } else {
        render();
      }
      return;
    }

    // 递归到这里 subagent 窗口一定未激活；owner 只可能是 btw 或 main。
    const visibleOwner = currentOwner();
    if (owner !== visibleOwner) {
      render();
      return;
    }

    const renderState = createRenderState();
    const snapshot = renderer.renderRecords({records, ...renderState});
    updateFooterPointer(snapshot);
    rememberTerminalSize();
  }

  /**
   * 当列宽变化时清屏重绘完整界面，并同步 footer 的当前布局。
   */
  function renderResizeRecovery(): void {
    observation.resizeRecovered({recordCount: appContext.transcriptContext.records.length, terminalSize: terminal.getSize()});
    const owner = currentOwner();
    const renderState = createRenderState();
    // 窗口/BTW/主会话三态重绘；窗口投影当前 run 的稳定记录，流式 draft 由 footer pending 呈现。
    // 窗口的 banner 与主会话形态相同，只有 BTW 需要 variant 覆盖。
    const snapshot = renderer.renderDestructive({
      bannerContext: owner === 'btw'
        ? {...appContext.renderContext.createBannerContext(), variant: 'btw', parentActivity: btwConversation.getParentActivity()}
        : appContext.renderContext.createBannerContext(),
      records: owner === 'view' ? subagentView.getViewRecords() : owner === 'btw' ? btwConversation.getRecords() : appContext.transcriptContext.records,
      skipParallelSubagentFilter: owner === 'view',
      ...renderState
    });
    updateFooterPointer(snapshot);
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
      open: (initialQuestion) => {
        // /btw 与 subagent 会话窗口互斥；打开临时会话前先静默关闭窗口。
        subagentView.close();
        btwConversation.open(initialQuestion);
      },
      handleEvent: (event) => btwConversation.handleEvent(event),
      close: () => btwConversation.close()
    },
    exit,
    hooks,
    mcpManager,
    render,
    renderResizeRecovery,
    submitUserMessage: (input) => submissionController.submitCommandMessage(input),
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
  const autoUpdate = new AutoUpdateController({
    applyUpdate: updateDependencies.applyUpdate || ((latestVersion) => runUpdateAndRestart({latestVersion})),
    canPresent: canPresentAutoUpdate,
    checkUpdate: updateDependencies.checkUpdate || (() => checkForUpdate({
      configEnabled: userConfigContext.capture().getAppSettings().checkUpdatesOnStartup,
      currentVersion: readPackageVersion()
    })),
    exit: (code) => process.exit(code),
    persistIgnoredVersion,
    render: () => render(),
    shutdown
  });
  const slashCommandHandlers = createDefaultSlashCommandHandlers(
    () => userConfigContext.capture().getAppSettings().agentInstructionFileName,
    () => commandHost.mcp.listPrompts()
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
  // 测试和嵌入方可注入较小的旧 TerminalController；缺少协议能力时保持纯键盘路径。
  if (typeof terminal.setMouseTracking === 'function' && typeof terminal.requestCursorPosition === 'function') {
    footerPointer = new FooterPointerController({
      appContext,
      filePicker,
      render,
      terminal,
      toolApproval,
      userQuestion
    });
  }
  const inputController = new InputEventController({
    appContext,
    userQuestion,
    toolApproval,
    filePicker,
    autoUpdate,
    subagentView,
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
    render,
    ...(footerPointer ? {pointer: footerPointer} : {})
  });

  appContext.configureSlashSuggestions(
    () => [
      ...createSlashCommandDescriptors(slashCommandHandlers),
      ...commandHost.skills.listEnabledSkillDescriptors(),
      ...commandHost.mcp.listPromptCommands()
    ]
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
    appContext.turnContext.beginShellCommand(command, includeInContext);
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

    if (result.interruptedToolRecords) {
      renderRecords(result.interruptedToolRecords, 'main');
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
   * 空闲门控：任何会接管 footer、消费输入或打断用户的活动活跃时都不适合呈现更新提示；
   * 条件不满足时等待下一个 activity tick 重试，不降级为 toast 或 transcript 记录。
   */
  function canPresentAutoUpdate(): boolean {
    if (currentOwner() !== 'main' || getActiveModalSurface() || commandRuntime.hasActiveSession()) {
      return false;
    }

    if (appContext.modelTuningContext.isActive() || referenceErrorSurface || mcpDiagnosticSurface) {
      return false;
    }

    if (appContext.getMcpBootstrapStatus() !== 'ready') {
      return false;
    }

    if (activeShellController || appContext.turnContext.responding) {
      return false;
    }

    if (appContext.pendingMessageContext.getPending()) {
      return false;
    }

    if (appContext.conversationReferenceContext.getPending() || appContext.conversationReferenceContext.isPreparing()) {
      return false;
    }

    if (getText(appContext.composerContext.composer).trim() !== '') {
      return false;
    }

    return Date.now() - inputController.getLastInputAt() >= AUTO_UPDATE_INPUT_IDLE_MS;
  }

  /** 记录忽略版本；写入失败降级为仅本次会话忽略，不打扰用户。 */
  function persistIgnoredVersion(version: string): void {
    try {
      const statePath = getDefaultUpdateStatePath();
      writeUpdateState({...readUpdateState(statePath), ignoredVersion: version}, statePath);
    } catch {
      // 状态文件不可写时只保留会话级忽略。
    }
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
    const renderState = createRenderState();
    const snapshot = renderer.renderInitial({
      bannerContext: appContext.renderContext.createBannerContext(),
      ...renderState
    });
    updateFooterPointer(snapshot);
    rememberTerminalSize();
    initialRenderComplete = true;
    activityTimer = setInterval(renderTimedActivity, ACTIVITY_REDRAW_INTERVAL_MS);
    autoUpdate.start();

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
