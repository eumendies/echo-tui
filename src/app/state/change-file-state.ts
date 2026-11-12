import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

import type {ChangeFileSnapshot} from '../../types/change-history';

type ChangeFileState = {
  snapshot: ChangeFileSnapshot | null; // null 表示路径存在但不是可恢复的普通文件或稳定文件链接。
  fingerprint: string; // 同一次读取所得的原始内容、权限及链接目标指纹。
};

/** 同步读取文件快照与指纹；跟随已有文件链接，同时将目标身份纳入核验，不依赖终端状态。 */
function readChangeFileState(filePath: string): ChangeFileState {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {snapshot: {exists: false}, fingerprint: 'missing'};
    }
    throw error;
  }
  let linkTarget: string | undefined;
  if (stat.isSymbolicLink()) {
    try {
      linkTarget = fs.realpathSync(filePath);
      stat = fs.statSync(filePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {snapshot: null, fingerprint: 'non-regular'};
      }
      throw error;
    }
  }
  if (!stat.isFile()) {
    return {snapshot: null, fingerprint: 'non-regular'};
  }
  const bytes = fs.readFileSync(filePath);
  const content = bytes.toString('utf8');
  const mode = stat.mode & 0o777;
  return {
    snapshot: {
      exists: true,
      ...(Buffer.from(content, 'utf8').equals(bytes) ? {content} : {contentBase64: bytes.toString('base64')}),
      mode,
      ...(linkTarget ? {linkTarget} : {})
    },
    fingerprint: createFileFingerprint(bytes, mode, linkTarget)
  };
}

/** 兼容本变更开发期间仅有结束指纹的中间态 journal；已发布旧记录没有结束指纹，不走此分支。 */
function getSnapshotFingerprint(snapshot: ChangeFileSnapshot): string {
  return snapshot.exists ? createFileFingerprint(snapshotBytes(snapshot), snapshot.mode, snapshot.linkTarget) : 'missing';
}

/** 原始字节与权限共同确定内容；链接额外绑定目标，防止等内容换链绕过冲突检查。 */
function createFileFingerprint(bytes: Buffer, mode: number | undefined, linkTarget?: string): string {
  const hash = createHash('sha256').update(`${mode}\0`);
  if (linkTarget) {
    hash.update(`symlink:${linkTarget}\0`);
  }
  return hash.update(bytes).digest('hex');
}

/** 解码持久化快照；旧版只有 content，新版仅在文本无法无损表示时使用 base64。 */
function snapshotBytes(snapshot: ChangeFileSnapshot): Buffer {
  return snapshot.contentBase64 !== undefined ? Buffer.from(snapshot.contentBase64, 'base64') : Buffer.from(snapshot.content || '', 'utf8');
}

/** 同步恢复已通过冲突检查的路径；已有符号链接按受控编辑工具的语义写入其目标。 */
function restoreChangeFileSnapshot(filePath: string, snapshot: ChangeFileSnapshot): void {
  if (!snapshot.exists) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, snapshotBytes(snapshot));
  if (snapshot.mode !== undefined) fs.chmodSync(filePath, snapshot.mode);
}

export {getSnapshotFingerprint, readChangeFileState, restoreChangeFileSnapshot};
