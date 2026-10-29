import * as composerOps from '../../input/composer';

import type {ComposerSnapshot, ComposerState} from '../../types/composer';

/**
 * 管理 composer 草稿、输入历史和历史浏览态。
 */
class ComposerContext {
  composer: ComposerState;
  inputHistory: ComposerSnapshot[];
  historyIndex: number | null;
  isResponding: () => boolean;

  constructor(isResponding: () => boolean) {
    this.composer = composerOps.createComposer();
    this.inputHistory = [];
    this.historyIndex = null;
    this.isResponding = isResponding;
  }

  getText(): string {
    return composerOps.getText(this.composer);
  }

  setText(text: string): void {
    composerOps.setText(this.composer, text);
  }

  /** 将快照历史投影为供命令等只读消费者使用的文本列表。 */
  getInputHistory(): string[] {
    return this.inputHistory.map((input) => input.text);
  }

  /** 保存已接受输入的独立快照，文本相同的条目仍保有各自的确认引用。 */
  recordInput(input: ComposerSnapshot): void {
    this.inputHistory.push({
      ...input,
      fileMentions: input.fileMentions.map((mention) => ({...mention}))
    });
  }

  leaveHistoryBrowsing(): void {
    this.historyIndex = null;
  }

  reset(): void {
    composerOps.reset(this.composer);
  }

  /**
   * 按方向浏览 session 输入历史；返回是否消费了本次 Up/Down。
   */
  browseHistory(direction: number): boolean {
    if (this.isResponding() || this.inputHistory.length === 0) {
      return false;
    }

    if (this.historyIndex === null) {
      if (!composerOps.isEmpty(this.composer) || direction > 0) {
        return false;
      }

      this.historyIndex = this.inputHistory.length - 1;
      this.restoreHistoryInput();
      return true;
    }

    const nextIndex = this.historyIndex + direction;

    if (nextIndex < 0) {
      this.historyIndex = 0;
    } else if (nextIndex >= this.inputHistory.length) {
      this.historyIndex = null;
      this.reset();
      return true;
    } else {
      this.historyIndex = nextIndex;
    }

    this.restoreHistoryInput();
    return true;
  }

  /** 按条目恢复确认资格，不通过相同文本匹配；浏览历史时光标仍置于末尾。 */
  private restoreHistoryInput(): void {
    const input = this.inputHistory[this.historyIndex!];
    composerOps.restoreSnapshot(this.composer, input);
    this.composer.cursor = this.composer.chars.length;
  }
}

export {
  ComposerContext
};
