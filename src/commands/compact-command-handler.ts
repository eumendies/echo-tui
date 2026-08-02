import { INPUT_EVENTS } from '../input/event-types';
import type { CommandHandler, CommandHost, CommandSession, ConfirmCommandSurface } from '../types/command';
import type { InputEvent } from '../types/input';

const COMPACT_SURFACE: ConfirmCommandSurface & {
  title: string;
  bodyLines: string[];
  confirmLabel: string;
  cancelLabel: string;
} = {
  kind: 'confirm',
  title: '/compact 压缩上下文',
  bodyLines: [
    '这会立即发起一次摘要请求，把较早的历史压缩为摘要。'
  ],
  confirmLabel: '压缩',
  cancelLabel: '取消'
};

/**
 * 为 /compact 创建独立的 confirm surface，避免共享可变数组引用。
 *
 */
export function createCompactSurface(): ConfirmCommandSurface {
  return {
    ...COMPACT_SURFACE,
    bodyLines: [...COMPACT_SURFACE.bodyLines]
  };
}

/**
 * 编排 /compact 的手动压缩流程；只通过 CommandHost 原语触达 app 状态。
 *
 */
async function runManualCompaction(host: CommandHost): Promise<void> {
  if (!host.assistant.beginManualCompaction()) {
    return;
  }

  try {
    const result = await host.assistant.compactContext({force: true});
    host.assistant.finishManualCompaction(result);
  } catch (error: unknown) {
    host.assistant.fail(error);
  }
}

export class CompactCommandHandler implements CommandHandler {
  name = 'compact';
  description = '手动压缩当前会话上下文';

  /**
   * 只匹配 /compact 和尾随空白，带参数输入继续走普通消息路径。
   *
   */
  match(text: string): boolean {
    return text.trimEnd() === '/compact';
  }

  /**
   * 启动 /compact，打开确认型 command surface。
   *
   */
  start(_text: string, host: CommandHost): void {
    host.session.open({
      commandName: 'compact',
      handler: this,
      surface: createCompactSurface(),
      data: null
    });
  }

  /**
   * /compact 活跃时消费 Enter/Esc；确认后请求 app 异步执行手动压缩。
   *
   */
  handleEvent(_session: CommandSession, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.SUBMIT) {
      host.session.close();
      void runManualCompaction(host);
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      host.session.close();
    }
  }
}
