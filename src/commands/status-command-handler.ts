import {INPUT_EVENTS} from '../input/event-types';
import {calculateStatusNavigation} from '../render/footer/status-surface';

import type {
  CommandHandler,
  CommandHost,
  CommandSession,
  CommandStatusSnapshot,
  StatusCommandPage,
  StatusCommandDeepseekBalanceState,
  StatusCommandOpencodeUsageState,
  StatusCommandSurface,
  StatusCommandUsageState
} from '../types/command';
import type {InputEvent} from '../types/input';

type StatusCommandData = {
  requestId: number; // 本次异步账户查询的隔离标识，过期结果不得覆盖当前 surface。
  snapshot: CommandStatusSnapshot; // 打开或手动刷新时取得的本地运行与会话状态快照。
  usage: StatusCommandUsageState; // Codex 用量的异步查询状态。
  deepseekBalance: StatusCommandDeepseekBalanceState; // DeepSeek 余额的异步查询状态。
  opencodeUsage: StatusCommandOpencodeUsageState; // OpenCode Go 用量的异步查询状态。
  page: StatusCommandPage; // 当前打开的只读页面。
  compactionScroll: number; // 压缩摘要正文的视觉行偏移。
  todoScroll: number; // Todo 正文的视觉行偏移。
};

const STATUS_PAGES: StatusCommandPage[] = ['overview', 'compaction', 'todos'];

/**
 * 把 status command session 的数据投影为 footer surface；账户异步状态和本地阅读位置保持在同一快照内。
 */
function createStatusSurface(data: StatusCommandData): StatusCommandSurface {
  return {
    kind: 'status',
    title: 'Status',
    snapshot: data.snapshot,
    usage: data.usage,
    deepseekBalance: data.deepseekBalance,
    opencodeUsage: data.opencodeUsage,
    page: data.page,
    compactionScroll: data.compactionScroll,
    todoScroll: data.todoScroll,
    dismissHint: data.page === 'overview'
      ? '←/→ 切页 · r 刷新 · Esc / Enter / q 关闭'
      : '←/→ 切页 · ↑/↓ 滚动 · r 刷新 · Esc / Enter / q 关闭'
  };
}

export class StatusCommandHandler implements CommandHandler<StatusCommandData> {
  name = 'status';
  description = '查看运行状态、账户用量与会话计划';
  allowDuringAssistantTurn = true;
  private nextRequestId = 0;

  /**
   * 只匹配 `/status` 和尾随空白，带参数输入继续走普通 slash fallback。
   */
  match(text: string): boolean {
    return text.trimEnd() === '/status';
  }

  /**
   * 立即打开本地状态面板；Codex 用量与 DeepSeek 余额随后异步填充。
   */
  start(_text: string, host: CommandHost): void {
    const snapshot = host.status.createSnapshot();
    const requestId = ++this.nextRequestId;
    const data: StatusCommandData = {
      requestId,
      snapshot,
      usage: {status: 'loading'},
      deepseekBalance: {status: 'loading'},
      opencodeUsage: {status: 'loading'},
      page: 'overview',
      compactionScroll: 0,
      todoScroll: 0
    };

    host.session.open({
      commandName: 'status',
      handler: this,
      surface: createStatusSurface(data),
      data
    });

    void this.loadCodexUsage(data, host);
    void this.loadDeepseekBalance(data, host);
    void this.loadOpencodeUsage(data, host);
  }

  /**
   * 在只读 status surface 内处理页签、详情滚动和本地刷新；不会写入 transcript 或会话元数据。
   */
  handleEvent(session: CommandSession<StatusCommandData>, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.EXIT) {
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE || event.type === INPUT_EVENTS.SUBMIT || (event.type === INPUT_EVENTS.TEXT && event.value === 'q')) {
      host.session.close();
      return;
    }

    const data = session.data;
    if (!data) {
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_LEFT || event.type === INPUT_EVENTS.MOVE_RIGHT) {
      data.page = movePage(data.page, event.type === INPUT_EVENTS.MOVE_LEFT ? -1 : 1);
      clampDetailScroll(data, host);
      updateStatusSession(data, host);
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === 'r') {
      data.snapshot = host.status.createSnapshot();
      clampDetailScroll(data, host);
      updateStatusSession(data, host);
      return;
    }

    if (data.page === 'overview') {
      return;
    }

    const navigation = resolveNavigation(data, host);
    const delta = event.type === INPUT_EVENTS.MOVE_UP
      ? -1
      : event.type === INPUT_EVENTS.MOVE_DOWN
        ? 1
        : event.type === INPUT_EVENTS.PAGE_UP
          ? -navigation.windowSize
          : event.type === INPUT_EVENTS.PAGE_DOWN
            ? navigation.windowSize
            : 0;

    if (event.type === INPUT_EVENTS.MOVE_HOME) {
      setDetailScroll(data, 0);
      updateStatusSession(data, host);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_END) {
      setDetailScroll(data, navigation.maxScroll);
      updateStatusSession(data, host);
      return;
    }

    if (delta !== 0) {
      setDetailScroll(data, getDetailScroll(data) + delta, navigation.maxScroll);
      updateStatusSession(data, host);
    }
  }

  private async loadCodexUsage(data: StatusCommandData, host: CommandHost): Promise<void> {
    try {
      data.usage = await host.status.queryCodexUsage();
    } catch (error: unknown) {
      data.usage = {
        status: 'unavailable',
        error: error instanceof Error && error.message.trim() !== '' ? error.message : 'Codex 用量不可用'
      };
    }

    this.updateSurface(data, host);
  }

  private async loadDeepseekBalance(data: StatusCommandData, host: CommandHost): Promise<void> {
    try {
      data.deepseekBalance = await host.status.queryDeepseekBalance();
    } catch (error: unknown) {
      data.deepseekBalance = {
        status: 'unavailable',
        error: error instanceof Error && error.message.trim() !== '' ? error.message : 'DeepSeek 余额不可用'
      };
    }

    this.updateSurface(data, host);
  }

  private async loadOpencodeUsage(data: StatusCommandData, host: CommandHost): Promise<void> {
    try {
      data.opencodeUsage = await host.status.queryOpencodeUsage();
    } catch (error: unknown) {
      data.opencodeUsage = {
        status: 'unavailable',
        error: error instanceof Error && error.message.trim() !== '' ? error.message : 'OpenCode Go 用量不可用'
      };
    }

    this.updateSurface(data, host);
  }

  /**
   * 把最新用量/余额写入仍处于激活状态的 surface；会话关闭或 requestId 过期时丢弃结果。
   */
  private updateSurface(data: StatusCommandData, host: CommandHost): void {
    const active = host.session.getActive() as CommandSession<StatusCommandData> | null;

    if (active?.handler !== this || active.commandName !== 'status' || active.data?.requestId !== data.requestId) {
      return;
    }

    host.session.update({
      data,
      surface: createStatusSurface(data)
    });
    host.ui.render();
  }
}

/**
 * 按固定顺序循环切换 status 页面，概览和两个详情页面不共享滚动位置。
 */
function movePage(page: StatusCommandPage, delta: number): StatusCommandPage {
  const current = STATUS_PAGES.indexOf(page);
  return STATUS_PAGES[(current + delta + STATUS_PAGES.length) % STATUS_PAGES.length];
}

/**
 * 根据当前终端 footer 预算计算详情正文的可滚动行数，渲染与输入使用同一投影规则。
 */
function resolveNavigation(data: StatusCommandData, host: CommandHost): {maxScroll: number; windowSize: number} {
  const viewport = host.status.getViewport();
  return calculateStatusNavigation(createStatusSurface(data), viewport.width, viewport.maxLines);
}

/**
 * 刷新快照或切换页面后收敛当前详情页偏移，避免正文变短时停留在不可见位置。
 */
function clampDetailScroll(data: StatusCommandData, host: CommandHost): void {
  if (data.page === 'overview') {
    return;
  }

  const navigation = resolveNavigation(data, host);
  setDetailScroll(data, getDetailScroll(data), navigation.maxScroll);
}

/**
 * 读取当前详情页的独立视觉行偏移；概览没有正文滚动状态。
 */
function getDetailScroll(data: StatusCommandData): number {
  return data.page === 'compaction' ? data.compactionScroll : data.todoScroll;
}

/**
 * 写入当前详情页的视觉行偏移并约束到内容边界，保留另一详情页的阅读位置。
 */
function setDetailScroll(data: StatusCommandData, value: number, maxScroll = Number.POSITIVE_INFINITY): void {
  const normalized = Math.max(0, Math.min(maxScroll, Math.floor(Number.isFinite(value) ? value : 0)));
  if (data.page === 'compaction') {
    data.compactionScroll = normalized;
  } else if (data.page === 'todos') {
    data.todoScroll = normalized;
  }
}

/**
 * 将同步交互后的 data 重新投影为 surface；command runtime 负责在事件返回后统一重绘。
 */
function updateStatusSession(data: StatusCommandData, host: CommandHost): void {
  host.session.update({data, surface: createStatusSurface(data)});
}

export {
  createStatusSurface
};

export type {
  StatusCommandData
};
