import {INPUT_EVENTS} from '../input/event-types';

import type {AppContext} from './state/app-context';
import type {FilePickerContext} from './state/file-picker-context';
import type {ToolApprovalContext} from './state/tool-approval-context';
import type {UserQuestionContext} from './state/user-question-context';
import type {TerminalController} from '../types/app';
import type {InputEvent} from '../types/input';
import type {FooterHitRegion, FooterPointerSnapshot} from '../types/render';

type PointerQuestionPort = Pick<UserQuestionContext, 'hasActiveRequest' | 'handlePointerOption' | 'handlePointerTab'>;
type PointerApprovalPort = Pick<ToolApprovalContext, 'hasActiveRequest' | 'handlePointerOption'>;
type PointerFilePickerPort = Pick<FilePickerContext, 'hasActiveRequest' | 'handlePointerEntry'>;

type FooterPointerControllerOptions = {
  appContext: Pick<AppContext, 'handleSlashSuggestionPointer'>; // 主 composer slash suggestion 的鼠标语义入口。
  filePicker: PointerFilePickerPort; // 文件选择器的当前 entry 鼠标语义入口。
  render: () => void; // slash 补全不自带 onChange 时使用的 footer 重绘入口。
  terminal: TerminalController; // TTY 鼠标模式与 CPR 查询的唯一能力边界。
  toolApproval: PointerApprovalPort; // 工具审批 choice 的优先级输入入口。
  userQuestion: PointerQuestionPort; // 用户问题 choice 的最高优先级输入入口。
};

type PointerCalibration = {
  version: number; // 已被 CPR 确认的 footer frame 版本。
  rowOrigin: number; // footer 第 0 行对应的终端 1-based 屏幕行。
};

const CURSOR_POSITION_TIMEOUT_MS = 300;

/**
 * 管理 footer 的鼠标命中与 CPR 坐标校准；只保存本次 render 的临时投影，不接触 transcript 或持久化状态。
 */
class FooterPointerController {
  private readonly appContext: Pick<AppContext, 'handleSlashSuggestionPointer'>;
  private readonly filePicker: PointerFilePickerPort;
  private readonly render: () => void;
  private readonly terminal: TerminalController;
  private readonly toolApproval: PointerApprovalPort;
  private readonly userQuestion: PointerQuestionPort;
  private interactive = false;
  private snapshot: FooterPointerSnapshot | null = null;
  private calibration: PointerCalibration | null = null;
  private pendingCalibrationVersion: number | null = null;
  private calibrationTimeout: NodeJS.Timeout | null = null;
  private lastHoverKey: string | null = null;

  constructor(options: FooterPointerControllerOptions) {
    this.appContext = options.appContext;
    this.filePicker = options.filePicker;
    this.render = options.render;
    this.terminal = options.terminal;
    this.toolApproval = options.toolApproval;
    this.userQuestion = options.userQuestion;
  }

  /**
   * 接收 footer 已成功写入终端后的 frame 快照；只在第一阶段实际接收鼠标语义的 surface 启用报告。
   */
  update(snapshot: FooterPointerSnapshot): void {
    const interactive = this.isInteractiveSnapshot(snapshot);
    this.interactive = interactive;
    this.terminal.setMouseTracking(interactive);

    if (!interactive) {
      this.clearCurrentFrame();
      return;
    }

    this.snapshot = snapshot;
    if (!snapshot.hitRegions.some((region) => createRegionKey(region) === this.lastHoverKey)) {
      this.lastHoverKey = null;
    }

    if (snapshot.originStable && this.calibration) {
      // 原位 footer 重绘不改变物理原点，复用已确认坐标但绑定新 frame。
      this.calibration = {...this.calibration, version: snapshot.version};
      return;
    }

    this.calibration = null;
    this.requestCalibration();
  }

  /** 关闭鼠标模式并丢弃所有可能对应旧 footer 的定位与 hover 状态。 */
  dispose(): void {
    this.terminal.setMouseTracking(false);
    this.interactive = false;
    this.clearCurrentFrame();
    this.cancelPendingCalibration();
  }

  /**
   * 消费 parser 产生的 CPR 与鼠标事件；返回 true 表示该终端控制事件不应继续污染普通输入路由。
   */
  handleEvent(event: InputEvent): boolean {
    if (event.type === INPUT_EVENTS.CURSOR_POSITION) {
      this.acceptCursorPosition(event.row, event.column);
      return true;
    }

    if (event.type !== INPUT_EVENTS.MOUSE) {
      return false;
    }

    // SGR 无按键移动用 button=other 报告；仅允许无按键 hover、左键拖动与左键按下。
    const acceptedButton = event.phase === 'move'
      ? event.button === 'other' || event.button === 'left'
      : event.button === 'left';
    if (!acceptedButton || event.shift || event.alt || event.ctrl || !this.snapshot || !this.calibration || this.calibration.version !== this.snapshot.version) {
      return true;
    }

    const row = event.row - this.calibration.rowOrigin;
    const region = this.snapshot.hitRegions.find((candidate) => row >= candidate.rowStart
      && row <= candidate.rowEnd
      && event.column >= candidate.columnStart
      && event.column <= candidate.columnEnd) || null;

    if (!region) {
      this.lastHoverKey = null;
      return true;
    }

    if (event.phase === 'move') {
      const key = createRegionKey(region);
      if (key === this.lastHoverKey) {
        return true;
      }
      this.lastHoverKey = key;
      this.route(region, false);
      return true;
    }

    if (event.phase === 'down') {
      this.lastHoverKey = createRegionKey(region);
      this.route(region, true);
    }

    return true;
  }

  /** 消费唯一在途 CPR；旧 frame 的回复只会触发当前 frame 的下一次定位，绝不用于命中。 */
  private acceptCursorPosition(row: number, column: number): void {
    const snapshot = this.snapshot;
    const requestedVersion = this.pendingCalibrationVersion;

    if (requestedVersion === null) {
      return;
    }

    this.settlePendingCalibration();
    if (!snapshot || !this.interactive || snapshot.version !== requestedVersion) {
      this.requestCalibration();
      return;
    }

    const rowOrigin = row - snapshot.cursorRow;

    if (rowOrigin <= 0 || column !== snapshot.cursorColumn + 1) {
      return;
    }

    this.calibration = {version: snapshot.version, rowOrigin};
  }

  /** 串行请求一次有界 CPR；已有在途查询时等待其回复或超时，防止旧回复错配新 frame。 */
  private requestCalibration(): void {
    const snapshot = this.snapshot;

    if (!this.interactive || !snapshot || this.pendingCalibrationVersion !== null) {
      return;
    }

    if (!this.terminal.requestCursorPosition()) {
      return;
    }

    const version = snapshot.version;
    this.pendingCalibrationVersion = version;
    this.calibrationTimeout = setTimeout(() => {
      if (this.pendingCalibrationVersion !== version) {
        return;
      }
      this.settlePendingCalibration();
      // 超时的旧 frame 不应阻塞已完成的新 render；只为最新 frame 重试一次。
      if (this.snapshot?.version !== version) {
        this.requestCalibration();
      }
    }, CURSOR_POSITION_TIMEOUT_MS);
  }

  /** 按当前最高优先级 context 将结构化 target 转换为领域语义，绝不通用模拟 Enter。 */
  private route(region: FooterHitRegion, activate: boolean): void {
    if (region.target.kind === 'slash_suggestion') {
      if (region.owner === 'slash_suggestion' && this.appContext.handleSlashSuggestionPointer(region.target.index, activate)) {
        this.render();
      }
      return;
    }

    if (region.target.kind === 'choice_option') {
      if (region.owner !== 'choice') return;
      if (this.userQuestion.hasActiveRequest()) {
        this.userQuestion.handlePointerOption(region.target.index, activate && !region.target.inlineInput);
        return;
      }
      if (this.toolApproval.hasActiveRequest()) {
        this.toolApproval.handlePointerOption(region.target.index, activate && !region.target.inlineInput);
      }
      return;
    }

    if (region.target.kind === 'choice_tab' && region.owner === 'choice' && this.userQuestion.hasActiveRequest()) {
      this.userQuestion.handlePointerTab(region.target.index);
      return;
    }

    if (region.target.kind === 'file_picker_entry' && region.owner === 'file_picker' && this.filePicker.hasActiveRequest()) {
      this.filePicker.handlePointerEntry(region.target.index, activate);
    }
  }

  /** 清空当前 frame、校准与 hover 状态；在途 CPR 保留至回复或超时，避免和后续请求串线。 */
  private clearCurrentFrame(): void {
    this.snapshot = null;
    this.calibration = null;
    this.lastHoverKey = null;
  }

  /** 结束当前在途 CPR 并释放 timer；仅 shutdown 或回复/超时结算调用。 */
  private settlePendingCalibration(): void {
    this.pendingCalibrationVersion = null;
    this.clearCalibrationTimeout();
  }

  /** 退出时丢弃不再会被输入控制器消费的 CPR 请求。 */
  private cancelPendingCalibration(): void {
    this.pendingCalibrationVersion = null;
    this.clearCalibrationTimeout();
  }

  /** 判断当前 hit map 是否属于已接入的四类鼠标 surface，排除通用 choice 的其他调用方。 */
  private isInteractiveSnapshot(snapshot: FooterPointerSnapshot): boolean {
    return snapshot.hitRegions.some((region) => region.owner === 'slash_suggestion'
      || region.owner === 'choice' && (this.userQuestion.hasActiveRequest() || this.toolApproval.hasActiveRequest())
      || region.owner === 'file_picker' && this.filePicker.hasActiveRequest());
  }

  private clearCalibrationTimeout(): void {
    if (this.calibrationTimeout) {
      clearTimeout(this.calibrationTimeout);
      this.calibrationTimeout = null;
    }
  }
}

function createRegionKey(region: FooterHitRegion): string {
  const target = region.target;
  return `${region.owner}:${target.kind}:${target.index}`;
}

export {
  FooterPointerController
};

export type {
  FooterPointerControllerOptions
};
