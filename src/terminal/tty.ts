import type { TerminalController } from '../types/app';
import { disableBracketedPaste, enableBracketedPaste, reset, showCursor } from './ansi';

// stdout 在非 TTY 场景可能没有 columns/rows，给渲染层一个稳定 fallback。
/**
 * 读取当前终端尺寸；在非 TTY 场景下提供稳定 fallback。
 *
 */
export function getSize(output: NodeJS.WriteStream = process.stdout): {columns: number; rows: number} {
  return {
    columns: output.columns || 80,
    rows: output.rows || 24
  };
}

/**
 * 配置 raw mode、输入编码和退出清理逻辑，并返回供 app 层使用的终端能力封装。
 *
 */
export function setupTerminal(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout
): TerminalController {
  // 记录进入应用前的状态，退出时尽量还原，不把用户终端留在 raw mode。
  const wasRaw = Boolean(input.isRaw);
  const wasPaused = input.isPaused ? input.isPaused() : false;
  let cleaned = false;

  if (input.isTTY && typeof input.setRawMode === 'function') {
    input.setRawMode(true);
  }

  if (typeof input.setEncoding === 'function') {
    input.setEncoding('utf8');
  }

  if (typeof input.resume === 'function') {
    input.resume();
  }

  if (output.isTTY) {
    output.write(enableBracketedPaste());
  }

  /**
   * 恢复终端状态，只执行一次，避免重复切换 raw mode 或重复写 ANSI reset。
   */
  function cleanup(): void {
    // cleanup 可能来自快捷键、signal 或 process exit；只执行一次避免重复写状态。
    if (cleaned) {
      return;
    }
    cleaned = true;

    output.write((output.isTTY ? disableBracketedPaste() : '') + showCursor() + reset());

    if (input.isTTY && typeof input.setRawMode === 'function') {
      input.setRawMode(wasRaw);
    }

    if (wasPaused && typeof input.pause === 'function') {
      input.pause();
    }

    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('exit', cleanup);
  }

  /**
   * 在进程信号触发时先恢复终端，再退出当前进程。
   */
  function onSignal(): void {
    // 先恢复终端，再交给进程退出。raw mode 下这一步很关键。
    cleanup();
    process.exit(0);
  }

  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.once('exit', cleanup);

  return {
    cleanup,
    getSize: () => getSize(output)
  };
}
