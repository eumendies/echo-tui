import * as composerOps from '../../input/composer';

import type {ComposerState} from '../../types/composer';

/**
 * 管理 composer 草稿、输入历史和历史浏览态。
 */
class ComposerContext {
  composer: ComposerState;
  inputHistory: string[];
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

  getInputHistory(): string[] {
    return [...this.inputHistory];
  }

  recordInput(text: string): void {
    this.inputHistory.push(text);
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
      composerOps.setText(this.composer, this.inputHistory[this.historyIndex]);
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

    composerOps.setText(this.composer, this.inputHistory[this.historyIndex]);
    return true;
  }
}

export {
  ComposerContext
};
