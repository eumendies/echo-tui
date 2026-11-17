import {randomUUID} from 'node:crypto';

import {normalizeError} from '../agent-errors';
import {AgentAbortError} from '../../types/agent';
import {resolveSubagentLlmConfig} from '../loop-runtime/subagent-loop-runtime';
import {formatSubagentDisplayName} from './name';
import {loadSubagentCatalog} from './catalog';
import {SubagentFailureHandoffAccumulator, buildSubagentFailureHandoff} from './failure-handoff';
import {hasUnconfirmedBashCommands} from '../../tools/bash-command-runner';
import {inspectWorkspaceCleanliness} from './workspace/inspect';
import {buildWorkerWorkspaceHandoff} from './workspace/handoff';
import {probeWorkerWorkspace} from './workspace/git';
import {REGISTRY_SCHEMA_VERSION, createWorkspaceId, createWorkerWorkspaceStore} from './workspace/registry';
import {createManagedWorktree, removeManagedWorktree, verifyManagedWorktree} from './workspace/worktree';
import {
  createSubagentAssistantRecord,
  createSubagentReasoningRecord,
  createSubagentStartRecord,
  createSubagentTerminalRecord,
  createSubagentToolCallRecord,
  createSubagentToolResultRecord
} from './transcript-record';

import type {InheritedAgentRunContext, SubagentLoopCallbacks, SubagentLoopRuntimeFactory} from '../loop-runtime/types';
import type {
  AgentCallbacks,
  AgentExecutionMode,
  AgentToolPolicy,
  AgentUserConfigSnapshot,
  InteractionMode,
  LlmConfig,
  PreparedSubagentWorkspace,
  SubagentRunMetadata,
  SubagentWorkspaceAllocation,
  SubagentWorkspaceProbe,
  SubagentToolPort
} from '../../types/agent';
import type {SubagentTranscriptRecord, SubagentWorkspaceOutcomeFacts, SubagentWorkspaceRecordFacts} from '../../types/transcript';
import type {Observation} from '../../observation/observation';
import type {SandboxModeOverride} from '../../sandbox/types';
import type {WorkerWorkspaceEntry, WorkerWorkspaceOwner, WorkerWorkspaceStore, WorkerWorkspaceStoreOptions} from './workspace/registry';

type SubagentToolPortOptions = {
  callbacks: AgentCallbacks; // 父 run 的观察回调，承载审批和 TUI 活动投影。
  configSnapshot: AgentUserConfigSnapshot; // 父 run 捕获的配置 revision，子运行不得重新读取其他 revision。
  createRuntime: SubagentLoopRuntimeFactory; // 为每次委派创建拥有独立装配状态的 loop runtime 实例。
  cwd: string; // 当前父运行工作目录，决定项目级定义发现边界。
  executionMode: AgentExecutionMode; // 父 run 的 interactive/headless 安全边界。
  interactionMode: InteractionMode; // 子运行启动时父运行已应用的 mode，已启动子运行不接受后续更新。
  getInheritedContext: () => InheritedAgentRunContext; // 延迟读取父 run 已初始化的完整上下文快照。
  homedir?: string; // 目录发现与受管存储使用的用户根；测试可注入以隔离真实 home。
  modelProfileId?: string; // 父 run 已解析选择的模型 profile。
  observation: Observation; // 接收本次目录加载形成的诊断快照。
  publishRecords: (records: SubagentTranscriptRecord[]) => void; // 把稳定过程同步提交到父 runtime 与 app transcript。
  reasoningEffortOverride?: LlmConfig['reasoningEffort']; // 父 run 本轮固定的推理强度覆盖。
  sandboxModeOverride?: SandboxModeOverride; // 父 run 的运行级沙箱收紧;子运行继承同一 bash 边界。
  toolPolicy?: AgentToolPolicy; // 父 run 的运行级工具策略;readonly 时只读子运行继承 fail-closed 分类。
  sessionId?: string; // 父会话稳定身份，透传给子 loop 注入会话亲和 header。
  workspaceStoreOptions?: WorkerWorkspaceStoreOptions; // 受管工作区存储根与文件系统替换缝;缺省使用用户目录。
};

/** 受管工作区最终化的结论；交接文本进入外层 tool result，状态写入受管登记。 */
type ManagedWorkspaceFinalization = {
  handoffText: string; // 系统生成的工作区交接块。
  outcome: SubagentWorkspaceOutcomeFacts; // 进入终态记录的工作区保留事实。
};

/**
 * 创建父 run专属的委派端口，按定义解析子 Agent并集中管理隔离 session、回调桥接和终态归一化。
 * 端口同步等待子运行结束；稳定过程由 publishRecords 增量提交，瞬时活动只通过父 callbacks 投影。
 */
function createSubagentToolPort(options: SubagentToolPortOptions): SubagentToolPort {
  const catalog = loadSubagentCatalog({
    configSnapshot: options.configSnapshot,
    cwd: options.cwd,
    ...(options.homedir ? {homedir: options.homedir} : {})
  });
  const workspaceStore = createWorkerWorkspaceStore({
    ...options.workspaceStoreOptions,
    ...(options.homedir ? {homedir: options.homedir} : {})
  });
  options.observation.subagentCatalogLoaded(catalog.diagnostics);

  return {
    listDefinitions() {
      return catalog.listDescriptors();
    },
    /**
     * 段级异步预检：在屏障之后解析项目类型并冻结完整基线。
     * 这里不做任何缓存复用，因为同 turn 之前的 shell 或编辑可能已经改变仓库状态。
     */
    async probeWorkspace(probeOptions: {abortSignal?: AbortSignal} = {}): Promise<SubagentWorkspaceProbe> {
      return probeWorkerWorkspace(options.cwd, probeOptions);
    },
    /**
     * 为单个调用创建受管 detached worktree。
     * 登记先于创建写入；创建或核验失败时保留登记与诊断，绝不回退共享目录执行。
     */
    async allocateWorkerWorkspace(allocationOptions: {
      abortSignal?: AbortSignal;
      call: {callId: string; argumentsText: string; toolName: string};
      probe: Extract<SubagentWorkspaceProbe, {kind: 'git'}>;
    }): Promise<SubagentWorkspaceAllocation> {
      const runId = randomUUID();
      const workspaceId = createWorkspaceId(randomUUID().slice(0, 12), Date.now());
      // allocate 由调度器在 Worker 候选段内调用；当前只有内置 worker 具备这一段资格。
      const owner = createWorkspaceOwner(options, 'worker', allocationOptions.call.callId, runId);
      // worktree 跟随源仓库，便于用户在项目目录里直接查看；登记仍按 projectCwd 分区。
      const workspaceRoot = workspaceStore.getWorkspaceRoot(allocationOptions.probe.repoRoot, workspaceId);
      const entry = createPreparingEntry({
        baseCommit: allocationOptions.probe.baseCommit,
        owner,
        repoRoot: allocationOptions.probe.repoRoot,
        workspaceId,
        workspaceRoot
      });

      try {
        workspaceStore.writeEntry(entry);
      } catch (error: unknown) {
        return {kind: 'failed', message: `Managed workspace registry could not be written: ${describeFailure(error)}`};
      }

      const created = await createManagedWorktree({
        baseCommit: allocationOptions.probe.baseCommit,
        execRelativeCwd: allocationOptions.probe.execRelativeCwd,
        gitCommonDir: allocationOptions.probe.gitCommonDir,
        repoRoot: allocationOptions.probe.repoRoot,
        workspaceRoot,
        ...(allocationOptions.abortSignal ? {abortSignal: allocationOptions.abortSignal} : {})
      });
      if (created.kind !== 'ok') {
        writeEntryQuietly(workspaceStore, {
          ...entry,
          cleanup: {kind: 'retained', message: created.message},
          status: 'failed',
          statusDetail: created.message,
          updatedAt: new Date().toISOString()
        });
        return {kind: 'failed', message: created.message};
      }

      const workspace: PreparedSubagentWorkspace = {
        execCwd: created.execCwd,
        git: created.git,
        workspaceId,
        workspaceRoot: created.workspaceRoot
      };
      writeEntryQuietly(workspaceStore, {
        ...entry,
        workspaceRoot: workspace.workspaceRoot,
        updatedAt: new Date().toISOString()
      });
      return {kind: 'ok', runId, workspace};
    },
    /**
     * 结算已分配但未真正运行的受管工作区。
     * 已经跑过 run() 的登记会被 finalize 的幂等检查跳过，因此可以安全地对整段重复调用。
     */
    async releaseWorkerWorkspace(releaseOptions: {status: 'cancelled'; workspace: PreparedSubagentWorkspace}): Promise<void> {
      const read = workspaceStore.getEntry(options.cwd, releaseOptions.workspace.workspaceId);
      if (read.kind !== 'ok') {
        return;
      }
      await finalizeManagedWorkspace({
        owner: read.entry.owner,
        status: releaseOptions.status,
        store: workspaceStore,
        workspace: releaseOptions.workspace
      });
    },
    async run(agentName, task, call, executionOptions = {}) {
      const definition = catalog.get(agentName);
      if (!definition) {
        return {ok: false, text: `Unknown subagent: ${formatSubagentDisplayName(agentName)}`};
      }
      const startedAt = Date.now();
      const handoffAccumulator = new SubagentFailureHandoffAccumulator();
      const workspaceSelection = executionOptions.subagentWorkspace;
      const workspace = workspaceSelection?.kind === 'managed_worktree' ? workspaceSelection.workspace : undefined;
      // 工作区方式只表达系统已确认的事实：受管 worktree、明确非 Git 共享目录，或旧路径缺省。
      const workspaceFacts: SubagentWorkspaceRecordFacts | undefined = workspace
        ? {
            baseCommit: workspace.git.baseCommit,
            execCwd: workspace.execCwd,
            mode: 'managed_worktree',
            owner: {
              projectCwd: options.cwd,
              ...(options.sessionId ? {sessionId: options.sessionId} : {})
            },
            workspaceRoot: workspace.workspaceRoot
          }
        : workspaceSelection?.kind === 'shared_cwd'
          ? {
              mode: 'shared_cwd',
              owner: {
                projectCwd: options.cwd,
                ...(options.sessionId ? {sessionId: options.sessionId} : {})
              }
            }
          : undefined;
      const metadata: SubagentRunMetadata = {
        agentName: definition.name,
        depth: 1,
        parentToolCallId: call.callId,
        // 调度器预分配工作区时已经固定了 runId；两处必须使用同一个身份。
        runId: workspaceSelection?.kind === 'managed_worktree' ? workspaceSelection.runId : randomUUID()
      };
      const publishRecords = (records: SubagentTranscriptRecord[]): void => {
        handoffAccumulator.record(records);
        options.publishRecords(records);
      };
      const owner = createWorkspaceOwner(options, definition.name, call.callId, metadata.runId);
      const loopInput = {
        abortSignal: executionOptions.abortSignal,
        configSnapshot: options.configSnapshot,
        executionMode: options.executionMode,
        interactionMode: options.interactionMode,
        metadata,
        modelProfileId: options.modelProfileId,
        reasoningEffortOverride: options.reasoningEffortOverride,
        ...(options.sandboxModeOverride ? {sandboxModeOverride: options.sandboxModeOverride} : {}),
        ...(options.toolPolicy ? {toolPolicy: options.toolPolicy} : {}),
        ...(options.sessionId ? {sessionId: options.sessionId} : {}),
        ...(workspace ? {workspace} : {}),
        task
      };
      // 预先解析子运行的最终模型策略；失败时保持缺省并交给子 loop 内部统一抛错，维持既有失败路径。
      let resolvedLlmConfig: LlmConfig | undefined;
      try {
        resolvedLlmConfig = resolveSubagentLlmConfig(loopInput, definition);
      } catch {
        resolvedLlmConfig = undefined;
      }
      publishRecords([createSubagentStartRecord(metadata, task, executionOptions.subagentGroupSize, resolvedLlmConfig, workspaceFacts)]);
      publishActivity(options.callbacks, metadata, task, 'thinking');
      if (workspace) {
        markEntryStatus(workspaceStore, owner.projectCwd, workspace.workspaceId, 'running');
      }

      try {
        const inherited = options.getInheritedContext();
        const runAgent = options.createRuntime(inherited, definition);
        const answer = await runAgent({
          ...loopInput,
          ...(resolvedLlmConfig ? {resolvedLlmConfig} : {})
        }, createChildCallbacks(
          options,
          metadata,
          task,
          // 受管 worktree 的编辑不进入父 change recorder：/undo 不能指向临时目录。
          workspace ? undefined : executionOptions.changeRecorder,
          publishRecords,
          handoffAccumulator
        ));

        const finalization = workspace
          ? await finalizeManagedWorkspace({owner, status: 'completed', store: workspaceStore, workspace})
          : undefined;
        publishRecords([createSubagentTerminalRecord(metadata, 'completed', {
          durationMs: Date.now() - startedAt,
          ...(finalization ? {workspace: finalization.outcome} : {})
        })]);
        return {ok: true, text: prependHandoff(answer, finalization), ...(finalization ? {workspace: finalization.outcome} : {})};
      } catch (error: unknown) {
        const cancelled = error instanceof AgentAbortError || executionOptions.abortSignal?.aborted === true;
        const label = formatSubagentDisplayName(definition.name);
        const message = cancelled ? `${label} cancelled.` : normalizeError(error, `${label} failed`).message;
        const text = cancelled
          ? message
          : buildSubagentFailureHandoff({errorText: message, snapshot: handoffAccumulator.snapshot()});
        const finalization = workspace
          ? await finalizeManagedWorkspace({owner, status: cancelled ? 'cancelled' : 'failed', store: workspaceStore, workspace})
          : undefined;
        publishRecords([createSubagentTerminalRecord(metadata, cancelled ? 'cancelled' : 'failed', {
          durationMs: Date.now() - startedAt,
          text: message,
          ...(finalization ? {workspace: finalization.outcome} : {})
        })]);
        return {ok: false, text: prependHandoff(text, finalization), ...(finalization ? {workspace: finalization.outcome} : {})};
      }
    }
  };
}

type SubagentSchemaPortOptions = {
  configSnapshot?: AgentUserConfigSnapshot; // 与主 run 同源的配置 revision，用于严格校验非敏感模型引用。
  cwd?: string; // 项目级定义发现边界；显式传入以与主 run 的目录发现一致。
};

/**
 * 创建只提供目录 schema 的委派端口：复用运行端口同一 catalog 加载口径，
 * 但不提供执行能力，供不执行工具的一次性请求（手动 `/compact` 摘要）对齐 `run_subagent` 工具定义。
 */
function createSubagentSchemaPort(options: SubagentSchemaPortOptions = {}): SubagentToolPort {
  const catalog = loadSubagentCatalog({configSnapshot: options.configSnapshot, cwd: options.cwd});

  return {
    listDefinitions() {
      return catalog.listDescriptors();
    },
    async run(agentName) {
      // schema-only 端口不承载执行：调用方只投影工具定义，正常路径不会到达这里。
      return {ok: false, text: `Subagent execution is unavailable in this request: ${formatSubagentDisplayName(agentName)}`};
    }
  };
}

/** 把子 loop 的稳定协议事件和瞬时活动翻译到父 run，不向子层暴露 app 状态对象。 */
function createChildCallbacks(
  options: SubagentToolPortOptions,
  metadata: SubagentRunMetadata,
  task: string,
  changeRecorder: AgentCallbacks['changeRecorder'],
  publishRecords: (records: SubagentTranscriptRecord[]) => void,
  handoffAccumulator: SubagentFailureHandoffAccumulator
): SubagentLoopCallbacks {
  return {
    changeRecorder,
    onAssistantSegment(text) {
      if (text.trim()) {
        publishRecords([createSubagentAssistantRecord(metadata, text)]);
      }
      handoffAccumulator.completeAssistantSegment();
      publishActivity(options.callbacks, metadata, task, 'thinking');
    },
    onComplete(text) {
      if (text.trim()) {
        publishRecords([createSubagentAssistantRecord(metadata, text)]);
      }
      handoffAccumulator.completeAssistantSegment();
    },
    onReasoningUpdate(update) {
      publishActivity(options.callbacks, metadata, task, update.kind === 'draft' ? 'reasoning' : 'thinking', undefined, update.text);
      if (update.kind === 'complete' && update.text.trim()) {
        publishRecords([createSubagentReasoningRecord(metadata, update.text)]);
        publishActivity(options.callbacks, metadata, task, 'thinking');
      }
    },
    onThinking() {
      handoffAccumulator.beginAssistantSegment();
      publishActivity(options.callbacks, metadata, task, 'thinking');
    },
    onToken(_token, draft) {
      handoffAccumulator.updateAssistantDraft(draft);
      publishActivity(options.callbacks, metadata, task, 'streaming', undefined, draft);
    },
    onToolCall(call) {
      handoffAccumulator.completeAssistantSegment();
      publishRecords([createSubagentToolCallRecord(metadata, call)]);
      publishActivity(options.callbacks, metadata, task, 'tool', call);
    },
    onToolResult(result) {
      publishRecords([createSubagentToolResultRecord(metadata, result)]);
      publishActivity(options.callbacks, metadata, task, 'thinking');
    },
    async onToolApprovalRequest(call, approval) {
      if (!options.callbacks.onToolApprovalRequest) {
        return {kind: 'deny'};
      }
      const decision = await options.callbacks.onToolApprovalRequest(call, approval);
      publishActivity(options.callbacks, metadata, task, 'thinking');
      return decision;
    },
    onWaitingApproval(call) {
      publishActivity(options.callbacks, metadata, task, 'waiting_approval', call);
    },
    async onUserQuestionRequest(call, request) {
      if (!options.callbacks.onSubagentUserQuestionRequest) {
        return {
          callId: call.callId,
          toolName: call.toolName,
          ok: false,
          details: {kind: 'generic'},
          text: 'User question was interrupted.'
        };
      }
      const result = await options.callbacks.onSubagentUserQuestionRequest(metadata, call, request);
      publishActivity(options.callbacks, metadata, task, 'thinking');
      return result;
    },
    onWaitingQuestion(call) {
      publishActivity(options.callbacks, metadata, task, 'waiting_question', call);
    }
  };
}

/** 构造受管工作区的创建者归属；fork 之后这里仍是源创建者，不会被继承方改写。 */
function createWorkspaceOwner(options: SubagentToolPortOptions, agentName: string, parentToolCallId: string, runId: string): WorkerWorkspaceOwner {
  return {
    agentName,
    parentToolCallId,
    projectCwd: options.cwd,
    runId,
    ...(options.sessionId ? {sessionId: options.sessionId} : {})
  };
}

/** 创建准备阶段登记；worktree 尚未存在时也必须先留下可发现的计划事实。 */
function createPreparingEntry(options: {
  baseCommit: string;
  owner: WorkerWorkspaceOwner;
  repoRoot: string;
  workspaceId: string;
  workspaceRoot: string;
}): WorkerWorkspaceEntry {
  const now = new Date().toISOString();
  return {
    baseCommit: options.baseCommit,
    createdAt: now,
    owner: options.owner,
    repoRoot: options.repoRoot,
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    status: 'preparing',
    updatedAt: now,
    workspaceId: options.workspaceId,
    workspaceRoot: options.workspaceRoot
  };
}

/** 登记写入失败不改变运行结论：工作区路径仍会进入交接文本，用户可据此定位现场。 */
function writeEntryQuietly(store: WorkerWorkspaceStore, entry: WorkerWorkspaceEntry): void {
  try {
    store.writeEntry(entry);
  } catch {
    // 受管目录不可写时保留内存事实，不因登记失败回滚已经完成的工作区。
  }
}

/** 更新已存在登记的生命周期状态；登记缺失或被判为不安全时保持原样。 */
function markEntryStatus(store: WorkerWorkspaceStore, projectCwd: string, workspaceId: string, status: WorkerWorkspaceEntry['status']): void {
  const read = store.getEntry(projectCwd, workspaceId);
  if (read.kind !== 'ok') {
    return;
  }
  writeEntryQuietly(store, {...read.entry, status, updatedAt: new Date().toISOString()});
}

/**
 * Worker 结束后的宿主生命周期：核验归属、检查工作区状态、保守决策清理，最后写终端登记。
 *
 * 这里不使用父 turn 的 abort signal：父 turn 取消后仍必须完成现场判定与登记，
 * 否则现场会随进程退出而不可发现。
 */
/** 一次工作区结算的输入；交接正文与终态记录都从它派生。 */
type WorkspaceSettlement = {
  cleanup?: {kind: 'removed' | 'retained'; message?: string}; // 清理决定。
  hasIgnoredFiles?: boolean; // 是否存在未纳入结果的 ignored 遗留。
  workspace: PreparedSubagentWorkspace; // 当前受管工作区。
};

/** 由同一份结算事实派生交接正文与终态记录。 */
function createFinalization(settlement: WorkspaceSettlement): ManagedWorkspaceFinalization {
  const {cleanup, hasIgnoredFiles, workspace} = settlement;
  return {
    handoffText: buildWorkerWorkspaceHandoff({
      baseCommit: workspace.git.baseCommit,
      execCwd: workspace.execCwd,
      workspaceRoot: workspace.workspaceRoot,
      ...(hasIgnoredFiles === undefined ? {} : {hasIgnoredFiles}),
      ...(cleanup ? {cleanup} : {})
    }),
    outcome: {
      retained: cleanup?.kind !== 'removed',
      workspaceRoot: workspace.workspaceRoot
    }
  };
}

/**
 * Worker 结束后的宿主生命周期：核验归属、检查是否还有内容、保守决策清理，最后写终端登记。
 *
 * 成果就是 worktree 里的文件本身；这里只需要判断「能不能安全回收」。
 * 不使用父 turn 的 abort signal：父 turn 取消后仍必须完成现场判定与登记。
 * 已完成结算的登记直接跳过，不重建、不伪造交接。
 */
async function finalizeManagedWorkspace(options: {
  owner: WorkerWorkspaceOwner;
  status: 'cancelled' | 'completed' | 'failed';
  store: WorkerWorkspaceStore;
  workspace: PreparedSubagentWorkspace;
}): Promise<ManagedWorkspaceFinalization | undefined> {
  const {owner, status, store, workspace} = options;
  const current = store.getEntry(owner.projectCwd, workspace.workspaceId);
  // 幂等：run() 已经结算过的登记不再重复判定，也不伪造一份交接。
  if (current.kind === 'ok' && isTerminalWorkspaceStatus(current.entry.status)) {
    return undefined;
  }

  /** 写入登记补丁；登记缺失或不可读时保持现状。 */
  const persist = (patch: Partial<WorkerWorkspaceEntry>): void => {
    if (current.kind !== 'ok') {
      return;
    }
    writeEntryQuietly(store, {...current.entry, ...patch, updatedAt: new Date().toISOString()});
  };

  /** 保留现场并记录原因。 */
  const retain = (message: string, detail?: string): ManagedWorkspaceFinalization => {
    persist({cleanup: {kind: 'retained', message}, status, statusDetail: detail ?? message});
    return createFinalization({cleanup: {kind: 'retained', message}, workspace});
  };

  // 失败或取消本就不会回收：直接保留，不必再做归属核验和工作区扫描。
  if (status !== 'completed') {
    return retain('The run did not complete successfully; the workspace was retained for review.');
  }

  // 目录存在不等于归属正确：路径被别的仓库复用时拒绝自动判定与清理。
  const verification = await verifyManagedWorktree({expected: workspace.git, workspaceRoot: workspace.workspaceRoot});
  if (verification.kind !== 'ok') {
    return retain(`Workspace ownership could not be confirmed: ${verification.message}`, verification.message);
  }

  const inspection = await inspectWorkspaceCleanliness({
    baseCommit: workspace.git.baseCommit,
    workspaceRoot: workspace.workspaceRoot
  });
  if (inspection.kind === 'error') {
    return retain('Workspace state could not be inspected; the workspace was retained.', inspection.message);
  }

  // 只有完全干净且无未确认进程的成功运行才自动回收；其余一律保留现场。
  const removable = inspection.kind === 'clean' &&
    !hasUnconfirmedBashCommands(workspace.execCwd) &&
    !hasUnconfirmedBashCommands(workspace.workspaceRoot);

  if (removable) {
    const removed = await removeManagedWorktree({repoRoot: workspace.git.repoRoot, workspaceRoot: workspace.workspaceRoot});
    if (removed.kind === 'ok') {
      persist({cleanup: {kind: 'removed'}, status: 'cleaned'});
      return createFinalization({cleanup: {kind: 'removed'}, workspace});
    }
    return retain(removed.message);
  }

  // 未回收就一定有保留原因：留空会让「盘上保留 / retained=true / 无 Cleanup 行」三种说法打架。
  const cleanup = {
    kind: 'retained' as const,
    message: hasUnconfirmedBashCommands(workspace.execCwd) || hasUnconfirmedBashCommands(workspace.workspaceRoot)
      ? 'A managed process did not confirm exit; the workspace was retained.'
      : inspection.hasIgnoredFiles
        ? 'Ignored files remain in the workspace; the workspace was retained.'
        : 'Unintegrated changes remain in the workspace.'
  };

  persist({cleanup, status});
  return createFinalization({
    hasIgnoredFiles: inspection.hasIgnoredFiles,
    cleanup,
    workspace
  });
}

/**
 * 把工作区交接排在模型报告之前。
 *
 * 外层结果会对最终文本做头部有界预览，交接必须先占住预算：否则长报告会把基线、
 * 工作区路径和未集成事实挤出预览，父 Agent 就再也定位不到已经存在的现场。
 */
function prependHandoff(text: string, finalization: ManagedWorkspaceFinalization | undefined): string {
  return finalization ? `${finalization.handoffText}\n\n---\n\n${text}` : text;
}

function describeFailure(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
}

/** 终态登记不会被重复结算；cleaned 表示工作区已经移除。 */
function isTerminalWorkspaceStatus(status: WorkerWorkspaceEntry['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'cleaned';
}

/** 发布子运行 footer 活动；稳定记录的提交由独立 sink 负责。 */
function publishActivity(
  callbacks: AgentCallbacks,
  metadata: SubagentRunMetadata,
  task: string,
  phase: 'thinking' | 'reasoning' | 'streaming' | 'tool' | 'waiting_approval' | 'waiting_question',
  toolCall?: Parameters<NonNullable<AgentCallbacks['onToolCall']>>[0],
  draft?: string
): void {
  callbacks.onSubagentActivity?.({
    agentName: metadata.agentName,
    argumentsText: toolCall?.argumentsText,
    draft,
    phase,
    runId: metadata.runId,
    task,
    toolName: toolCall?.toolName
  });
}

export {createSubagentSchemaPort, createSubagentToolPort};
