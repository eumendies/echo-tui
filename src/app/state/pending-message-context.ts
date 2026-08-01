import type {PendingMessageRenderState} from '../../types/render';

/**
 * 管理单条待发送用户文本；claim 会原子移除，避免重复处理。
 */
class PendingMessageContext {
  private pending: string | null = null;

  /** 返回当前待发送文本。 */
  getPending(): string | null {
    return this.pending;
  }

  /** 返回 footer 所需的最小单行投影。 */
  getRenderState(): PendingMessageRenderState | null {
    if (!this.pending) {
      return null;
    }

    return {preview: normalizePreview(this.pending)};
  }

  /** 槽位为空且文本非空时入队；已有消息时拒绝覆盖。 */
  enqueue(text: string): boolean {
    if (this.pending !== null || text === '') {
      return false;
    }

    this.pending = text;
    return true;
  }

  /** 原子取得并清空待发送文本，供 turn 收尾后的唯一 dispatch 使用。 */
  claim(): string | null {
    const pending = this.pending;
    this.pending = null;
    return pending;
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
