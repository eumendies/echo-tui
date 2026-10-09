import type {PendingMessageRenderState} from '../../types/render';
import type {AgentSteeringInputPort, InteractionMode} from '../../types/agent';
import type {TranscriptRecord} from '../../types/transcript';

type PendingMessage = {
  id: number; // 单槽条目的身份，用于拒绝移除后的迟到准备结果。
  text: string; // 接收时的原始输入；pending 在真正发送时才展开。
  kind: 'pending' | 'steer'; // 决定走下一轮普通路由还是当前运行的安全边界。
  interactionMode?: InteractionMode; // 普通排队消息接收时的选择；命令和 shell 保留原路由契约。
  targetTurnId?: number; // 引导绑定的主 turn；结束后由 idle dispatcher 唯一接管。
  record?: Extract<TranscriptRecord, {role: 'user'}>; // 准备好的最终记录，同时供当前运行和终态移交使用。
  error?: string; // 素材准备失败提示；失败条目保留原文供用户移除。
};

type PendingMessageDispatch = {
  text: string; // 保留输入历史与观测使用的原文。
  interactionMode?: InteractionMode; // 普通消息下一轮实际发送时仍沿用该条消息的选择。
  record?: Extract<TranscriptRecord, {role: 'user'}>; // 有该字段时禁止再次展开已准备素材。
};

/**
 * 管理排队与引导共用的单槽；准备身份、运行绑定和同步 claim 保证唯一交付。
 */
class PendingMessageContext {
  private pending: PendingMessage | null = null;
  private nextId = 1;
  private activeTurnId: number | null = null;
  private readonly listeners = new Set<() => void>();

  /** 返回当前待发送文本。 */
  getPending(): string | null {
    return this.pending?.text ?? null;
  }

  /** 返回 footer 所需的单行预览与素材准备状态；不投影运行阶段或等待原因。 */
  getRenderState(): PendingMessageRenderState | null {
    if (!this.pending) {
      return null;
    }

    const message = this.pending;
    const status = message.kind === 'pending' ? undefined
      : message.error ? 'failed'
      : !message.record ? 'preparing'
      : 'ready';
    return {preview: normalizePreview(message.text), ...(status ? {status} : {}), ...(message.error ? {error: message.error} : {})};
  }

  /** 槽位为空且文本非空时入队；已有消息时拒绝覆盖。 */
  enqueue(text: string, interactionMode?: InteractionMode): boolean {
    if (this.pending !== null || text === '') {
      return false;
    }

    this.pending = {id: this.nextId++, text, kind: 'pending', ...(interactionMode ? {interactionMode} : {})};
    return true;
  }

  /** 空闲提交消费普通文本或准备好的记录；准备中与失败条目不能被提前清空。 */
  claimForDispatch(): PendingMessageDispatch | null {
    const message = this.pending;
    if (!message || message.kind === 'steer' && !message.record) return null;
    this.pending = null;
    return {text: message.text, ...(message.interactionMode ? {interactionMode: message.interactionMode} : {}), ...(message.record ? {record: message.record} : {})};
  }

  /** 为活动 turn 预留引导槽位；调用方成功后才消费 composer。 */
  beginSteer(text: string, targetTurnId: number): number | null {
    if (this.pending || text === '') return null;
    const id = this.nextId++;
    this.pending = {id, text, kind: 'steer', targetTurnId};
    return id;
  }

  /** 安装准备好的记录并通知当前请求；旧条目的异步完成不能复活已移除消息。 */
  completePreparation(id: number, record: Extract<TranscriptRecord, {role: 'user'}>): boolean {
    if (this.pending?.id !== id) return false;
    this.pending.record = record;
    for (const listener of this.listeners) listener();
    return true;
  }

  /** 保留失败输入供用户查看与移除，失败本身不唤醒或取消模型。 */
  failPreparation(id: number, error: string): boolean {
    if (this.pending?.id !== id) return false;
    this.pending.error = error;
    return true;
  }

  /** 绑定 provider-neutral 引导端口；所有 claim 都限定原 turn 且保持同步。 */
  createSteeringInputPort(turnId: number): AgentSteeringInputPort {
    this.activeTurnId = turnId;
    const hasReady = () => this.activeTurnId === turnId && this.pending?.kind === 'steer'
      && this.pending.targetTurnId === turnId && Boolean(this.pending.record);
    return {
      hasReady,
      claim: () => {
        if (!hasReady()) return null;
        const record = this.pending!.record!;
        this.pending = null;
        return record;
      },
      subscribe: (listener) => {
        const guarded = () => {if (hasReady()) listener();};
        this.listeners.add(guarded);
        return () => {this.listeners.delete(guarded);};
      }
    };
  }

  /** 结束运行绑定但保留未提交输入，供下一轮 dispatcher 接管；旧 finally 不解绑新 turn。 */
  finishTurn(turnId: number): void {
    if (this.activeTurnId === turnId) this.activeTurnId = null;
  }

  /** 清理尚未处理的 transient 草稿。 */
  clear(): void {
    this.pending = null;
  }
}

function normalizePreview(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

export {PendingMessageContext};
