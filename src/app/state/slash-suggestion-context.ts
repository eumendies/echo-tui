import {moveWrappedIndex} from '../utils';

import type {SlashCommandDescriptor} from '../../types/command';
import type {SlashSuggestionState} from '../../types/render';

type SlashSuggestionOptions = {
  hasActiveCommandSession: () => boolean;
  isResponding: () => boolean;
};

type SlashCommandDescriptorProvider = () => SlashCommandDescriptor[];

/**
 * 管理 composer 编辑态的 slash 命令提示选择，不启动真实 command session。
 */
class SlashSuggestionContext {
  private readonly getCommands: SlashCommandDescriptorProvider;
  private readonly hasActiveCommandSession: () => boolean;
  private readonly isResponding: () => boolean;
  private selectedIndex = 0;

  constructor(commands: SlashCommandDescriptor[] | SlashCommandDescriptorProvider, options: SlashSuggestionOptions) {
    this.getCommands = Array.isArray(commands) ? () => commands : commands;
    this.hasActiveCommandSession = options.hasActiveCommandSession;
    this.isResponding = options.isResponding;
  }

  /**
   * 返回当前 composer 文本对应的 slash suggestion 可渲染状态。
   */
  getState(composerText: string): SlashSuggestionState | null {
    const options = this.getMatchingCommands(composerText).map((command) => ({
      label: `/${command.name}`,
      description: command.description
    }));

    if (options.length === 0) {
      this.selectedIndex = 0;
      return null;
    }

    this.selectedIndex = Math.min(Math.max(0, this.selectedIndex), options.length - 1);

    return {
      options,
      selectedIndex: this.selectedIndex
    };
  }

  /**
   * 判断当前 composer 文本是否有可见 suggestion。
   */
  isVisible(composerText: string): boolean {
    return this.getMatchingCommands(composerText).length > 0;
  }

  /**
   * 按方向移动当前 suggestion 选择，到达首尾后循环。
   */
  moveSelection(composerText: string, direction: number): boolean {
    const matches = this.getMatchingCommands(composerText);

    if (matches.length === 0) {
      this.selectedIndex = 0;
      return false;
    }

    this.selectedIndex = moveWrappedIndex(this.selectedIndex, direction, matches.length);
    return true;
  }

  /**
   * 返回当前选中的 slash 命令文本，用于写回 composer；补全路径可选择追加分隔空格。
   */
  completeSelection(composerText: string, options: {appendSpace?: boolean} = {}): string | null {
    const matches = this.getMatchingCommands(composerText);

    if (matches.length === 0) {
      this.selectedIndex = 0;
      return null;
    }

    this.selectedIndex = Math.min(Math.max(0, this.selectedIndex), matches.length - 1);
    return `/${matches[this.selectedIndex].name}${options.appendSpace ? ' ' : ''}`;
  }

  /**
   * 重置当前 suggestion 选择。
   */
  resetSelection(): void {
    this.selectedIndex = 0;
  }

  private getMatchingCommands(composerText: string): SlashCommandDescriptor[] {
    if (!this.canShowSuggestions(composerText)) {
      return [];
    }

    const prefix = composerText.slice(1);
    return this.getCommands()
      .filter((command) => command.name.startsWith(prefix))
      .sort((left, right) => Number(right.name === prefix) - Number(left.name === prefix));
  }

  private canShowSuggestions(composerText: string): boolean {
    if (this.hasActiveCommandSession() || this.isResponding()) {
      return false;
    }

    if (!composerText.startsWith('/') || /\s/u.test(composerText)) {
      return false;
    }

    return true;
  }
}

export {
  SlashSuggestionContext
};

export type {SlashCommandDescriptorProvider};
