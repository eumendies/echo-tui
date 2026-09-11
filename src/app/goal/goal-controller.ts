import {cloneGoalState} from '../state/transcript-context';
import {DEFAULT_GOAL_MAX_TURNS, GOAL_CONDITION_MAX_LENGTH} from '../../types/goal';

import type {AgentUserConfigSnapshot, AssistantTurnOutcome, InteractionMode} from '../../types/agent';
import type {CommandGoalMutationResult} from '../../types/command';
import type {GoalContinuationRequest, GoalEvaluation, GoalEvaluationActivity, GoalState} from '../../types/goal';
import type {GoalEvaluator} from './evaluator';
import type {TranscriptRecord, UserTranscriptMetadata} from '../../types/transcript';

type GoalControllerTranscript = {
  goalState: GoalState | null; // 当前会话 goal 状态；由 TranscriptContext 持有并持久化。
  getRecords(): TranscriptRecord[]; // 当前 transcript 记录引用；评估证据的投影来源。
  setGoalState(goalState: GoalState | null): void; // 更新内存状态并标记待写 journal。
  appendRecord(record: TranscriptRecord): TranscriptRecord; // 追加记录，并与待写状态同批持久化。
};

type GoalControllerDependencies = {
  transcript: GoalControllerTranscript; // goal 状态、通知与评估证据的唯一持久化边界。
  evaluator: GoalEvaluator; // 独立 goal 评估器；失败关闭为 unavailable。
  captureUserConfigSnapshot: () => Pick<AgentUserConfigSnapshot, 'resolveLlmConfigForProfile' | 'revision'>; // 评估请求使用的配置 revision。
  getGoalEvaluationModelProfileId: () => string | null; // 返回当前有效的评估模型 profile id；未配置或失效时返回 null。
  getInteractionMode: () => InteractionMode; // 评估 usage 账本沿用的交互模式。
  canStartContinuation: () => boolean; // 让位检查：进行中的回合、pending 消息或 command session 均阻止发起。
  continueTurn: (request: GoalContinuationRequest) => Promise<AssistantTurnOutcome>; // 独立入口执行一次自动推进回合。
  renderRecords: (records: TranscriptRecord[]) => void; // 把新增通知投影到可见 transcript。
};

type GoalController = {
  getEvaluationActivity(): GoalEvaluationActivity | null; // 评估请求进行中时返回已耗时；否则为 null。
  getGoal(): GoalState | null;
  setGoal(condition: string): CommandGoalMutationResult;
  pauseGoal(): CommandGoalMutationResult;
  resumeGoal(): CommandGoalMutationResult;
  clearGoal(): CommandGoalMutationResult;
  handleTurnFinished(outcome: AssistantTurnOutcome): void; // 主会话回合完成后的生命周期通知入口。
};

type GoalContinuationTurn = {
  userText: string; // provider-facing 内部续跑指令。
  userRequestText: string; // 工具审批可引用的可信用户请求来源。
  displayText: string; // 用户可见的自动推进标记。
  metadata: UserTranscriptMetadata; // 标识该用户记录由 goal 自动续跑生成。
};

type GoalFlowMode = 'kickoff' | 'evaluate';

const MISSING_GOAL_EVALUATION_MODEL_ERROR = '未配置可用的 goal 评估模型：请在 /config 选择 goal 评估模型';

/**
 * 构造自动续跑回合的提交素材：内部指令包含条件与该轮上下文；
 * 展示文本只暴露轮次进度，不泄漏指令细节。
 */
function createGoalContinuationTurn(request: GoalContinuationRequest): GoalContinuationTurn {
  const userText = [
    `Continue working toward the standing goal (automatic continuation turn ${request.turn}/${request.maxTurns}).`,
    '',
    'Goal condition:',
    request.condition,
    '',
    request.previousReason
      ? `The latest evaluation still finds the goal unmet: ${request.previousReason}`
      : 'The goal was just set; begin making progress toward it.',
    'Provide verifiable evidence of progress in this session, and end the turn with a concise status summary.'
  ].join('\n');

  return {
    userText,
    userRequestText: `Standing goal: ${request.condition}`,
    displayText: `[goal] 自动继续（第 ${request.turn}/${request.maxTurns} 轮）`,
    metadata: {goalContinuation: {turn: request.turn, maxTurns: request.maxTurns}}
  };
}

/**
 * 管理 goal 生命周期与自动续跑：状态变更经 TranscriptContext 落盘并附 local notice；
 * 回合完成后评估证据，未达成且未达上限时经独立入口发起下一回合。让位规则保证用户输入通道优先。
 */
function createGoalController(dependencies: GoalControllerDependencies): GoalController {
  let activationRecordIndex = 0; // 目标激活时的 transcript 长度；评估证据从该边界起投影。
  let evaluationStartedAtMs: number | null = null; // 进行中评估请求的开始时间；null 表示当前没有评估请求。
  let flowRunning = false; // 评估驱动流程是否正在运行。
  let flowRerun: GoalFlowMode | null = null; // 运行期间到达的重跑请求；kickoff 优先于 evaluate。

  /** 追加生命周期通知；先 setGoalState 再 appendRecord 使状态与通知落在同一 journal 操作。 */
  function appendNotice(text: string): void {
    const record = dependencies.transcript.appendRecord({role: 'local_notice', text});
    dependencies.renderRecords([record]);
  }

  /** 读取当前 active 目标；paused、已清除或不存在时返回 null。 */
  function currentActiveGoal(): GoalState | null {
    const goal = dependencies.transcript.goalState;
    return goal && goal.status === 'active' ? goal : null;
  }

  /** 暂停当前 active 目标并写入含恢复指引的通知；可同时记录最近评估。 */
  function pauseGoalWithNotice(reason: string, evaluation?: GoalEvaluation): void {
    const goal = currentActiveGoal();

    if (!goal) {
      return;
    }

    dependencies.transcript.setGoalState({
      ...goal,
      status: 'paused',
      ...(evaluation ? {lastEvaluation: evaluation} : {})
    });
    appendNotice(`目标已暂停：${reason}（/goal resume 恢复推进）`);
  }

  /** 记录未达成评估并写入含轮次与理由的通知；状态与通知同批持久化。 */
  function recordEvaluation(goal: GoalState, evaluation: GoalEvaluation): void {
    dependencies.transcript.setGoalState({...goal, lastEvaluation: evaluation});
    appendNotice(`目标评估（已推进 ${goal.turns}/${goal.maxTurns} 轮）：未达成 — ${evaluation.reason}`);
  }

  /** 达成：清除目标状态并写入含总轮次与理由的完成通知。 */
  function completeGoal(goal: GoalState, evaluation: GoalEvaluation): void {
    dependencies.transcript.setGoalState(null);
    const turnsSuffix = goal.turns > 0 ? `（共 ${goal.turns} 轮自动推进）` : '';
    appendNotice(`目标达成${turnsSuffix}：${evaluation.reason}`);
  }

  /**
   * 执行一次目标评估；配置缺失直接判为不可用，证据从激活边界起投影。
   * 请求存续期间暴露评估活动，footer 据此展示评估中指示。
   */
  async function evaluateGoal(goal: GoalState): Promise<GoalEvaluation> {
    const profileId = dependencies.getGoalEvaluationModelProfileId();

    if (!profileId) {
      return {outcome: 'unavailable', reason: MISSING_GOAL_EVALUATION_MODEL_ERROR, at: new Date().toISOString()};
    }

    const records = dependencies.transcript.getRecords();
    const evidence = records.slice(Math.min(activationRecordIndex, records.length));
    evaluationStartedAtMs = Date.now();

    try {
      const result = await dependencies.evaluator({
        condition: goal.condition,
        interactionMode: dependencies.getInteractionMode(),
        modelProfileId: profileId,
        records: evidence,
        userConfigSnapshot: dependencies.captureUserConfigSnapshot()
      });

      return {outcome: result.outcome, reason: result.reason, at: new Date().toISOString()};
    } finally {
      evaluationStartedAtMs = null;
    }
  }

  /** 取走待重跑请求；每轮周期结束调用一次。 */
  function consumeRerun(): GoalFlowMode | null {
    const mode = flowRerun;
    flowRerun = null;
    return mode;
  }

  /**
   * 运行一轮推进周期：kickoff 先发起推进回合，evaluate 先评估最近回合证据；
   * 未达成且未达上限时继续发起下一回合。返回需要接续的重跑模式。
   */
  async function runFlowCycle(mode: GoalFlowMode): Promise<GoalFlowMode | null> {
    let phase: 'start-turn' | 'evaluate' = mode === 'kickoff' ? 'start-turn' : 'evaluate';
    let previousReason: string | null = null;

    while (true) {
      const goal = currentActiveGoal();

      // 让位：用户输入通道被占用时评估与推进都不发起，等待后续回合完成通知恢复。
      if (!goal || !dependencies.canStartContinuation()) {
        return consumeRerun();
      }

      if (phase === 'start-turn') {
        const turn = goal.turns + 1;
        const revision = goal.revision;
        dependencies.transcript.setGoalState({...goal, turns: turn});
        const outcome = await dependencies.continueTurn({
          condition: goal.condition,
          turn,
          maxTurns: goal.maxTurns,
          previousReason
        });
        const current = currentActiveGoal();

        // 迟到隔离：回合期间目标被替换、暂停或清除时不消费 outcome。
        if (!current || current.revision !== revision) {
          return consumeRerun();
        }

        if (outcome === 'cancelled') {
          pauseGoalWithNotice('自动推进回合被中断');
          return consumeRerun();
        }

        if (outcome === 'failed') {
          pauseGoalWithNotice('自动推进回合执行失败');
          return consumeRerun();
        }

        phase = 'evaluate';
        continue;
      }

      const revision = goal.revision;
      const evaluation = await evaluateGoal(goal);
      const current = currentActiveGoal();

      // 迟到隔离：评估期间目标被替换、暂停或清除时丢弃结果。
      if (!current || current.revision !== revision) {
        return consumeRerun();
      }

      if (evaluation.outcome === 'unavailable') {
        pauseGoalWithNotice(`评估不可用 — ${evaluation.reason}`, evaluation);
        return consumeRerun();
      }

      if (evaluation.outcome === 'met') {
        completeGoal(current, evaluation);
        return consumeRerun();
      }

      if (current.turns >= current.maxTurns) {
        pauseGoalWithNotice(`已达到 ${current.maxTurns} 轮自动推进上限`, evaluation);
        return consumeRerun();
      }

      recordEvaluation(current, evaluation);
      previousReason = evaluation.reason;
      phase = 'start-turn';
    }
  }

  /** 串行运行推进流程；运行期间到达的请求合并为一次重跑。 */
  async function runFlow(mode: GoalFlowMode): Promise<void> {
    flowRunning = true;
    let next: GoalFlowMode | null = mode;

    try {
      while (next) {
        next = await runFlowCycle(next);

        // 周期返回与循环调度之间到达的请求在此补消费，避免残留到下一次流程。
        if (next === null) {
          next = consumeRerun();
        }
      }
    } catch {
      // 推进流程自身异常：失败关闭为暂停，避免 unhandled rejection 悬挂目标。
      pauseGoalWithNotice('自动推进流程异常');
    } finally {
      flowRunning = false;
    }
  }

  /** 请求推进流程；已有流程运行时合并重跑请求，kickoff 优先于 evaluate。 */
  function requestFlow(mode: GoalFlowMode): void {
    if (flowRunning) {
      if (mode === 'kickoff' || flowRerun === null) {
        flowRerun = mode;
      }

      return;
    }

    void runFlow(mode);
  }

  return {
    getEvaluationActivity(): GoalEvaluationActivity | null {
      return evaluationStartedAtMs === null ? null : {elapsedMs: Math.max(0, Date.now() - evaluationStartedAtMs)};
    },

    getGoal(): GoalState | null {
      return cloneGoalState(dependencies.transcript.goalState);
    },

    setGoal(condition: string): CommandGoalMutationResult {
      const trimmed = condition.trim();

      if (trimmed === '') {
        return {ok: false, error: '目标条件不能为空'};
      }

      if (trimmed.length > GOAL_CONDITION_MAX_LENGTH) {
        return {ok: false, error: `目标条件不能超过 ${GOAL_CONDITION_MAX_LENGTH} 字符`};
      }

      if (!dependencies.getGoalEvaluationModelProfileId()) {
        return {ok: false, error: MISSING_GOAL_EVALUATION_MODEL_ERROR};
      }

      const previous = dependencies.transcript.goalState;
      const goalState: GoalState = {
        condition: trimmed,
        status: 'active',
        revision: (previous?.revision ?? 0) + 1,
        startedAt: new Date().toISOString(),
        turns: 0,
        maxTurns: DEFAULT_GOAL_MAX_TURNS
      };
      dependencies.transcript.setGoalState(goalState);
      appendNotice(`目标已设置：${trimmed}（最多 ${goalState.maxTurns} 轮）`);
      activationRecordIndex = dependencies.transcript.getRecords().length;
      requestFlow('kickoff');
      return {ok: true};
    },

    pauseGoal(): CommandGoalMutationResult {
      const goal = dependencies.transcript.goalState;

      if (!goal) {
        return {ok: false, error: '当前没有目标'};
      }

      if (goal.status === 'paused') {
        return {ok: true};
      }

      dependencies.transcript.setGoalState({...goal, status: 'paused'});
      appendNotice('目标已暂停（/goal resume 恢复推进）');
      return {ok: true};
    },

    resumeGoal(): CommandGoalMutationResult {
      const goal = dependencies.transcript.goalState;

      if (!goal) {
        return {ok: false, error: '当前没有目标'};
      }

      if (goal.status === 'active') {
        return {ok: true};
      }

      if (!dependencies.getGoalEvaluationModelProfileId()) {
        return {ok: false, error: MISSING_GOAL_EVALUATION_MODEL_ERROR};
      }

      dependencies.transcript.setGoalState({
        ...goal,
        status: 'active',
        revision: goal.revision + 1,
        startedAt: new Date().toISOString()
      });
      appendNotice('目标已恢复：自动继续推进');
      activationRecordIndex = dependencies.transcript.getRecords().length;
      requestFlow('kickoff');
      return {ok: true};
    },

    clearGoal(): CommandGoalMutationResult {
      const goal = dependencies.transcript.goalState;

      if (!goal) {
        return {ok: false, error: '当前没有目标'};
      }

      dependencies.transcript.setGoalState(null);
      activationRecordIndex = 0;
      appendNotice(`目标已清除：${goal.condition}`);
      return {ok: true};
    },

    handleTurnFinished(outcome: AssistantTurnOutcome): void {
      if (!currentActiveGoal()) {
        return;
      }

      if (outcome === 'completed') {
        requestFlow('evaluate');
        return;
      }

      pauseGoalWithNotice(outcome === 'cancelled' ? '回合已被中断' : '回合执行失败');
    }
  };
}

export {
  MISSING_GOAL_EVALUATION_MODEL_ERROR,
  createGoalContinuationTurn,
  createGoalController
};

export type {
  GoalContinuationTurn,
  GoalController,
  GoalControllerDependencies,
  GoalControllerTranscript
};
