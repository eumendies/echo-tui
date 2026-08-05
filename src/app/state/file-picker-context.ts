import * as fs from 'node:fs';
import * as path from 'node:path';

import * as composerOps from '../../input/composer';
import {INPUT_EVENTS} from '../../input/event-types';
import {formatFileMention} from '../../input/file-mentions';
import {splitGraphemes} from '../../input/graphemes';
import {capUtf8Text} from '../../tools/tool-handler-utils';

import type {ComposerState} from '../../types/composer';
import type {FilePickerCommandSurface, FilePickerSurfaceEntry} from '../../types/command';
import type {InputEvent} from '../../types/input';

type FilePickerEntryKind = FilePickerSurfaceEntry['kind'];
type FilePickerFocus = FilePickerCommandSurface['focus'];

type FilePickerEntry = {
  kind: FilePickerEntryKind;
  name: string;
  path: string;
  selectable: boolean;
};

type TextPreviewData =
  | {kind: 'text'; lines: string[]; maxScroll: number; meta: string; name: string}
  | {kind: 'message'; lines: string[]; maxScroll: 0};

type FilePickerState = {
  currentDir: string;
  entries: FilePickerEntry[];
  focus: FilePickerFocus;
  index: number;
  notice?: string;
  previewScroll: number;
  query: string;
  selectedPaths: string[];
  triggerStart: number;
  triggerEnd: number;
};

type FilePickerContextOptions = {
  cwd: () => string;
  onChange: () => void;
  rows?: () => number;
};

const TEXT_PREVIEW_BYTES = 64 * 1024;
const TEXT_PREVIEW_LINES = 500;
const DEFAULT_TERMINAL_ROWS = 24;
const FOOTER_TOP_PADDING_LINES = 2;
const TRANSCRIPT_COMPOSER_SPACER_LINE_COUNT = 1;
const FILE_PICKER_FIXED_LINES = 6;
const TEXT_PREVIEW_HEADER_LINES = 3;
const CODE_PREVIEW_EXTENSIONS = new Set([
  '.bash',
  '.c',
  '.cc',
  '.cjs',
  '.cpp',
  '.cs',
  '.css',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsonc',
  '.jsx',
  '.kt',
  '.kts',
  '.less',
  '.mjs',
  '.php',
  '.ps1',
  '.py',
  '.rb',
  '.rs',
  '.sass',
  '.scala',
  '.scss',
  '.sh',
  '.sql',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh'
]);
const CODE_PREVIEW_FILENAMES = new Set(['dockerfile', 'gemfile', 'makefile', 'procfile', 'rakefile']);

/**
 * 管理 composer 内 @ 文件选择器的 transient 状态、文件列表和按键语义。
 */
class FilePickerContext {
  private readonly composer: ComposerState;
  private readonly options: FilePickerContextOptions;
  private readonly textPreviewCache: Map<string, TextPreviewData>;
  private state: FilePickerState | null;

  constructor(composer: ComposerState, options: FilePickerContextOptions) {
    this.composer = composer;
    this.options = options;
    this.textPreviewCache = new Map();
    this.state = null;
  }

  hasActiveRequest(): boolean {
    return this.state !== null;
  }

  open(triggerStart: number): void {
    const cwd = this.options.cwd();
    const loaded = loadDirectoryEntries(cwd, '');
    this.textPreviewCache.clear();
    this.state = {
      currentDir: '',
      entries: loaded.entries,
      focus: 'list',
      index: 0,
      notice: loaded.notice,
      previewScroll: 0,
      query: '',
      selectedPaths: [],
      triggerEnd: triggerStart + 1,
      triggerStart
    };
    this.options.onChange();
  }

  close(): void {
    this.textPreviewCache.clear();
    this.state = null;
    this.options.onChange();
  }

  handleEvent(event: InputEvent): void {
    if (!this.state) {
      return;
    }

    if (event.type === INPUT_EVENTS.TEXT) {
      this.handleText(event.value);
      return;
    }

    if (event.type === INPUT_EVENTS.BACKSPACE) {
      this.handleBackspace();
      return;
    }

    if (event.type === INPUT_EVENTS.ESCAPE) {
      this.close();
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP) {
      this.move(-1);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_DOWN) {
      this.move(1);
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_RIGHT || event.type === INPUT_EVENTS.TAB) {
      this.enterOrFocusPreview();
      return;
    }

    if (event.type === INPUT_EVENTS.MOVE_LEFT) {
      this.backOrFocusList();
      return;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      this.confirm();
    }
  }

  getSurface(): FilePickerCommandSurface | null {
    if (!this.state) {
      return null;
    }

    const entries = this.getEntries();
    const selectedIndex = normalizeIndex(this.state.index, entries.length);
    const current = entries[selectedIndex];

    return {
      kind: 'file_picker',
      currentDir: path.join(this.options.cwd(), this.state.currentDir),
      dismissHint: '↑↓ 移动 · → 预览/进入目录 · ← 返回 · Space 选择 · Enter 插入 · Esc 取消',
      entries: entries.map((entry) => ({
        ...entry,
        selected: this.state?.selectedPaths.includes(entry.path) ?? false
      })),
      focus: this.state.focus,
      notice: this.state.notice,
      previewLines: this.createPreview(current),
      previewMode: current?.kind === 'text' && isCodeLikePreviewPath(current.path) ? 'code' : 'text',
      query: this.state.query,
      selectedIndex,
      selectedPaths: [...this.state.selectedPaths],
      title: 'Paths'
    };
  }

  private handleText(value: string): void {
    if (!this.state) {
      return;
    }

    if (value === ' ') {
      this.toggleCurrent();
      return;
    }

    composerOps.replaceRange(this.composer, this.state.triggerEnd, this.state.triggerEnd, value);
    this.state = {
      ...this.state,
      focus: 'list',
      index: 0,
      notice: undefined,
      previewScroll: 0,
      query: this.state.query + value,
      triggerEnd: this.state.triggerEnd + splitGraphemes(value).length
    };
    this.options.onChange();
  }

  private handleBackspace(): void {
    if (!this.state) {
      return;
    }

    if (this.state.triggerEnd <= this.state.triggerStart) {
      this.close();
      return;
    }

    composerOps.replaceRange(this.composer, this.state.triggerEnd - 1, this.state.triggerEnd, '');

    if (this.state.triggerEnd - 1 <= this.state.triggerStart) {
      this.close();
      return;
    }

    this.state = {
      ...this.state,
      focus: 'list',
      index: 0,
      notice: undefined,
      previewScroll: 0,
      query: this.state.query.slice(0, -1),
      triggerEnd: this.state.triggerEnd - 1
    };
    this.options.onChange();
  }

  private move(direction: number): void {
    if (!this.state) {
      return;
    }

    if (this.state.focus === 'preview') {
      const nextScroll = clampPreviewScroll(this.options.cwd(), this.currentEntry(), this.state.previewScroll + direction, this.textPreviewCache);

      if (nextScroll !== this.state.previewScroll || this.state.notice) {
        this.state = {...this.state, previewScroll: nextScroll, notice: undefined};
        this.options.onChange();
      }
      return;
    }

    const entries = this.getEntries();
    this.state = {
      ...this.state,
      index: normalizeIndex(this.state.index + direction, entries.length),
      notice: undefined,
      previewScroll: 0
    };
    this.options.onChange();
  }

  private enterOrFocusPreview(): void {
    const entry = this.currentEntry();

    if (!this.state || !entry) {
      return;
    }

    if (entry.kind === 'directory') {
      const loaded = loadDirectoryEntries(this.options.cwd(), entry.path);
      this.state = {...this.state, currentDir: entry.path, entries: loaded.entries, focus: 'list', index: 0, notice: loaded.notice, previewScroll: 0, query: ''};
      composerOps.replaceRange(this.composer, this.state.triggerStart + 1, this.state.triggerEnd, '');
      this.state.triggerEnd = this.state.triggerStart + 1;
      this.options.onChange();
      return;
    }

    if (this.state.focus !== 'preview' || this.state.notice) {
      this.state = {...this.state, focus: 'preview', notice: undefined};
      this.options.onChange();
    }
  }

  private backOrFocusList(): void {
    if (!this.state) {
      return;
    }

    if (this.state.focus === 'preview') {
      this.state = {...this.state, focus: 'list', notice: undefined};
      this.options.onChange();
      return;
    }

    const parent = path.posix.dirname(this.state.currentDir);
    const parentDir = parent === '.' ? '' : parent;

    if (parent === '.' && this.state.currentDir === '' && !this.state.notice && this.state.query === '') {
      return;
    }

    const loaded = loadDirectoryEntries(this.options.cwd(), parentDir);

    this.state = {
      ...this.state,
      currentDir: parentDir,
      entries: loaded.entries,
      index: 0,
      notice: loaded.notice,
      previewScroll: 0,
      query: ''
    };
    composerOps.replaceRange(this.composer, this.state.triggerStart + 1, this.state.triggerEnd, '');
    this.state.triggerEnd = this.state.triggerStart + 1;
    this.options.onChange();
  }

  private toggleCurrent(): void {
    const entry = this.currentEntry();

    if (!this.state || !entry) {
      return;
    }

    if (!entry.selectable) {
      this.state = {...this.state, notice: '该文件类型暂不支持选择'};
      this.options.onChange();
      return;
    }

    const selected = this.state.selectedPaths.includes(entry.path)
      ? this.state.selectedPaths.filter((item) => item !== entry.path)
      : [...this.state.selectedPaths, entry.path];
    this.state = {...this.state, selectedPaths: selected, notice: undefined};
    this.options.onChange();
  }

  private confirm(): void {
    const entry = this.currentEntry();

    if (!this.state) {
      return;
    }

    const paths = this.state.selectedPaths.length > 0 ? this.state.selectedPaths : entry?.selectable ? [entry.path] : [];

    if (paths.length === 0) {
      const notice = entry ? '该文件类型暂不支持选择' : this.state.notice || '当前没有可插入路径';
      this.state = {...this.state, notice};
      this.options.onChange();
      return;
    }

    const replacement = `${paths.map(formatFileMention).join(' ')} `;
    composerOps.replaceRange(this.composer, this.state.triggerStart, this.state.triggerEnd, replacement);
    this.state = null;
    this.options.onChange();
  }

  private currentEntry(): FilePickerEntry | null {
    const entries = this.getEntries();
    return entries[normalizeIndex(this.state?.index ?? 0, entries.length)] || null;
  }

  private getEntries(): FilePickerEntry[] {
    if (!this.state) {
      return [];
    }

    const query = this.state.query.toLowerCase();

    if (query !== '') {
      return this.state.entries.filter((entry) => entry.name.toLowerCase().includes(query) || entry.path.toLowerCase().includes(query));
    }

    return this.state.entries;
  }

  private createPreview(entry: FilePickerEntry | null): string[] {
    if (!this.state || !entry) {
      return ['无可预览内容'];
    }

    if (entry.kind === 'directory') {
      return [`${entry.name}/`, 'directory', '按 Enter 插入目录 · 按 → 进入目录'];
    }

    if (entry.kind === 'pdf') {
      return [entry.name, 'PDF document', '提交时会提取 PDF 文字作为上下文。', '不支持 OCR 或页面渲染。'];
    }

    if (entry.kind === 'image') {
      return [entry.name, 'image', '图片无法在终端内预览。', '选择后会作为图片输入发送给模型。'];
    }

    if (entry.kind === 'unsupported') {
      return [entry.name, '无法预览。', '当前仅支持选择文本、PDF 和受支持图片文件。'];
    }

    return renderTextPreview(
      getTextPreviewData(this.textPreviewCache, path.join(this.options.cwd(), entry.path)),
      this.state.previewScroll,
      calculateTextPreviewWindowLines(this.options.rows?.(), this.state.query)
    );
  }
}

function createFileEntry(cwd: string, filePath: string): FilePickerEntry {
  const kind = detectFileKind(path.join(cwd, filePath));
  return {
    kind,
    name: path.posix.basename(filePath),
    path: filePath,
    selectable: kind === 'text' || kind === 'pdf' || kind === 'image'
  };
}

function loadDirectoryEntries(cwd: string, relativeDir: string): {entries: FilePickerEntry[]; notice?: string} {
  const absoluteDir = path.join(cwd, relativeDir);

  try {
    const entries = fs.readdirSync(absoluteDir, {withFileTypes: true})
      .filter((dirent) => dirent.name !== '.git')
      .map((dirent) => createDirectoryEntry(cwd, relativeDir, dirent))
      .filter((entry): entry is FilePickerEntry => entry !== null)
      .sort(compareFilePickerEntries);

    return {
      entries,
      notice: entries.length === 0 ? '当前目录没有可显示路径' : undefined
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '读取失败';
    return {entries: [], notice: `读取目录失败：${message}`};
  }
}

function createDirectoryEntry(cwd: string, relativeDir: string, dirent: fs.Dirent): FilePickerEntry | null {
  const filePath = relativeDir === '' ? dirent.name : `${relativeDir}/${dirent.name}`;

  if (dirent.isDirectory()) {
    return {kind: 'directory', name: dirent.name, path: filePath, selectable: true};
  }

  if (!dirent.isFile()) {
    return null;
  }

  return createFileEntry(cwd, filePath);
}

function compareFilePickerEntries(left: FilePickerEntry, right: FilePickerEntry): number {
  if (left.kind === 'directory' && right.kind !== 'directory') {
    return -1;
  }

  if (left.kind !== 'directory' && right.kind === 'directory') {
    return 1;
  }

  return left.name.localeCompare(right.name);
}

function detectFileKind(absolutePath: string): FilePickerEntryKind {
  const extension = path.extname(absolutePath).toLowerCase();

  if (extension === '.pdf') {
    return 'pdf';
  }

  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extension)) {
    return 'image';
  }

  try {
    const buffer = Buffer.alloc(4096);
    const fd = fs.openSync(absolutePath, 'r');
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    const sample = buffer.subarray(0, bytesRead);

    if (sample.includes(0)) {
      return 'unsupported';
    }

    return 'text';
  } catch {
    return 'unsupported';
  }
}

function getTextPreviewData(cache: Map<string, TextPreviewData>, absolutePath: string): TextPreviewData {
  const cached = cache.get(absolutePath);

  if (cached) {
    return cached;
  }

  const loaded = readTextPreviewData(absolutePath);
  cache.set(absolutePath, loaded);
  return loaded;
}

function readTextPreviewData(absolutePath: string): TextPreviewData {
  try {
    const buffer = fs.readFileSync(absolutePath).subarray(0, TEXT_PREVIEW_BYTES + 1);

    if (buffer.includes(0)) {
      return {kind: 'message', lines: [path.basename(absolutePath), '无法预览。', '当前仅支持选择文本、PDF 和受支持图片文件。'], maxScroll: 0};
    }

    const capped = capUtf8Text(buffer.toString('utf8'), TEXT_PREVIEW_BYTES);
    const lines = capped.text.split(/\r?\n/u).slice(0, TEXT_PREVIEW_LINES);
    const meta = `text · ${lines.length}${capped.truncated ? '+' : ''} lines`;
    return {kind: 'text', lines, maxScroll: maxTextPreviewScroll(lines.length), meta, name: path.basename(absolutePath)};
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '读取失败';
    return {kind: 'message', lines: [path.basename(absolutePath), `读取失败：${message}`], maxScroll: 0};
  }
}

function renderTextPreview(preview: TextPreviewData, offset: number, windowLines: number): string[] {
  if (preview.kind === 'message') {
    return preview.lines;
  }

  const normalizedOffset = Math.min(Math.max(0, offset), preview.maxScroll);
  const window = preview.lines.slice(normalizedOffset, normalizedOffset + windowLines);
  return [preview.name, preview.meta, ...window.map((line, index) => `${normalizedOffset + index + 1} ${line}`)];
}

/**
 * 用当前终端高度反推 preview 文本窗口；公式和 footer/file-picker 的固定行预算保持一致。
 */
function calculateTextPreviewWindowLines(rows: number | undefined, query: string): number {
  const terminalRows = Number.isFinite(rows) ? Math.floor(Number(rows)) : DEFAULT_TERMINAL_ROWS;
  const commandSurfaceLines = Math.max(1, terminalRows - FOOTER_TOP_PADDING_LINES - TRANSCRIPT_COMPOSER_SPACER_LINE_COUNT);
  const bodyHeight = Math.max(1, commandSurfaceLines - FILE_PICKER_FIXED_LINES - (query ? 1 : 0));
  return Math.max(1, bodyHeight - TEXT_PREVIEW_HEADER_LINES);
}

function clampPreviewScroll(cwd: string, entry: FilePickerEntry | null, offset: number, cache: Map<string, TextPreviewData>): number {
  if (!entry || entry.kind !== 'text') {
    return 0;
  }

  return Math.min(Math.max(0, offset), getTextPreviewData(cache, path.join(cwd, entry.path)).maxScroll);
}

function maxTextPreviewScroll(lineCount: number): number {
  return Math.max(0, lineCount - 1);
}

function isCodeLikePreviewPath(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath).toLowerCase();
  return CODE_PREVIEW_EXTENSIONS.has(extension) || CODE_PREVIEW_FILENAMES.has(filename);
}

function normalizeIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }

  return Math.min(Math.max(0, index), length - 1);
}

export {FilePickerContext, loadDirectoryEntries, formatFileMention};
export type {FilePickerEntry};
