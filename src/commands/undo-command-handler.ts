import {INPUT_EVENTS} from '../input/event-types';
import type {CommandHandler, CommandHost, CommandSession, ConfirmCommandSurface, InfoCommandSurface} from '../types/command';
import type {InputEvent} from '../types/input';
import type {UndoExecuteResult, UndoReadySummary, UndoSummary} from '../types/change-history';

type UndoCommandData = {
  mode: 'info' | 'confirm';
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
 * 创建 /undo 确认 surface，用用户可理解的轮次语义描述即将回退的内容。
 */
function createUndoConfirmSurface(summary: UndoReadySummary): ConfirmCommandSurface {
  const bodyLines = [
    '回退这轮对话与文件变更',
    `回退 ${summary.restoreFileCount} 个文件修改，删除 ${summary.deleteFileCount} 个新增文件。`,
    '注意：会覆盖期间的手动修改'
  ];

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
      surface: createUndoInfoSurface('/undo 不可用', [
        summary.reason,
        '上一轮记录将保留，文件系统不会被修改。'
      ]),
      data: {mode: 'info'}
    };
  }

  return {
    surface: createUndoInfoSurface('/undo 不可用', ['暂无可回退的上一轮修改。']),
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
    host.composer.reset();
    const view = createUndoStartSurface(host.undo.getSummary());

    host.session.open({
      commandName: 'undo',
      handler: this,
      surface: view.surface,
      data: view.data
    });
  }

  handleEvent(session: CommandSession<UndoCommandData>, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.ESCAPE) {
      host.session.close();
      host.composer.reset();
      return;
    }

    if (event.type !== INPUT_EVENTS.SUBMIT) {
      return;
    }

    if (session.data?.mode !== 'confirm') {
      host.session.close();
      host.composer.reset();
      return;
    }

    const result = host.undo.execute();

    if (!result.ok) {
      host.session.update({surface: createUndoFailureSurface(result), data: {mode: 'info'}});
      return;
    }

    host.session.close();
    host.composer.reset();
    host.ui.renderResizeRecovery();
  }
}

export {
  UndoCommandHandler,
  createUndoConfirmSurface,
  createUndoInfoSurface
};
