import {INPUT_EVENTS} from '../input/event-types';
import {moveWrappedIndex} from './utils';

import type {ChoiceCommandSurface} from '../types/command';
import type {InputEvent} from '../types/input';
import type {UpdateCheckResult} from '../update/update-check';

type UpdateDecision = 'update' | 'later' | 'ignore';

type AvailableUpdate = Extract<UpdateCheckResult, {status: 'available'}>; // 检查发现的可用更新

type ActiveUpdateRequest = {
  update: AvailableUpdate; // 已呈现、等待用户决策的可用更新
  selectedIndex: number; // 当前键盘焦点在选项列表中的索引
};

type AutoUpdateControllerOptions = {
  applyUpdate: (latestVersion: string) => Promise<number>; // 前台更新与重启；返回当前进程应使用的退出码
  canPresent: () => boolean; // 组合根组装的空闲门控：任何会接管 footer 或消费输入的活动都不能活跃
  checkUpdate: () => Promise<UpdateCheckResult>; // 启动更新检查
  exit: (code: number) => void; // 结束当前进程
  persistIgnoredVersion: (version: string) => void; // 持久化「忽略此版本」
  render: () => void; // 请求呈现、关闭或焦点变化后的重绘入口
  shutdown: () => void; // 更新前的终端收尾，与正常退出共用
};

const OPTION_COUNT = 3;
// 提示为自动弹出，默认焦点停在最保守的「稍后提醒」，避免误触 Enter 直接触发退出与全局安装。
const DEFAULT_SELECTED_INDEX = 1;

/**
 * 承载启动更新检查与提示的完整生命周期：登记检查结果、按空闲门控呈现 choice 请求、路由用户决策并触发前台更新。
 * 呈现时机由组合根的 activity tick 调用 tick() 驱动；控制器自身不持有 timer，也不直接读写状态文件或子进程。
 */
class AutoUpdateController {
  private pendingUpdate: AvailableUpdate | null = null;
  private activeRequest: ActiveUpdateRequest | null = null;
  private snoozed = false; // 本次会话内是否已选择「稍后提醒」或「忽略此版本」
  private readonly options: AutoUpdateControllerOptions;

  constructor(options: AutoUpdateControllerOptions) {
    this.options = options;
  }

  /**
   * 首帧渲染后触发异步检查；只登记可用更新，检查失败静默忽略。
   */
  start(): void {
    void this.options.checkUpdate().then((result) => {
      if (result.status !== 'available' || this.snoozed || this.activeRequest) {
        return;
      }

      this.pendingUpdate = result;
    }).catch(() => {
      // 组合根提供的检查实现已自行降级；这里只兜底未处理的 rejection。
    });
  }

  /**
   * 由 activity tick 驱动的呈现尝试；门控与状态全部满足时才把待呈现更新转为活动请求。
   */
  tick(): void {
    const update = this.pendingUpdate;

    if (!update || this.activeRequest || this.snoozed || !this.options.canPresent()) {
      return;
    }

    this.pendingUpdate = null;
    this.activeRequest = {
      update,
      selectedIndex: DEFAULT_SELECTED_INDEX
    };
    this.options.render();
  }

  /**
   * 返回当前是否存在等待用户决策的更新请求。
   */
  hasActiveRequest(): boolean {
    return this.activeRequest !== null;
  }

  /**
   * 将活动更新请求投影为通用 choice surface；渲染层不读取控制器内部状态。
   */
  getSurface(): ChoiceCommandSurface | null {
    const request = this.activeRequest;

    if (!request) {
      return null;
    }

    const {currentVersion, latestVersion} = request.update;

    return {
      kind: 'choice',
      title: '更新可用',
      message: `发现新版本 v${latestVersion}（当前 v${currentVersion}）。`,
      messageTitle: '版本',
      optionsTitle: '操作',
      options: [
        {label: '立即更新', description: '退出 TUI，运行 npm install -g 并自动重启'},
        {label: '稍后提醒', description: '本次会话不再提示，下次启动仍会检查'},
        {label: '忽略此版本', description: `不再提示 v${latestVersion}；出现更高版本时恢复提示`}
      ],
      focusedIndex: request.selectedIndex,
      dismissHint: '↑/↓ 移动 · Enter 确认 · Esc 稍后提醒'
    };
  }

  /**
   * 处理请求激活期间的输入事件；请求会消费所有输入，避免污染 composer 或 command session。
   */
  handleEvent(event: InputEvent): boolean {
    const request = this.activeRequest;

    if (!request) {
      return false;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP || event.type === INPUT_EVENTS.MOVE_DOWN) {
      request.selectedIndex = moveWrappedIndex(request.selectedIndex, event.type === INPUT_EVENTS.MOVE_UP ? -1 : 1, OPTION_COUNT);
      this.options.render();
      return true;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      this.resolve(request.selectedIndex === 0 ? 'update' : request.selectedIndex === 1 ? 'later' : 'ignore');
      return true;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.resolve('later');
      return true;
    }

    return true;
  }

  /**
   * 结算当前请求：稍后与忽略进入会话级抑制（忽略额外持久化版本）；立即更新先收尾终端，再前台更新并以返回码退出。
   */
  private resolve(decision: UpdateDecision): void {
    const request = this.activeRequest;

    if (!request) {
      return;
    }

    this.activeRequest = null;

    if (decision === 'update') {
      this.options.shutdown();
      void this.options.applyUpdate(request.update.latestVersion).then(
        (exitCode) => this.options.exit(exitCode),
        () => this.options.exit(1)
      );
      return;
    }

    this.snoozed = true;

    if (decision === 'ignore') {
      this.options.persistIgnoredVersion(request.update.latestVersion);
    }

    this.options.render();
  }
}

export {
  AutoUpdateController
};

export type {
  AutoUpdateControllerOptions,
  UpdateDecision
};
