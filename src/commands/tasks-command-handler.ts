import {INPUT_EVENTS} from '../input/event-types';
import {TASKS_LOG_MAX_LINES} from '../render/footer/tasks-surface';

import type {CommandHandler, CommandHost, CommandSession, TasksCommandSurface, TasksCommandSurfaceMode} from '../types/command';
import type {BackgroundTaskView} from '../types/background-task';
import type {InputEvent} from '../types/input';

const TASKS_LOG_TAIL_BYTES = 8 * 1024;

type TasksCommandData = {
  mode: TasksCommandSurfaceMode; // 当前层级;Esc 逐级返回。
  selectedIndex: number; // 列表焦点的绝对索引。
  logLines?: string[]; // 详情层日志尾部快照。
  logTruncated?: boolean; // 日志尾部被行预算截断。
  logUnavailable?: string; // 日志不可读取原因。
  error?: string; // 停止失败等操作的说明。
};

type DetailOptions = {
  error?: string;
  logLines?: string[];
  logTruncated?: boolean;
  logUnavailable?: string;
};

/**
 * 用一次任务快照构造面板投影;进入、导航与刷新都复用同一入口,不在渲染期读取运行态。
 */
function captureTasksSnapshot(tasks: BackgroundTaskView[], mode: TasksCommandSurfaceMode, selectedIndex: number, options: DetailOptions = {}): {data: TasksCommandData; surface: TasksCommandSurface} {
  const index = Math.max(0, Math.min(selectedIndex, Math.max(0, tasks.length - 1)));
  const data: TasksCommandData = {
    mode,
    selectedIndex: index,
    ...(options.error ? {error: options.error} : {}),
    ...(options.logLines ? {logLines: options.logLines} : {}),
    ...(options.logTruncated ? {logTruncated: true} : {}),
    ...(options.logUnavailable ? {logUnavailable: options.logUnavailable} : {})
  };

  return {data, surface: createTasksSurface(tasks, data)};
}

/** 根据任务快照与当前层级生成面板；标题只描述操作，内部任务身份不进入展示。 */
function createTasksSurface(tasks: BackgroundTaskView[], data: TasksCommandData): TasksCommandSurface {
  const runningCount = tasks.filter((task) => task.managed && (task.state === 'running' || task.state === 'stopping')).length;
  const mode = data.mode;

  return {
    kind: 'tasks',
    title: mode === 'list'
      ? `/tasks 后台任务 (${tasks.length})`
      : `/tasks ${mode === 'confirmStop' ? '停止任务' : '任务详情'}${runningCount > 0 ? ` · 运行中 ${runningCount}` : ''}`,
    mode,
    tasks,
    selectedIndex: data.selectedIndex,
    ...(data.logLines ? {logLines: data.logLines} : {}),
    ...(data.logTruncated ? {logTruncated: true} : {}),
    ...(data.logUnavailable ? {logUnavailable: data.logUnavailable} : {}),
    ...(data.error ? {error: data.error} : {}),
    dismissHint: mode === 'list'
      ? '↑↓ 选择 · Enter 查看 · r 刷新 · Esc 关闭'
      : mode === 'detail'
        ? 'r 刷新 · s 停止(仅运行中) · Esc 返回'
        : 'Enter 确认停止 · Esc 取消'
  };
}

/** 读取有界日志尾部;不可读时返回原因文本,不伪装成空日志。 */
function readTaskLog(host: CommandHost, task: BackgroundTaskView | undefined): DetailOptions {
  if (!task) {
    return {};
  }

  const text = task.managed
    ? host.background.readLog(task.reference.taskId, TASKS_LOG_TAIL_BYTES)
    : host.background.readReferenceLog(task.reference, TASKS_LOG_TAIL_BYTES);

  if (text === null) {
    return {logUnavailable: '日志文件不可读取。'};
  }

  const lines = text.split('\n');
  // 尾部换行会产生一个空元素,展示时去掉以免多一行空白。
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const truncated = lines.length > TASKS_LOG_MAX_LINES || Buffer.byteLength(text, 'utf8') >= TASKS_LOG_TAIL_BYTES;
  return {logLines: lines.slice(-TASKS_LOG_MAX_LINES), ...(truncated ? {logTruncated: true} : {})};
}

export class TasksCommandHandler implements CommandHandler<TasksCommandData> {
  name = 'tasks';
  description = '查看后台任务';

  /** 只接受无参数命令,避免把未来参数语法静默忽略。 */
  match(text: string): boolean {
    return text.trimEnd() === '/tasks';
  }

  start(_text: string, host: CommandHost): void {
    const tasks = host.background.list();
    const snapshot = captureTasksSnapshot(tasks, 'list', 0, readTaskLog(host, tasks[0]));
    host.session.open({commandName: 'tasks', handler: this, surface: snapshot.surface, data: snapshot.data});
  }

  async handleEvent(session: CommandSession<TasksCommandData>, event: InputEvent, host: CommandHost): Promise<void> {
    const data = session.data;

    if (!data) {
      host.session.close();
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.goBack(data, host);
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT && event.value === 'r') {
      this.refresh(data, host);
      return;
    }

    if (data.mode === 'list') {
      this.handleListEvent(data, event, host);
      return;
    }

    if (data.mode === 'detail') {
      await this.handleDetailEvent(data, event, host);
      return;
    }

    await this.handleConfirmStopEvent(session, data, event, host);
  }

  /** Esc 逐级返回:确认回详情,详情回列表,列表关闭。 */
  private goBack(data: TasksCommandData, host: CommandHost): void {
    if (data.mode === 'list') {
      host.session.close();
      return;
    }

    const tasks = host.background.list();

    if (data.mode === 'detail') {
      this.openList(data, host, tasks, {});
      return;
    }

    this.openDetail(data, host, tasks, {});
  }

  private handleListEvent(data: TasksCommandData, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      const delta = event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1;
      this.openList(data, host, host.background.list(), {}, data.selectedIndex + delta);
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      this.openDetail(data, host, host.background.list(), {});
    }
  }

  private async handleDetailEvent(data: TasksCommandData, event: InputEvent, host: CommandHost): Promise<void> {
    if (event.type !== INPUT_EVENTS.TEXT || event.value !== 's') {
      return;
    }

    const tasks = host.background.list();
    const task = tasks[data.selectedIndex];

    // 历史条目没有句柄:只保留读取能力,不提供可重复停止的活动操作。
    if (!task || !task.managed || (task.state !== 'running' && task.state !== 'stopping')) {
      this.openDetail(data, host, tasks, {error: '该任务已结束或属于历史记录，无法停止。'});
      return;
    }

    const snapshot = captureTasksSnapshot(tasks, 'confirmStop', data.selectedIndex);
    host.session.update({surface: snapshot.surface, data: snapshot.data});
  }

  private async handleConfirmStopEvent(session: CommandSession<TasksCommandData>, data: TasksCommandData, event: InputEvent, host: CommandHost): Promise<void> {
    if (event.type !== INPUT_EVENTS.SUBMIT) {
      return;
    }

    const tasks = host.background.list();
    const task = tasks[data.selectedIndex];

    if (!task) {
      this.openDetail(data, host, tasks, {error: '任务已不在当前快照中，按 r 刷新。'});
      return;
    }

    const stopped = await host.background.stop(task.reference.taskId);

    // 停止是异步的:期间用户可能已切到别的命令界面,迟到结果不得覆盖它。
    if (host.session.getActive() !== session) {
      return;
    }

    this.openDetail(data, host, host.background.list(), stopped ? {} : {error: '任务未能停止或已经结束。'});
  }

  private openList(data: TasksCommandData, host: CommandHost, tasks: BackgroundTaskView[], options: {error?: string}, selectedIndex = data.selectedIndex): void {
    const index = Math.max(0, Math.min(selectedIndex, Math.max(0, tasks.length - 1)));
    // 宽屏右侧要展示日志预览,因此列表层也读取有界尾部。
    const snapshot = captureTasksSnapshot(tasks, 'list', index, {
      ...options,
      ...readTaskLog(host, tasks[index])
    });
    host.session.update({surface: snapshot.surface, data: snapshot.data});
  }

  private openDetail(data: TasksCommandData, host: CommandHost, tasks: BackgroundTaskView[], options: {error?: string}): void {
    const snapshot = captureTasksSnapshot(tasks, 'detail', data.selectedIndex, {
      ...options,
      ...readTaskLog(host, tasks[data.selectedIndex])
    });
    host.session.update({surface: snapshot.surface, data: snapshot.data});
  }

  /** r 在当前层级重新取快照;详情层同时刷新日志尾部。 */
  private refresh(data: TasksCommandData, host: CommandHost): void {
    const tasks = host.background.list();

    if (data.mode === 'list') {
      this.openList(data, host, tasks, {});
      return;
    }

    if (data.mode === 'confirmStop') {
      const snapshot = captureTasksSnapshot(tasks, 'confirmStop', data.selectedIndex);
      host.session.update({surface: snapshot.surface, data: snapshot.data});
      return;
    }

    this.openDetail(data, host, tasks, {});
  }
}

export {
  TASKS_LOG_TAIL_BYTES,
  captureTasksSnapshot,
  createTasksSurface,
  readTaskLog
};

export type {
  TasksCommandData
};
