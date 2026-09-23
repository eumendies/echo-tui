import {INPUT_EVENTS} from '../input/event-types';

import type {PointerInputConsumer} from './active-input-resolver';
import type {TerminalController} from '../types/app';
import type {InputEvent} from '../types/input';
import type {FooterHitRegion, FooterPointerSnapshot, FooterWheelRegion} from '../types/render';

type FooterPointerControllerOptions = {
  getActivePointerConsumer(): PointerInputConsumer | null; // 返回当前有效且显式支持鼠标语义的输入消费者。
  terminal: TerminalController; // TTY 鼠标模式与 CPR 查询的唯一能力边界。
};

type PointerCalibration = {
  version: number; // 已被 CPR 确认的 footer frame 版本。
  rowOrigin: number; // footer 第 0 行对应的终端 1-based 屏幕行。
};

const CURSOR_POSITION_TIMEOUT_MS = 300;

/**
 * 管理 footer 的鼠标命中与 CPR 坐标校准；只保存当前 frame 临时投影，并把业务 target 转交给活跃 pointer consumer。
 */
class FooterPointerController {
  private readonly getActivePointerConsumer: () => PointerInputConsumer | null;
  private readonly terminal: TerminalController;
  private interactive = false;
  private snapshot: FooterPointerSnapshot | null = null;
  private calibration: PointerCalibration | null = null;
  private pendingCalibrationVersion: number | null = null;
  private calibrationTimeout: NodeJS.Timeout | null = null;
  private lastHoverKey: string | null = null;

  constructor(options: FooterPointerControllerOptions) {
    this.getActivePointerConsumer = options.getActivePointerConsumer;
    this.terminal = options.terminal;
  }

  /**
   * 接收 footer 已成功写入终端后的 frame 快照；仅当前 pointer consumer 有匹配区域时启用鼠标报告。
   */
  update(snapshot: FooterPointerSnapshot): void {
    const interactive = this.isInteractiveSnapshot(snapshot);
    this.interactive = interactive;
    this.terminal.setMouseTracking(interactive);

    if (!interactive) {
      this.clearCurrentFrame();
      this.cancelPendingCalibration();
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

    if (event.type === INPUT_EVENTS.MOUSE_WHEEL) {
      if (!this.snapshot || !this.calibration || this.calibration.version !== this.snapshot.version) return true;
      const row = event.row - this.calibration.rowOrigin;
      const region = this.snapshot.wheelRegions.find((candidate) => row >= candidate.rowStart
        && row <= candidate.rowEnd
        && event.column >= candidate.columnStart
        && event.column <= candidate.columnEnd);
      if (region) this.routeWheel(region, event.direction);
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

  /** 将已校准命中的 target 交给仍然匹配 interactionId 的当前 consumer；异步结果不阻塞终端协议输入。 */
  private route(region: FooterHitRegion, activate: boolean): void {
    const consumer = this.getActivePointerConsumer();

    if (!consumer?.handlePointer || !region.interactionId || region.interactionId !== consumer.id) {
      return;
    }

    const result = consumer.handlePointer(region.target, activate);
    if (result && typeof result === 'object' && 'then' in result && typeof result.then === 'function') {
      void result.catch(() => {});
    }
  }

  /** 仅转发当前身份的右栏滚轮；离开列表后重置 hover，返回原会话时仍可重新聚焦。 */
  private routeWheel(region: FooterWheelRegion, direction: 'up' | 'down'): void {
    const consumer = this.getActivePointerConsumer();
    if (!consumer?.handleWheel || !region.interactionId || region.interactionId !== consumer.id) return;
    this.lastHoverKey = null;
    const result = consumer.handleWheel(region.pane, direction);
    if (result && typeof result === 'object' && 'then' in result && typeof result.then === 'function') {
      void result.catch(() => {});
    }
  }

  /** 清空当前 frame、校准与 hover 状态；调用方在关闭交互时同时取消在途 CPR。 */
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

  /** 判断当前 hit map 是否属于当前 resolver 返回的 pointer consumer。 */
  private isInteractiveSnapshot(snapshot: FooterPointerSnapshot): boolean {
    const consumer = this.getActivePointerConsumer();
    return Boolean(consumer && ((consumer.handlePointer && snapshot.hitRegions.some((region) => region.interactionId === consumer.id))
      || (consumer.handleWheel && snapshot.wheelRegions.some((region) => region.interactionId === consumer.id))));
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
  return `${region.interactionId || ''}:${region.owner}:${target.kind}:${target.index}`;
}

export {
  FooterPointerController
};

export type {
  FooterPointerControllerOptions
};
