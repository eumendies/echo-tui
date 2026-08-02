import {INPUT_EVENTS} from '../input/event-types';

import type {
  CommandCodexUsageResult,
  CommandHandler,
  CommandHost,
  CommandSession,
  CommandStatusSnapshot,
  StatusCommandSurface,
  StatusCommandUsageState
} from '../types/command';
import type {InputEvent} from '../types/input';

type StatusCommandData = {
  requestId: number;
  snapshot: CommandStatusSnapshot;
};

function createStatusSurface(snapshot: CommandStatusSnapshot, usage: StatusCommandUsageState): StatusCommandSurface {
  return {
    kind: 'status',
    title: 'Status',
    snapshot,
    usage,
    dismissHint: 'Esc / Enter / q 关闭'
  };
}

export class StatusCommandHandler implements CommandHandler<StatusCommandData> {
  name = 'status';
  description = '查看运行状态与 Codex 用量';
  allowDuringAssistantTurn = true;
  private nextRequestId = 0;

  /**
   * 只匹配 `/status` 和尾随空白，带参数输入继续走普通 slash fallback。
   */
  match(text: string): boolean {
    return text.trimEnd() === '/status';
  }

  /**
   * 立即打开本地状态面板；Codex provider 的远端用量随后异步填充。
   */
  start(_text: string, host: CommandHost): void {
    const snapshot = host.status.createSnapshot();
    const requestId = ++this.nextRequestId;
    const data = {requestId, snapshot};
    const usage: StatusCommandUsageState = {status: 'loading'};

    host.session.open({
      commandName: 'status',
      handler: this,
      surface: createStatusSurface(snapshot, usage),
      data
    });

    void this.loadCodexUsage(data, host);
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
    let usage: CommandCodexUsageResult;

    try {
      usage = await host.status.queryCodexUsage();
    } catch (error: unknown) {
      usage = {
        status: 'unavailable',
        error: error instanceof Error && error.message.trim() !== '' ? error.message : 'Codex 用量不可用'
      };
    }

    const active = host.session.getActive() as CommandSession<StatusCommandData> | null;

    if (active?.handler !== this || active.commandName !== 'status' || active.data?.requestId !== data.requestId) {
      return;
    }

    host.session.update({
      data,
      surface: createStatusSurface(data.snapshot, usage)
    });
    host.ui.renderFooter();
  }
}

export {
  createStatusSurface
};

export type {
  StatusCommandData
};
