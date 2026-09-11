import {createGoalController} from '../goal/goal-controller';
import {createGoalEvaluator} from '../goal/evaluator';

import type {GoalController} from '../goal/goal-controller';
import type {AppContext} from '../state/app-context';
import type {AgentUserConfigSnapshot, AssistantTurnOutcome} from '../../types/agent';
import type {GoalContinuationRequest} from '../../types/goal';
import type {TranscriptRecord} from '../../types/transcript';
import type {UsageStore} from '../../types/usage';

type GoalCommandPortOptions = {
  appContext: Pick<AppContext, 'transcriptContext' | 'getCurrentCwd' | 'getInteractionMode'>; // 提供 goal 状态持久化边界、usage 分区 cwd 与交互模式。
  captureUserConfigSnapshot: () => AgentUserConfigSnapshot; // 每次校验时捕获最新用户配置 revision。
  renderRecords: (records: TranscriptRecord[]) => void; // 把 goal 生命周期通知投影到主 transcript。
  usageStore?: UsageStore; // 评估请求的可选 usage 账本。
  canStartContinuation: () => boolean; // 让位检查：用户输入通道占用时阻止发起评估或推进回合。
  continueTurn: (request: GoalContinuationRequest) => Promise<AssistantTurnOutcome>; // 组合根提供的独立推进回合入口。
};

/**
 * 在 app 组合根装配 goal 受控端口：把 AppContext、用户配置与回合入口解析为 GoalController 的窄依赖。
 * 返回实例由组合根持有，用于衔接回合完成通知与自动续跑。
 */
function createGoalCommandPort(options: GoalCommandPortOptions): GoalController {
  return createGoalController({
    transcript: options.appContext.transcriptContext,
    evaluator: createGoalEvaluator({cwd: () => options.appContext.getCurrentCwd(), usageStore: options.usageStore}),
    captureUserConfigSnapshot: options.captureUserConfigSnapshot,
    getGoalEvaluationModelProfileId: () => resolveGoalEvaluationModelProfileId(options.captureUserConfigSnapshot()),
    getInteractionMode: () => options.appContext.getInteractionMode(),
    canStartContinuation: options.canStartContinuation,
    continueTurn: options.continueTurn,
    renderRecords: options.renderRecords
  });
}

/**
 * 严格解析 goal 评估模型 profile：未配置、引用失效或配置损坏时返回 null。
 */
function resolveGoalEvaluationModelProfileId(snapshot: AgentUserConfigSnapshot): string | null {
  const profileId = snapshot.getAppSettings().goalEvaluationModelProfileId;

  if (!profileId) {
    return null;
  }

  try {
    snapshot.resolveLlmConfigForProfile(profileId);
    return profileId;
  } catch {
    return null;
  }
}

export {
  createGoalCommandPort,
  resolveGoalEvaluationModelProfileId
};

export type {
  GoalCommandPortOptions
};
