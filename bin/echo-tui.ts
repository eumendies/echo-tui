#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

// CLI 入口只负责找到编译后的普通命令行入口，具体终端逻辑源码位于 src/app/main.ts。
const cliMainPath = resolveCompiledCliMain();

if (!cliMainPath) {
  process.stderr.write('echo-tui 需要先运行 `npm run build` 生成 dist/ 后再启动。\n');
  process.exit(1);
}

const { runCli } = require(cliMainPath) as { runCli: () => Promise<number> };

void runCli().then((exitCode) => {
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}).catch((error: unknown) => {
  process.stderr.write(`echo-tui failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

/**
 * 根据当前 bin 所在位置解析编译后的 CLI main；源码 bin 和 dist/bin 都复用同一份逻辑。
 *
 * @returns 编译后的 CLI main 绝对路径；未找到时返回 null。
 */
function resolveCompiledCliMain(): string | null {
  const parentDir = path.join(__dirname, '..');
  const distDir = path.basename(parentDir) === 'dist'
    ? parentDir
    : path.join(parentDir, 'dist');
  const candidates = [path.join(distDir, 'src', 'cli', 'main.js')];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}
