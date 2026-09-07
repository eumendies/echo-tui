import fs from 'node:fs';
import path from 'node:path';

// banner 每次重绘都会取版本号，模块级缓存首次读取结果，避免重复的同步 fs IO。
let cachedVersion: string | null = null;

/**
 * 读取 package.json 的版本号，供 --version 输出与 banner 展示共用。
 * 编译产物固定位于 dist 的第三层目录，向上三级即仓库根目录；读取失败时降级为 0.0.0。
 */
export function readPackageVersion(): string {
  if (cachedVersion !== null) {
    return cachedVersion;
  }

  try {
    const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {version?: unknown};
    cachedVersion = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }

  return cachedVersion;
}
