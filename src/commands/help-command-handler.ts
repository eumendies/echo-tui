import { INPUT_EVENTS } from '../input/event-types';
import type { CommandHandler, CommandHost, CommandSession, InfoCommandSurface } from '../types/command';
import type { InputEvent } from '../types/input';

const HELP_SURFACE: InfoCommandSurface & { title: string; lines: string[]; dismissHint: string } = {
  kind: 'info',
  title: '/help',
  lines: [
    '输入：Enter 发送 · Ctrl+J 换行 · Up/Down 历史/垂直移动',
    '编辑：Ctrl+A/E 行首/行尾 · Ctrl+U/K/W 快速删除',
    '控制：Shift+Tab 工具授权 · Esc 中断 response 或关闭当前面板 · Ctrl+C/Ctrl+D 退出',
    '提示：输入 / 显示命令/skill 候选 · Tab 补全 · Up/Down 选择',
    '命令：/model /mode /status /context /usage /memory /clear /compact /resume /skills /init /review',
    '工作流：/init 生成或评审 AGENTS.md · /review 审查当前代码变更',
    'Skills：/<skill-name> [arguments] 调用已启用 skill'
  ],
  dismissHint: 'Esc 关闭帮助'
};

/**
 * 为 /help 创建独立的 info surface，避免共享可变数组引用。
 *
 * @returns info surface
 */
export function createHelpSurface(): InfoCommandSurface {
  return {
    ...HELP_SURFACE,
    lines: [...HELP_SURFACE.lines]
  };
}

export class HelpCommandHandler implements CommandHandler {
  name = 'help';
  description = '查看帮助';

  /**
   * 只匹配纯 /help，保持当前最小行为不变。
   *
   * @param text 提交文本
   * @returns 是否命中 /help
   */
  match(text: string): boolean {
    return String(text) === '/help';
  }

  /**
   * 启动 /help，通过 host 打开 info surface。
   *
   * @param _text 提交文本
   */
  start(_text: string, host: CommandHost): void {
    host.composer.reset();
    host.session.open({
      commandName: 'help',
      handler: this,
      surface: createHelpSurface(),
      data: null
    });
  }

  /**
   * /help 活跃时只消费 Esc，其余事件交给运行时忽略。
   *
   * @param _session command session
   * @param event 输入事件
   */
  handleEvent(_session: CommandSession, event: InputEvent, host: CommandHost): void {
    if (event.type !== INPUT_EVENTS.ESCAPE) {
      return;
    }

    host.session.close();
    host.composer.reset();
  }
}
