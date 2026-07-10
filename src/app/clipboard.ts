import {spawn} from 'node:child_process';
import {platform} from 'node:os';

import type {ClipboardWriteResult} from '../types/command';

type ClipboardCommand = {
  args: string[];
  command: string;
};

/**
 * 将文本写入系统剪贴板，按平台尝试常见命令并返回结构化结果。
 */
async function writeClipboardText(text: string): Promise<ClipboardWriteResult> {
  const commands = getClipboardCommands(platform());
  const failures: string[] = [];

  for (const command of commands) {
    const result = await runClipboardCommand(command, text);

    if (result.ok) {
      return result;
    }

    failures.push(result.error);
  }

  const suffix = failures.length > 0 ? `：${failures.join('；')}` : '';
  return {ok: false, error: `未找到可用的剪贴板命令${suffix}`};
}

function getClipboardCommands(osPlatform: NodeJS.Platform): ClipboardCommand[] {
  if (osPlatform === 'darwin') {
    return [{command: 'pbcopy', args: []}];
  }

  if (osPlatform === 'win32') {
    return [{command: 'clip', args: []}];
  }

  return [
    {command: 'wl-copy', args: []},
    {command: 'xclip', args: ['-selection', 'clipboard']},
    {command: 'xsel', args: ['--clipboard', '--input']}
  ];
}

function runClipboardCommand({command, args}: ClipboardCommand, text: string): Promise<ClipboardWriteResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {stdio: ['pipe', 'ignore', 'pipe']});
    const stderr: Buffer[] = [];
    let settled = false;

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve({ok: false, error: `${command}: ${error.message}`});
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }

      settled = true;

      if (code === 0) {
        resolve({ok: true});
        return;
      }

      const message = Buffer.concat(stderr).toString('utf8').trim();
      resolve({ok: false, error: `${command}: ${message || `退出码 ${code}`}`});
    });

    child.stdin.end(text);
  });
}

export {getClipboardCommands, runClipboardCommand, writeClipboardText};

export type {ClipboardCommand};
