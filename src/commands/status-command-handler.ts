import {INPUT_EVENTS} from '../input/event-types';

import type {
  CommandHandler,
  CommandHost,
  CommandSession,
  CommandStatusSnapshot,
  StatusCommandDeepseekBalanceState,
  StatusCommandSurface,
  StatusCommandUsageState
} from '../types/command';
import type {InputEvent} from '../types/input';

type StatusCommandData = {
  requestId: number;
  snapshot: CommandStatusSnapshot;
  usage: StatusCommandUsageState;
  deepseekBalance: StatusCommandDeepseekBalanceState;
};

function createStatusSurface(snapshot: CommandStatusSnapshot, usage: StatusCommandUsageState, deepseekBalance: StatusCommandDeepseekBalanceState): StatusCommandSurface {
  return {
    kind: 'status',
    title: 'Status',
    snapshot,
    usage,
    deepseekBalance,
    dismissHint: 'Esc / Enter / q 关闭'
  };
}

export class StatusCommandHandler implements CommandHandler<StatusCommandData> {
  name = 'status';
  description = '查看运行状态与账户用量';
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
      deepseekBalance: {status: 'loading'}
    };

    host.session.open({
      commandName: 'status',
      handler: this,
      surface: createStatusSurface(snapshot, data.usage, data.deepseekBalance),
      data
    });

    void this.loadCodexUsage(data, host);
    void this.loadDeepseekBalance(data, host);
  }

  /**
   * 只响应明确关闭键；其他按键不修改只读 status surface。
   */
  handleEvent(_session: CommandSession<StatusCommandData>, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.EXIT) {
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE || event.type === INPUT_EVENTS.SUBMIT || (event.type === INPUT_EVENTS.TEXT && event.value === 'q')) {
      host.session.close();
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
      surface: createStatusSurface(data.snapshot, data.usage, data.deepseekBalance)
    });
    host.ui.render();
  }
}

export {
  createStatusSurface
};

export type {
  StatusCommandData
};
