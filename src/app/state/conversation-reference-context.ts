import type {PendingConversationReference} from '../../types/transcript';

/**
 * 管理 composer 的单个对话引用附件及准备取消句柄，不持有持久化 transcript 状态。
 */
class ConversationReferenceContext {
  private pending: PendingConversationReference | null = null;
  private preparationController: AbortController | null = null;

  /** 返回 pending 引用快照，避免调用方修改内部素材。 */
  getPending(): PendingConversationReference | null {
    return this.pending ? structuredClone(this.pending) : null;
  }

  /** 返回 footer 所需的最小投影，不暴露历史正文和源路径。 */
  getRenderState(): (Pick<PendingConversationReference, 'projectionMode' | 'title'> & {preparing: boolean}) | null {
    return this.pending ? {preparing: this.isPreparing(), projectionMode: this.pending.projectionMode, title: this.pending.title} : null;
  }

  /** 判断当前是否持有有效的总结取消句柄。 */
  isPreparing(): boolean {
    return this.preparationController !== null;
  }

  /**
   * 替换 composer 当前引用；选择阶段只保存 replay 后的中立素材，不触发总结。
   */
  setPending(reference: PendingConversationReference): void {
    this.cancelPreparation();
    this.pending = structuredClone(reference);
  }

  /** 开始一次新的发送前准备流程，并使此前仍存活的流程失效。 */
  beginPreparation(): AbortController {
    this.cancelPreparation();
    const controller = new AbortController();
    this.preparationController = controller;
    return controller;
  }

  /** 仅允许当前未取消的 controller 完成，隔离迟到的异步结果。 */
  completePreparation(controller: AbortController): boolean {
    if (this.preparationController !== controller || controller.signal.aborted) {
      return false;
    }

    this.preparationController = null;
    return true;
  }

  /** 清理与指定 controller 对应的失败流程，不影响后来启动的新流程。 */
  failPreparation(controller: AbortController): void {
    if (this.preparationController === controller) {
      this.preparationController = null;
    }
  }

  /** 中止当前发送前准备流程；pending 引用保留给用户重试。 */
  cancelPreparation(): boolean {
    if (!this.preparationController) {
      return false;
    }

    this.preparationController.abort();
    this.preparationController = null;
    return true;
  }

  /** 移除 composer 当前引用，不隐式操作 transcript。 */
  clearPending(): void {
    this.pending = null;
  }

  /** 同时取消活动流程并清空 pending 引用，供会话切换和应用清理使用。 */
  clear(): void {
    this.cancelPreparation();
    this.clearPending();
  }
}

export {ConversationReferenceContext};
