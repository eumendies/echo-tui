import * as fs from 'node:fs';
import * as path from 'node:path';

import type {Result} from '../tool-handler-utils';

type DirectoryEntry = {
  kind: 'directory' | 'file' | 'other' | 'symlink';
  path: string;
  sizeBytes?: number;
};

type DirectoryReadResult = {
  effectiveLimit: number;
  entries: DirectoryEntry[];
  hasMore: boolean;
  limitCapped: boolean;
  totalEntries: number;
  truncated: boolean;
};

type DirectoryReadRequest = {
  limit?: number;
  offset: number;
  path: string;
};

/**
 * 枚举目录的直接子项并应用稳定排序和分页，不进入子目录或解析符号链接。
 */
function readDirectory(request: DirectoryReadRequest, absolutePath: string, maxDirectoryEntries: number): Result<DirectoryReadResult> {
  try {
    const allEntries = fs.readdirSync(absolutePath, {withFileTypes: true})
      .filter((entry) => entry.name !== '.git')
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    const effectiveLimit = Math.min(request.limit ?? maxDirectoryEntries, maxDirectoryEntries);
    const entries = allEntries.slice(request.offset, request.offset + effectiveLimit)
      .map((entry): DirectoryEntry => {
        const entryPath = path.join(request.path, entry.name);
        const kind = classifyDirectoryEntry(entry);

        if (kind !== 'file') {
          return {kind, path: entryPath};
        }

        try {
          const currentStat = fs.lstatSync(path.join(absolutePath, entry.name));

          return currentStat.isFile()
            ? {kind, path: entryPath, sizeBytes: currentStat.size}
            : {kind: classifyFileStat(currentStat), path: entryPath};
        } catch {
          return {kind, path: entryPath};
        }
      });
    const hasMore = request.offset + entries.length < allEntries.length;
    const limitCapped = request.limit !== undefined && request.limit > maxDirectoryEntries;

    return {
      ok: true,
      value: {
        effectiveLimit,
        entries,
        hasMore,
        limitCapped,
        totalEntries: allEntries.length,
        truncated: hasMore && (request.limit === undefined || limitCapped)
      }
    };
  } catch (error: unknown) {
    const reason = error instanceof Error && error.message.trim() !== '' ? error.message : 'failed to read directory';
    return {ok: false, reason};
  }
}

function classifyDirectoryEntry(entry: fs.Dirent): DirectoryEntry['kind'] {
  if (entry.isDirectory()) {
    return 'directory';
  }

  if (entry.isFile()) {
    return 'file';
  }

  if (entry.isSymbolicLink()) {
    return 'symlink';
  }

  return 'other';
}

function classifyFileStat(stat: fs.Stats): DirectoryEntry['kind'] {
  if (stat.isDirectory()) {
    return 'directory';
  }

  if (stat.isFile()) {
    return 'file';
  }

  if (stat.isSymbolicLink()) {
    return 'symlink';
  }

  return 'other';
}

export {
  readDirectory
};

export type {
  DirectoryEntry,
  DirectoryReadResult
};
