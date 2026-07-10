export type DiffLineKind = 'context' | 'added' | 'removed';

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

export type DiffHunk = {
  header?: string;
  lines: DiffLine[];
  newStart: number;
  oldStart: number;
};

export type DiffFileKind = 'added' | 'deleted' | 'modified' | 'renamed';

export type DiffFile = {
  added: number;
  hunks: DiffHunk[];
  kind: DiffFileKind;
  oldPath?: string;
  path: string;
  removed: number;
};

export type DiffSourceInfo = {
  kind: 'git' | 'history';
  label: string;
  reason?: string;
};

export type DiffSourceResult =
  | {
      files: DiffFile[];
      notices: string[];
      source: DiffSourceInfo;
      status: 'ready';
    }
  | {
      files: [];
      notices: string[];
      source: DiffSourceInfo;
      status: 'empty';
    };
