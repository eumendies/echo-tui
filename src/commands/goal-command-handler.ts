import {INPUT_EVENTS} from '../input/event-types';

import type {CommandGoalMutationResult, CommandHandler, CommandHost, CommandSession, InfoCommandSurface} from '../types/command';
import type {GoalEvaluationOutcome, GoalState} from '../types/goal';
import type {InputEvent} from '../types/input';

const GOAL_CLEAR_ALIASES = new Set(['clear', 'stop', 'off', 'reset', 'cancel']);

const GOAL_USAGE_LINES = [
  '用法: /goal <完成条件>',
  '设置后每个回合结束由独立评估模型判定；未达成会继续推进。',
  '',
  '/goal          查看目标状态',
  '/goal pause    暂停自动推进',
  '/goal resume   恢复自动推进',
  '/goal clear    清除目标'
];

const GOAL_OPERATION_HINT_LINES = [
  '/goal pause    暂停自动推进',
  '/goal resume   恢复自动推进',
  '/goal clear    清除目标'
];

const GOAL_OUTCOME_LABELS: Record<GoalEvaluationOutcome, string> = {
  met: '达成',
  not_met: '未达成',
  unavailable: '不可用'
};

function createGoalInfoSurface(lines: string[]): InfoCommandSurface {
  return {
    kind: 'info',
    title: '/goal',
    lines,
    dismissHint: 'Esc 关闭'
  };
}

function createGoalNoGoalSurface(): InfoCommandSurface {
  return createGoalInfoSurface(['当前没有目标。', '', ...GOAL_USAGE_LINES]);
}

function createGoalErrorSurface(error: string): InfoCommandSurface {
  return createGoalInfoSurface([error, '', ...GOAL_USAGE_LINES]);
}

/**
 * 把激活时间格式化为状态卡用的粗略耗时；非法时间返回未知。
 */
function formatGoalElapsed(startedAt: string): string {
  const startedAtMs = Date.parse(startedAt);

  if (!Number.isFinite(startedAtMs)) {
    return '未知';
  }

  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds} 秒`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes < 60) {
    return `${totalMinutes} 分钟`;
  }

  return `${Math.floor(totalMinutes / 60)} 小时 ${totalMinutes % 60} 分钟`;
}

function formatGoalStatus(goal: GoalState): string {
  return goal.status === 'active'
    ? `active（已推进 ${goal.turns}/${goal.maxTurns} 轮）`
    : 'paused（/goal resume 恢复推进）';
}

function createGoalStatusSurface(goal: GoalState): InfoCommandSurface {
  const lines = [
    `目标: ${goal.condition}`,
    `状态: ${formatGoalStatus(goal)}`,
    `耗时: ${formatGoalElapsed(goal.startedAt)}`
  ];

  if (goal.lastEvaluation) {
    lines.push(`最近评估: ${GOAL_OUTCOME_LABELS[goal.lastEvaluation.outcome]} — ${goal.lastEvaluation.reason}`);
  }

  lines.push('', ...GOAL_OPERATION_HINT_LINES);
  return createGoalInfoSurface(lines);
}

export class GoalCommandHandler implements CommandHandler {
  name = 'goal';
  description = '设置常驻目标并自动推进';

  /**
   * 只接管 /goal 及其空格分隔参数，避免误吞其他命令。
   */
  match(text: string): boolean {
    return /^\/goal(?:\s+.*)?$/.test(text);
  }

  /**
   * 裸命令展示状态卡；pause/resume/clear 及别名直接应用到受控端口；其余参数按完成条件设置目标。
   */
  start(text: string, host: CommandHost): void {
    const argument = text.trim().slice('/goal'.length).trim();

    if (argument === '') {
      this.openStatusSurface(host);
      return;
    }

    if (argument === 'pause') {
      this.applyMutation(host, host.goal.pauseGoal());
      return;
    }

    if (argument === 'resume') {
      this.applyMutation(host, host.goal.resumeGoal());
      return;
    }

    if (GOAL_CLEAR_ALIASES.has(argument)) {
      this.applyMutation(host, host.goal.clearGoal());
      return;
    }

    this.applyMutation(host, host.goal.setGoal(argument));
  }

  /**
   * 状态卡与错误提示只消费 Esc，其余事件交由运行时忽略。
   */
  handleEvent(_session: CommandSession, event: InputEvent, host: CommandHost): void {
    if (event.type === INPUT_EVENTS.ESCAPE) {
      host.session.close();
    }
  }

  private openStatusSurface(host: CommandHost): void {
    const goal = host.goal.getGoal();

    host.session.open({
      commandName: 'goal',
      handler: this,
      surface: goal ? createGoalStatusSurface(goal) : createGoalNoGoalSurface(),
      data: null
    });
  }

  private applyMutation(host: CommandHost, result: CommandGoalMutationResult): void {
    if (result.ok) {
      return;
    }

    host.session.open({
      commandName: 'goal',
      handler: this,
      surface: createGoalErrorSurface(result.error),
      data: null
    });
  }
}

export {
  GOAL_USAGE_LINES,
  createGoalErrorSurface,
  createGoalNoGoalSurface,
  createGoalStatusSurface,
  formatGoalElapsed
};
