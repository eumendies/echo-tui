import {INPUT_EVENTS} from '../input/event-types';
import type {CommandHandler, CommandHost, CommandSession, ConfirmCommandSurface, InfoCommandSurface} from '../types/command';
import type {InputEvent} from '../types/input';
import type {UndoExecuteResult, UndoReadySummary, UndoSummary} from '../types/change-history';

type UndoCommandData = {
  mode: 'info' | 'confirm' | 'executing'; // 执行期间消费重复按键，防止异步恢复同一 checkpoint。
};

/**
 * 创建 /undo 不可执行或失败时的信息 surface。
 */
function createUndoInfoSurface(title: string, lines: string[]): InfoCommandSurface {
  return {
    kind: 'info',
    title,
    lines,
    dismissHint: 'Enter/Esc 关闭'
  };
}

/**
 * 创建 /undo 确认 surface，仅展示操作摘要及影响确认决定的风险。
 */
function createUndoConfirmSurface(summary: UndoReadySummary): ConfirmCommandSurface {
  const actions = ['撤回本轮对话'];
  if (summary.restoreFileCount > 0) actions.push(`恢复 ${summary.restoreFileCount} 个文件`);
  if (summary.deleteFileCount > 0) actions.push(`删除 ${summary.deleteFileCount} 个新增文件`);
  const bodyLines = [`${actions.join('，')}。`];

  if (summary.untrackedReason) {
    bodyLines.push('Shell 操作不会完整撤销。');
  } else if (summary.undoneUntrackedNotice) {
    bodyLines.push(summary.undoneUntrackedNotice);
  }
  if (summary.uncheckedFileCount) {
    bodyLines.push(`${summary.uncheckedFileCount} 个文件无法检查后续修改，回退将覆盖当前内容。`);
  }

  return {
    kind: 'confirm',
    title: '/undo 回退上一轮',
    bodyLines,
    confirmLabel: '回退',
    cancelLabel: '取消'
  };
}

function createUndoStartSurface(summary: UndoSummary): {surface: InfoCommandSurface | ConfirmCommandSurface; data: UndoCommandData} {
  if (summary.status === 'ready') {
    return {surface: createUndoConfirmSurface(summary), data: {mode: 'confirm'}};
  }

  if (summary.status === 'invalid') {
    return {
      surface: createUndoInfoSurface('/undo 不可用', [summary.reason]),
      data: {mode: 'info'}
    };
  }

  return {
    surface: createUndoInfoSurface('/undo 不可用', ['暂无可回退的上一轮对话。']),
    data: {mode: 'info'}
  };
}

function createUndoFailureSurface(result: Extract<UndoExecuteResult, {ok: false}>): InfoCommandSurface {
  return createUndoInfoSurface('/undo 失败', [result.message]);
}

class UndoCommandHandler implements CommandHandler<UndoCommandData> {
  name = 'undo';
  description = '回退上一轮文件修改和会话记录';

  match(text: string): boolean {
    return text.trimEnd() === '/undo';
  }

  start(_text: string, host: CommandHost): void {
    const view = createUndoStartSurface(host.undo.getSummary());

    host.session.open({
      commandName: 'undo',
      handler: this,
      surface: view.surface,
      data: view.data
    });
  }

  /** 回退已经开始时不接受重复确认或取消；等待文件与 journal 恢复共同完成后再关闭面板。 */
  async handleEvent(session: CommandSession<UndoCommandData>, event: InputEvent, host: CommandHost): Promise<void> {
    if (session.data?.mode === 'executing') {
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      host.session.close();
      return;
    }

    if (event.type !== INPUT_EVENTS.SUBMIT) {
      return;
    }

    if (session.data?.mode !== 'confirm') {
      host.session.close();
      return;
    }

    session.data.mode = 'executing';
    host.session.update({
      surface: {
        kind: 'info',
        title: '/undo 正在回退',
        lines: [],
        dismissHint: '请稍候'
      },
      data: session.data
    });
    const result = await host.undo.execute();

    if (!result.ok) {
      host.session.update({surface: createUndoFailureSurface(result), data: {mode: 'info'}});
      return;
    }

    host.session.close();
    host.ui.renderResizeRecovery();
  }
}

export {
  UndoCommandHandler,
  createUndoConfirmSurface,
  createUndoInfoSurface
};
