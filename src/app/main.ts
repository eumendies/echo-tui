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
import {createActiveInputRouting} from './active-input-resolver';
import {FooterPointerController} from './footer-pointer-controller';
import {createRenderCoordinator} from './render-coordinator';

import type {RunAgent} from '../types/agent';
import type {AppController} from '../types/app';
import type {CommandSurface} from '../types/command';
import type {LifecycleHookDispatcher} from '../types/hooks';
import type {AssistantTurnScope, Observation} from '../observation/observation';
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
  let lifecycle: 'created' | 'running' | 'stopped' = 'created';
  let initialRenderComplete = false;
  let activityTimer: NodeJS.Timeout | null = null;
  let unsubscribeConfig: (() => void) | null = null;
  let mcpBootstrapTask: Promise<void> | null = null;
  let activeShellController: AbortController | null = null;
  let mcpDiagnosticSurface: CommandSurface | null = null;
  let referenceErrorSurface: CommandSurface | null = null;
  let activeTurnObservationScope: AssistantTurnScope | null = null;
  let footerPointer: FooterPointerController | null = null;
  const toolApproval = new ToolApprovalContext(() => renderCoordinator.render());
  const btwConversation = new BtwConversationController({
    runAgent,
    getParentSession: () => appContext.getAgentSession(),
    captureUserConfigSnapshot: () => appContext.captureUserConfigSnapshot(),
    getParentTurnState: () => ({
      pending: appContext.turnContext.getPending(),
      responding: appContext.turnContext.responding
    }),
    render: (finalizeRecord) => renderCoordinator.render(finalizeRecord, 'btw'),
    renderRecords: (records) => renderCoordinator.renderRecords(records, 'btw'),
    repaint: () => renderCoordinator.renderResizeRecovery()
  });

  // subagent 会话窗口：按 runId 过滤主 transcript 的只读全屏投影；优先级低于 modal、高于 BTW。
  const subagentView = new SubagentViewController({
    getRecords: () => appContext.transcriptContext.records,
    getActivity: (runId) => appContext.subagentRunContext.getActivity(runId),
    hasActiveRuns: () => appContext.subagentRunContext.hasTimedActivity(),
    repaint: () => renderCoordinator.renderResizeRecovery()
  });

  // 输入路由与鼠标控制器稍后装配；渲染只在首次输入/绘制时读取它们。
  const renderCoordinator = createRenderCoordinator({
    appContext,
    btwConversation,
    getActiveInputResolver: () => activeInputResolver,
    getFooterPointer: () => footerPointer,
    isStopped: () => lifecycle === 'stopped',
    observation,
    renderer,
    subagentView,
    terminal,
    toolApproval
  });

  /**
   * 停止消费 stdin 与 resize 事件并暂停 stdin；更新流程收尾后终端要交给前台子进程，
   * 父进程必须让出输入，也避免 resize 触发对 npm 输出或重启进程画面的破坏性重绘。
   */
  function detachTerminalListeners(): void {
    if (typeof input.off === 'function') {
      input.off('data', inputController.handleChunk);
    }

    if (typeof output.off === 'function') {
      output.off('resize', renderCoordinator.handleResize);
    }

    // terminal.cleanup 的 pause 只覆盖"启动前已暂停"的情况；这里显式停止 libuv 对 fd 0 的轮询。
    input.pause();
  }

  /**
   * 将 app 标记为不可重启后清理监听、周期任务、异步连接与终端；重复调用不再次释放资源。
   * exit 与前台更新流程共用，不在此终止进程。
   */
  function shutdown(): void {
    if (lifecycle === 'stopped') return;
    // 先使所有回调失效，再释放资源；异步 bootstrap 完成时也不得重新投影已交还的终端。
    lifecycle = 'stopped';
    observation.appExiting({cwd: appContext.getCurrentCwd(), interactionMode: appContext.getInteractionMode()});
    activeShellController?.abort();
    if (activityTimer) clearInterval(activityTimer);
    activityTimer = null;
    detachTerminalListeners();
    unsubscribeConfig?.();
    unsubscribeConfig = null;
    subagentView.close();
    btwConversation.close();
    appContext.conversationReferenceContext.clear();
    userConfigContext.close();
    void mcpManager.close();
    // bootstrap 可能在 close 后才接入新 server；完成时再关闭一次，避免遗留连接。
    if (mcpBootstrapTask) void mcpBootstrapTask.then(() => mcpManager.close());
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

  /** 先推进自动更新的空闲提示，再由渲染协调器决定当前 owner 是否需要计时重绘。 */
  function tickActivity(): void {
    if (lifecycle === 'stopped') return;
    autoUpdate.tick();
    renderCoordinator.renderTimedActivity();
  }

  // 其余交互状态在命令与提交控制器之前建立；组装期间不处理输入。
  const toolApprovalReviewer = createToolApprovalReviewer({
    cwd: () => appContext.getCurrentCwd(),
    usageStore
  });
  const userQuestion = new UserQuestionContext(() => renderCoordinator.render());
  const filePicker = new FilePickerContext(appContext.composerContext.composer, {
    columns: () => terminal.getSize().columns,
    cwd: () => appContext.getCurrentCwd(),
    onChange: () => renderCoordinator.render(),
    rows: () => terminal.getSize().rows
  });

  // 命令可提交普通消息，因此 commandHost 的回调在实际执行命令时才访问下方的 submissionController。
  const commandHost = createCommandHost({
    appContext,
    renderRecords: (records) => renderCoordinator.renderRecords(records, 'main'),
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
    render: renderCoordinator.render,
    renderResizeRecovery: renderCoordinator.renderResizeRecovery,
    submitUserMessage: (input) => submissionController.submitCommandMessage(input),
    usageStore,
    userConfigContext
  });
  const slashCommandHandlers = createDefaultSlashCommandHandlers(
    () => userConfigContext.capture().getAppSettings().agentInstructionFileName,
    () => commandHost.mcp.listPrompts()
  );
  const commandRuntime = createCommandRuntime({
    resolveSlashCommand: (text: string) => resolveSlashCommand(text, slashCommandHandlers),
    host: commandHost
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

  // 提交控制器是命令消息与普通 composer 的共同入口，依赖已组装的 commandRuntime。
  const submissionController = new ComposerSubmissionController({
    appContext,
    command: {
      hasActiveSession: commandRuntime.hasActiveSession,
      matches: (text: string) => Boolean(resolveSlashCommand(text, slashCommandHandlers)),
      startFromText: commandRuntime.startFromText
    },
    reference: commandHost.reference,
    startAssistantTurn: startMainAssistantTurn,
    submitShellCommand,
    showReferenceError(error: string): void {
      referenceErrorSurface = {
        kind: 'info',
        title: '会话引用准备失败',
        lines: [error],
        dismissHint: 'Enter/Esc 关闭'
      };
    },
    render: renderCoordinator.render
  });

  // 更新提示由启动后的 activity tick 驱动；其空闲门控届时才读取下方的输入路由与时间戳。
  const autoUpdate = new AutoUpdateController({
    applyUpdate: updateDependencies.applyUpdate || ((latestVersion) => runUpdateAndRestart({latestVersion})),
    canPresent: canPresentAutoUpdate,
    checkUpdate: updateDependencies.checkUpdate || (() => checkForUpdate({
      configEnabled: userConfigContext.capture().getAppSettings().checkUpdatesOnStartup,
      currentVersion: readPackageVersion()
    })),
    exit: (code) => process.exit(code),
    persistIgnoredVersion,
    render: () => renderCoordinator.render(),
    shutdown
  });

  // 输入优先级、鼠标命中和 key parser 最后接线；只有 start() 完成组装后才注册终端监听。
  const activeInputResolver = createActiveInputRouting({
    appContext,
    autoUpdate,
    cancelReferencePreparation: () => commandHost.reference.cancelPreparation(),
    command: commandRuntime,
    dispatchPendingMessage: () => submissionController.dispatchPendingMessage(),
    exit,
    filePicker,
    localSurface: {
      dismiss(): void {
        if (referenceErrorSurface) {
          referenceErrorSurface = null;
        } else {
          mcpDiagnosticSurface = null;
        }
      },
      getSurface: () => referenceErrorSurface || mcpDiagnosticSurface
    },
    render: renderCoordinator.render,
    subagentView,
    toolApproval,
    userQuestion
  });
  footerPointer = new FooterPointerController({
    getActivePointerConsumer: () => activeInputResolver.getPointerConsumer(),
    terminal
  });
  const inputController = new InputEventController({
    appContext,
    resolver: activeInputResolver,
    openFilePicker: (triggerStart) => filePicker.open(triggerStart),
    openSubagentView: () => subagentView.toggle(),
    submitComposer: () => submissionController.submitComposer(),
    interruptActiveShellCommand,
    interruptActiveTurn,
    exit,
    render: renderCoordinator.render,
    toggleAllowAllForSession: () => toolApproval.toggleAllowAllForSession(),
    pointer: footerPointer
  });

  /** 接收已解析的主会话提交，记录观测事实并运行 agent；结束时只清理本轮的观测范围。 */
  async function startMainAssistantTurn(submission: AssistantTurnSubmission): Promise<void> {
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
        renderRecords: (records) => renderCoordinator.renderRecords(records, 'main'),
        render: (finalizeRecord) => renderCoordinator.render(finalizeRecord, 'main')
      });
    } finally {
      if (activeTurnObservationScope === turnObservationScope) activeTurnObservationScope = null;
    }
  }

  /**
   * shell 模式执行 composer 命令；普通 shell 保留 bounded context，shell-local 把完整结果写入本地 transcript。
   */
  async function submitShellCommand(command: string): Promise<void> {
    const shellController = new AbortController();
    const includeInContext = appContext.getInteractionMode() === 'shell';
    activeShellController = shellController;
    appContext.turnContext.beginShellCommand(command, includeInContext);
    appContext.turnContext.startSpinner('working');
    renderCoordinator.render();

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
      renderCoordinator.renderRecords([appContext.turnContext.finishShellCommand(result, includeInContext)], 'main');
    } catch (error: unknown) {
      renderCoordinator.renderRecords([appContext.turnContext.failShellCommand(error)], 'main');
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
      renderCoordinator.render(result.reasoningRecord, 'main');
    }

    if (result.partialRecord) {
      renderCoordinator.render(result.partialRecord, 'main');
    }

    if (result.interruptedToolRecords) {
      renderCoordinator.renderRecords(result.interruptedToolRecords, 'main');
    }

    if (result.noticeRecord) {
      renderCoordinator.renderRecords([result.noticeRecord], 'main');
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
    if (renderCoordinator.currentOwner() !== 'main' || activeInputResolver.hasActiveExcept('auto-update')) {
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

  /** 启动 app 并注册配置、输入和 resize 监听；仅初始状态允许启动。 */
  function start(): void {
    if (lifecycle !== 'created') {
      return;
    }

    lifecycle = 'running';
    try {
      unsubscribeConfig = userConfigContext.subscribe((change) => {
        if (lifecycle === 'stopped') return;
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
          renderCoordinator.renderResizeRecovery();
        } else if (modelChanged || settingsRefresh?.slashSuggestionLimitChanged || settingsRefresh?.mouseInteractionChanged) {
          renderCoordinator.render();
        }
      });
      userConfigContext.startWatching(
        (error) => {
          if (lifecycle !== 'stopped') observation.configurationWatchFailed({error});
        }
      );
    } catch (error: unknown) {
      observation.configurationWatchFailed({error});
    }
    observation.appStarted({
      scope: {cwd: appContext.getCurrentCwd(), nodeVersion: appContext.getNodeVersion(), pid: process.pid},
      terminalSize: terminal.getSize()
    });
    renderCoordinator.renderInitial();
    initialRenderComplete = true;
    activityTimer = setInterval(tickActivity, ACTIVITY_REDRAW_INTERVAL_MS);
    autoUpdate.start();

    appContext.setMcpBootstrapStatus('initializing');
    appContext.turnContext.startSpinner('working');
    renderCoordinator.render();
    mcpBootstrapTask = mcpManager.bootstrap().catch((error: unknown) => {
      if (lifecycle === 'stopped') return;
      mcpDiagnosticSurface = {kind: 'info', title: 'MCP initialization', lines: [`bootstrap: ${sanitizeMcpError(error)}`], dismissHint: 'Enter/Esc close'};
    }).then(() => {
      if (lifecycle === 'stopped') return;
      appContext.turnContext.stopSpinner();
      appContext.turnContext.clearWorking();
      appContext.setMcpBootstrapStatus('ready');
      const diagnostics = mcpManager.getDiagnostics();

      if (!mcpDiagnosticSurface && diagnostics.length > 0) {
        mcpDiagnosticSurface = {kind: 'info', title: 'MCP initialization', lines: diagnostics.map((diagnostic) => `${diagnostic.serverName}: ${diagnostic.message}`), dismissHint: 'Enter/Esc close'};
      }

      renderCoordinator.render();
    }).finally(() => {
      mcpBootstrapTask = null;
    });

    if (typeof input.on === 'function') {
      input.on('data', inputController.handleChunk);
    }

    if (typeof output.on === 'function') {
      output.on('resize', renderCoordinator.handleResize);
    }
  }

  return {
    exit,
    handleChunk: inputController.handleChunk,
    handleEvent: inputController.handleEvent,
    render: renderCoordinator.render,
    renderResizeRecovery: renderCoordinator.renderResizeRecovery,
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
