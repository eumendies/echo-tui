import {sanitizeTerminalText} from '../../terminal/control-chars';
import {capUtf8Text} from '../tool-handler-utils';

import type {BackgroundTaskView} from '../../types/background-task';

/**
 * 用有界单行命令摘要标识已结束任务；隐藏内部编号，不猜测命令输出内容。
 */
function formatBackgroundTaskNotice(view: BackgroundTaskView): string {
  const outcome = view.state === 'exited'
    ? (view.exitCode === 0 ? '已完成 (exit 0)' : `已结束 (exit ${view.exitCode === null ? 'unknown' : view.exitCode})`)
    : view.state === 'stopped'
      ? `已被停止${view.reason ? ` (${formatStopReason(view.reason)})` : ''}`
      : view.state === 'failed'
        ? `执行失败${view.reason ? ` (${formatStopReason(view.reason)})` : ''}`
        : `状态 ${view.state}`;

  const summary = capUtf8Text(sanitizeTerminalText(view.command).replace(/\s+/gu, ' ').trim() || '(未知命令)', 160);
  const command = `${summary.text}${summary.truncated ? '…' : ''}`;
  return `后台任务「${command}」${outcome}。用 /tasks 查看。`;
}

function formatStopReason(reason: string): string {
  switch (reason) {
    case 'user_stop':
      return '用户停止';
    case 'timeout':
      return '超时';
    case 'output_limit':
      return '日志上限';
    case 'session_cleanup':
      return '会话清理';
    case 'app_exit':
      return '退出清理';
    case 'cleanup_timeout':
      return '未能确认停止';
    case 'runtime_error':
      return '运行时故障';
    default:
      return reason;
  }
}

export {
  formatBackgroundTaskNotice,
  formatStopReason
};
