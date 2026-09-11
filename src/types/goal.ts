export type GoalStatus = 'active' | 'paused';

export type GoalEvaluationOutcome = 'met' | 'not_met' | 'unavailable';

export type GoalEvaluation = {
  outcome: GoalEvaluationOutcome; // 评估判定：达成、未达成或评估不可用。
  reason: string; // 评估模型给出的简短理由；不可用时为本地诊断摘要。
  at: string; // 评估完成时间（ISO 8601）。
};

export type GoalEvaluationResult = {
  outcome: GoalEvaluationOutcome; // 评估判定：达成、未达成或评估不可用。
  reason: string; // 达成/未达成的简短理由，或不可用的本地诊断摘要。
};

export type GoalEvaluationActivity = {
  elapsedMs: number; // 进行中评估请求的已耗时；footer 评估中指示据此推进动画帧。
};

export type GoalContinuationRequest = {
  condition: string; // 设置目标时的完成条件；作为可信用户输入进入推进回合。
  turn: number; // 本次自动推进回合序号（从 1 开始）。
  maxTurns: number; // 自动推进回合上限。
  previousReason: string | null; // 上一轮评估未达成的理由；首个推进回合为 null。
};

export type GoalState = {
  condition: string; // 用户声明的完成条件；非空且不超过 GOAL_CONDITION_MAX_LENGTH。
  status: GoalStatus; // 目标当前生命周期状态；paused 表示等待用户 /goal resume。
  revision: number; // 设置、替换或恢复目标时递增；用于隔离迟到评估与回合回调。
  startedAt: string; // 本次激活时间（ISO 8601）；resume 归一化时刷新为恢复时间。
  turns: number; // 已发起的自动推进回合数；不会超过 maxTurns。
  maxTurns: number; // 自动推进回合上限；达到且未达成时暂停目标。
  lastEvaluation?: GoalEvaluation; // 最近一次评估结果；尚无评估或恢复后省略为历史参考。
};

export const GOAL_CONDITION_MAX_LENGTH = 4000;

export const DEFAULT_GOAL_MAX_TURNS = 20;
