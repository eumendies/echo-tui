import * as fs from 'node:fs';
import * as path from 'node:path';

type PathGuardResult =
  | {kind: 'allowed'} // 目标可以确认位于受管根内。
  | {kind: 'denied'; reason: string}; // 无法确认写入仍在根内；调用方必须拒绝该次编辑。

/**
 * 校验一个待写入路径是否仍位于受管工作区根内。
 *
 * 检查分为三层：字面相对路径不逃逸、已存在的每个路径组件都不是符号链接、真实路径
 * 不指向根外。这是在写入前缩小窗口的复核，而不是消除同 UID 竞态的证明；任何一步
 * 无法确认都按拒绝处理。
 */
function checkWorkspaceWriteTarget(workspaceRoot: string, targetPath: string): PathGuardResult {
  const rootPath = path.resolve(workspaceRoot);
  const absoluteTarget = path.resolve(targetPath);

  let rootStats: fs.Stats;
  try {
    rootStats = fs.lstatSync(rootPath);
  } catch {
    return {kind: 'denied', reason: `Managed worker workspace is unavailable: ${rootPath}`};
  }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    return {kind: 'denied', reason: `Managed worker workspace root is not a real directory: ${rootPath}`};
  }

  const relative = path.relative(rootPath, absoluteTarget);
  if (isEscaping(relative)) {
    return {kind: 'denied', reason: `Target path is outside the managed worker workspace: ${absoluteTarget}`};
  }

  // 逐层检查已存在的路径组件：符号链接可以把后续写入带到根外，即使字面路径看起来在根内。
  // 必须累积路径；逐个组件单独拼接会漏检中间目录，并把 ENOENT 误当成「不存在」。
  let current = rootPath;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(current);
    } catch (error: unknown) {
      if (isMissingPathError(error)) {
        break;
      }
      return {kind: 'denied', reason: `Target path component could not be checked: ${current}`};
    }
    if (stats.isSymbolicLink()) {
      return {kind: 'denied', reason: `Target path uses a symbolic link inside the managed worker workspace: ${current}`};
    }
  }

  // 已存在前缀的真实路径必须仍在真实根内；这覆盖了根自身经符号链接打开的情况。
  const realRoot = realpathOrNull(rootPath);
  if (realRoot === null) {
    return {kind: 'denied', reason: `Managed worker workspace real path could not be resolved: ${rootPath}`};
  }
  const realTarget = resolveRealTarget(absoluteTarget);
  if (realTarget === null) {
    return {kind: 'denied', reason: `Target path real path could not be resolved: ${absoluteTarget}`};
  }
  return isEscaping(path.relative(realRoot, realTarget))
    ? {kind: 'denied', reason: `Target path resolves outside the managed worker workspace: ${absoluteTarget}`}
    : {kind: 'allowed'};
}

/** 从目标向上找到第一个已存在路径，realpath 后拼回剩余段，得到可比较的真实目标。 */
function resolveRealTarget(absoluteTarget: string): string | null {
  const pending: string[] = [];
  let current = absoluteTarget;

  while (true) {
    const real = realpathOrNull(current);
    if (real !== null) {
      return pending.length === 0 ? real : path.join(real, ...pending.slice().reverse());
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    pending.push(path.basename(current));
    current = parent;
  }
}

function isEscaping(relative: string): boolean {
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function realpathOrNull(targetPath: string): string | null {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return null;
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

export {checkWorkspaceWriteTarget};
export type {PathGuardResult};
