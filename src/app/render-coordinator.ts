import type {TerminalController} from '../types/app';
import type {AppRenderer, FooterPointerSnapshot, RenderState} from '../types/render';
import type {TranscriptRecord} from '../types/transcript';
import type {Observation} from '../observation/observation';
import type {ActiveInputResolver} from './active-input-resolver';
import type {BtwConversationController} from './btw-conversation-controller';
import type {FooterPointerController} from './footer-pointer-controller';
import type {AppContext} from './state/app-context';
import type {ToolApprovalContext} from './state/tool-approval-context';
import type {SubagentViewController} from './subagent-view-controller';

type RenderCoordinatorOptions = {
  appContext: AppContext; // 主会话状态与上次成功绘制的终端尺寸。
  btwConversation: BtwConversationController; // BTW 全视图的记录与后台活动摘要。
  getActiveInputResolver: () => ActiveInputResolver; // 输入仲裁稍后组装，绘制时才读取有效 surface。
  getFooterPointer: () => FooterPointerController | null; // 鼠标控制器稍后组装；每帧写入成功后同步命中区域。
  isStopped: () => boolean; // 退出后禁止任何迟到回调重新写入终端。
  observation: Observation; // 记录主会话批量投影与 resize 恢复事实。
  renderer: AppRenderer; // 持有终端增量绘制和破坏性恢复的实际 renderer。
  subagentView: SubagentViewController; // 子 Agent 窗口的当前 run 与只读记录。
  terminal: TerminalController; // 读取绘制后的终端尺寸，判断 resize 恢复边界。
  toolApproval: ToolApprovalContext; // 主会话渲染状态所需的审批投影。
};

/**
 * 收拢三种 owner 的投影、增量记录和终端尺寸恢复；输入和生命周期由组合根负责。
 */
function createRenderCoordinator(options: RenderCoordinatorOptions) {
  const {appContext, btwConversation, observation, renderer, subagentView, terminal, toolApproval} = options;

  /** 当前接管可见投影的 owner；view 优先于 btw，都不活跃时为 main。 */
  function currentOwner(): 'view' | 'btw' | 'main' {
    if (subagentView.isActive()) return 'view';
    return btwConversation.isActive() ? 'btw' : 'main';
  }

  /** 从同一输入仲裁结果派生 footer surface 和鼠标身份，再按 owner 选择可见投影。 */
  function createRenderState(): RenderState {
    const owner = currentOwner();
    const inputResolver = options.getActiveInputResolver();
    const commandSurface = inputResolver.getSurface(owner);
    const pointerConsumer = appContext.isMouseInteractionEnabled()
      ? inputResolver.getPointerConsumer()
      : null;
    const base = appContext.createRenderState({
      commandSurface,
      footerInteractionId: pointerConsumer?.id || null,
      toolApproval
    });
    if (owner === 'view') {
      return subagentView.createRenderState({...base, streamingOwner: 'view'});
    }
    return owner === 'btw'
      ? btwConversation.createRenderState({...base, streamingOwner: 'btw'})
      : {...base, streamingOwner: 'main'};
  }

  /** 将已绘制的 footer frame 同步给鼠标控制器，再记录此次绘制的终端尺寸。 */
  function finishFrame(snapshot: FooterPointerSnapshot | undefined): void {
    if (snapshot) options.getFooterPointer()?.update(snapshot);
    const terminalSize = terminal.getSize();
    appContext.renderContext.previousColumns = terminalSize.columns;
    appContext.renderContext.previousRows = terminalSize.rows;
  }

  /** 首帧写入 banner 与 footer，并建立 resize 和鼠标校准的初始尺寸。 */
  function renderInitial(): void {
    if (options.isStopped()) return;
    const snapshot = renderer.renderInitial({
      bannerContext: appContext.renderContext.createBannerContext(),
      ...createRenderState()
    });
    finishFrame(snapshot);
  }

  /** 提交流式稳定前缀；非当前 owner 的流式结果只重绘当前可见 footer。 */
  function render(
    finalizeRecord?: Extract<TranscriptRecord, {role: 'assistant' | 'reasoning_summary'}>,
    owner?: 'main' | 'btw'
  ): void {
    if (options.isStopped()) return;
    const visibleOwner = currentOwner();
    const snapshot = renderer.render(createRenderState(), owner === undefined || owner === visibleOwner ? finalizeRecord : undefined);
    finishFrame(snapshot);
  }

  /** 只在当前 owner 的计时状态可见且没有静态 modal 接管 footer 时周期重绘。 */
  function renderTimedActivity(): void {
    if (options.isStopped()) return;
    const owner = currentOwner();
    const hasTimedActivity = owner === 'view'
      ? subagentView.hasTimedActivity()
      : owner === 'btw'
        ? btwConversation.hasTimedActivity()
        : appContext.turnContext.hasTimedActivity() || appContext.subagentRunContext.hasTimedActivity();
    if (!hasTimedActivity || options.getActiveInputResolver().getActiveModalSurface()) return;
    render();
  }

  /** 按当前 owner 增量投影已落入会话状态的记录，保留主会话 tool pair 的批处理。 */
  function renderRecords(records: TranscriptRecord[], owner: 'main' | 'btw'): void {
    if (options.isStopped() || records.length === 0) return;
    if (owner === 'main') observation.transcriptBatchRendered({records});

    // 窗口命中当前 run 的记录时必须重绘 body；其余 owner 的记录仅刷新 footer。
    if (subagentView.isActive()) {
      if (subagentView.containsRunRecords(records)) renderResizeRecovery();
      else render();
      return;
    }

    if (owner !== currentOwner()) {
      render();
      return;
    }

    const snapshot = renderer.renderRecords({records, ...createRenderState()});
    finishFrame(snapshot);
  }

  /** 清屏后按窗口、BTW 或主会话重新投影完整记录，并重新校准 footer。 */
  function renderResizeRecovery(): void {
    if (options.isStopped()) return;
    observation.resizeRecovered({recordCount: appContext.transcriptContext.records.length, terminalSize: terminal.getSize()});
    const owner = currentOwner();
    // 窗口投影当前 run 的稳定记录，流式 draft 由 footer pending 呈现；只有 BTW 覆盖 banner 形态。
    const snapshot = renderer.renderDestructive({
      bannerContext: owner === 'btw'
        ? {...appContext.renderContext.createBannerContext(), variant: 'btw', parentActivity: btwConversation.getParentActivity()}
        : appContext.renderContext.createBannerContext(),
      records: owner === 'view' ? subagentView.getViewRecords() : owner === 'btw' ? btwConversation.getRecords() : appContext.transcriptContext.records,
      skipParallelSubagentFilter: owner === 'view',
      ...createRenderState()
    });
    finishFrame(snapshot);
  }

  /** 列宽或行数变化都会使当前 footer 坐标失效，需清屏恢复；未变化时不重复绘制。 */
  function handleResize(): void {
    if (options.isStopped()) return;
    const terminalSize = terminal.getSize();
    if (terminalSize.columns !== appContext.renderContext.previousColumns || terminalSize.rows !== appContext.renderContext.previousRows) {
      renderResizeRecovery();
    }
  }

  return {currentOwner, handleResize, render, renderInitial, renderRecords, renderResizeRecovery, renderTimedActivity};
}

export {createRenderCoordinator};
