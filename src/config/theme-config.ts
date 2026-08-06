import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {JsonConfigFile, JsonConfigFileError, type JsonConfigFileOptions} from './json-config-file';

type RgbColor = readonly [number, number, number];

type RgbThemeColor = {
  kind: 'rgb';
  value: RgbColor;
};

type Ansi256ThemeColor = {
  ansi256: number;
  kind: 'ansi256';
};

type ThemeColor = RgbThemeColor | Ansi256ThemeColor;

type ThemeTextStyle = {
  background?: ThemeColor;
  bold?: boolean;
  dim?: boolean;
  foreground?: ThemeColor;
  inverse?: boolean;
};

type FooterThemeColors = {
  accent: ThemeColor;
  accentDeep: ThemeColor;
  accentStrong: ThemeColor;
  btw: ThemeColor; // BTW composer 边框与前缀的独立强调色。
  usageInput: ThemeColor;
  usageCached: ThemeColor;
  usageOutput: ThemeColor;
  danger: ThemeColor;
  diffAddedBackground: ThemeColor;
  diffRemovedBackground: ThemeColor;
  diffText: ThemeColor;
  frame: ThemeColor;
  muted: ThemeColor;
  off: ThemeColor;
  plan: ThemeColor;
  rail: ThemeColor;
  railOff: ThemeColor;
  selectionBackground: ThemeColor;
  success: ThemeColor;
  text: ThemeColor;
  warning: ThemeColor;
  white: ThemeColor;
  codeBackground: ThemeColor;
  codeForeground: ThemeColor;
};

type FooterTheme = {
  colors: FooterThemeColors;
  focusBar: string;
};

type BlocksThemeColors = {
  assistantPrefix: ThemeColor;
  bannerAccent: ThemeColor;
  bannerMuted: ThemeColor;
  error: ThemeColor;
  muted: ThemeColor;
  notice: ThemeColor;
  pendingPrefix: ThemeColor;
  reasoning: ThemeColor;
  shell: ThemeColor;
  text: ThemeColor;
  tool: ThemeColor;
  toolError: ThemeColor;
  toolOutput: ThemeColor;
  toolSuccess: ThemeColor;
  userBackground: ThemeColor;
  userPrefix: ThemeColor;
  userText: ThemeColor;
};

type BlocksTheme = {
  colors: BlocksThemeColors;
};

type MarkdownThemeStyles = {
  bold: ThemeTextStyle;
  heading: ThemeTextStyle;
  inlineCode: ThemeTextStyle;
  italic: ThemeTextStyle;
  link: ThemeTextStyle;
  listMarker: ThemeTextStyle;
  quote: ThemeTextStyle;
  rolePrefix: ThemeTextStyle;
  rule: ThemeTextStyle;
  tableHeader: ThemeTextStyle;
  tableSeparator: ThemeTextStyle;
};

type MarkdownTheme = {
  styles: MarkdownThemeStyles;
};

type SyntaxTokenKind =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'function'
  | 'variable'
  | 'operator'
  | 'punctuation';

type SyntaxTheme = Record<SyntaxTokenKind, ThemeTextStyle>;

type TuiTheme = {
  blocks: BlocksTheme;
  footer: FooterTheme;
  markdown: MarkdownTheme;
  syntax: SyntaxTheme;
};

type ReadTuiThemeOptions = {
  configPath?: string;
  readFile?: (filePath: string, encoding: BufferEncoding) => string;
};

type BuiltinThemeInfo = {
  description: string;
  id: string;
  label: string;
  path: string;
};

type BuiltinThemeOptions = {
  readDir?: (dirPath: string) => string[];
  readFile?: (filePath: string, encoding: BufferEncoding) => string;
  themesDir?: string;
};

type SelectBuiltinThemeOptions = ReadTuiThemeOptions & JsonConfigFileOptions;

type SelectBuiltinThemeResult =
  | {ok: true}
  | {ok: false; error: string};

type ConfigSource = Record<string, unknown>;

const BUILTIN_THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const DEFAULT_BUILTIN_THEME_INFO: BuiltinThemeInfo = {
  description: '默认青色渲染主题。',
  id: 'default',
  label: 'Echo Default',
  path: getBuiltinThemeConfigPath('default') || ''
};
const DEFAULT_TUI_THEME: TuiTheme = {
  blocks: {
    colors: {
      assistantPrefix: rgb(0, 170, 170),
      bannerAccent: rgb(0, 170, 170),
      bannerMuted: rgb(85, 85, 85),
      error: rgb(170, 0, 0),
      muted: rgb(85, 85, 85),
      notice: rgb(85, 85, 85),
      pendingPrefix: rgb(0, 170, 170),
      reasoning: rgb(85, 85, 85),
      shell: rgb(0, 170, 0),
      text: rgb(255, 255, 255),
      tool: rgb(0, 170, 170),
      toolError: rgb(170, 0, 0),
      toolOutput: rgb(85, 85, 85),
      toolSuccess: rgb(0, 170, 0),
      userBackground: ansi256(235),
      userPrefix: rgb(0, 170, 170),
      userText: rgb(255, 255, 255)
    }
  },
  footer: {
    colors: {
      accent: rgb(0, 200, 220),
      accentDeep: rgb(0, 120, 150),
      accentStrong: rgb(90, 230, 245),
      btw: rgb(255, 170, 80),
      usageInput: rgb(90, 230, 245),
      usageCached: rgb(0, 120, 150),
      usageOutput: rgb(96, 210, 165),
      danger: rgb(245, 95, 110),
      diffAddedBackground: ansi256(22),
      diffRemovedBackground: ansi256(52),
      diffText: ansi256(231),
      frame: rgb(40, 110, 125),
      muted: rgb(130, 150, 168),
      off: rgb(120, 130, 148),
      plan: rgb(170, 150, 245),
      rail: rgb(60, 78, 92),
      railOff: rgb(78, 96, 104),
      selectionBackground: ansi256(23),
      success: rgb(96, 210, 165),
      text: rgb(205, 213, 222),
      warning: rgb(240, 190, 120),
      white: rgb(235, 245, 248),
      codeBackground: ansi256(236),
      codeForeground: ansi256(117)
    },
    focusBar: '▌'
  },
  markdown: {
    styles: {
      bold: {bold: true},
      heading: {bold: true, foreground: rgb(0, 170, 170)},
      inlineCode: {foreground: rgb(170, 85, 0)},
      italic: {dim: true},
      link: {foreground: rgb(0, 170, 170)},
      listMarker: {foreground: rgb(0, 170, 170)},
      quote: {foreground: rgb(0, 170, 170)},
      rolePrefix: {foreground: rgb(0, 170, 170)},
      rule: {foreground: rgb(85, 85, 85)},
      tableHeader: {bold: true},
      tableSeparator: {foreground: rgb(85, 85, 85)}
    }
  },
  syntax: {
    plain: {foreground: rgb(255, 255, 255)},
    keyword: {bold: true, foreground: rgb(170, 0, 170)},
    string: {foreground: rgb(0, 170, 0)},
    number: {foreground: rgb(170, 85, 0)},
    comment: {foreground: rgb(85, 85, 85)},
    function: {bold: true, foreground: ansi256(208)},
    variable: {foreground: rgb(0, 170, 170)},
    operator: {foreground: rgb(85, 85, 85)},
    punctuation: {foreground: rgb(85, 85, 85)}
  }
};

function getDefaultThemeConfigPath(): string {
  return path.join(os.homedir(), '.echo', 'theme.json');
}

function getBuiltinThemeDir(): string {
  return path.join(__dirname, 'themes');
}

function getBuiltinThemeConfigPath(themeId = 'default', options: BuiltinThemeOptions = {}): string | null {
  if (!isValidBuiltinThemeId(themeId)) {
    return null;
  }

  return path.join(options.themesDir || getBuiltinThemeDir(), `${themeId}.json`);
}

/**
 * 返回随安装包发布的 theme 列表；坏文件会被跳过，避免影响 TUI 启动。
 */
function listBuiltinThemes(options: BuiltinThemeOptions = {}): BuiltinThemeInfo[] {
  const themesDir = options.themesDir || getBuiltinThemeDir();
  const readDir = options.readDir || fs.readdirSync;
  const readFile = options.readFile || fs.readFileSync;
  const themes = new Map<string, BuiltinThemeInfo>([
    ['default', {...DEFAULT_BUILTIN_THEME_INFO, path: getBuiltinThemeConfigPath('default', {themesDir}) || DEFAULT_BUILTIN_THEME_INFO.path}]
  ]);
  let entries: string[];

  try {
    entries = readDir(themesDir);
  } catch {
    return Array.from(themes.values());
  }

  for (const theme of entries
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => entry.slice(0, -'.json'.length))
    .filter(isValidBuiltinThemeId)
    .map((themeId) => readBuiltinThemeInfo(themeId, {themesDir, readFile}))
    .filter((theme): theme is BuiltinThemeInfo => Boolean(theme))) {
    themes.set(theme.id, theme);
  }

  return Array.from(themes.values())
    .sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * 读取随包发布的某个 theme；default 直接返回代码内默认值，避免启动默认路径做文件 I/O。
 */
function readBuiltinTheme(themeId: string, options: BuiltinThemeOptions = {}): TuiTheme | null {
  if (!isValidBuiltinThemeId(themeId)) {
    return null;
  }

  if (themeId === 'default') {
    return cloneTheme(DEFAULT_TUI_THEME);
  }

  return readBuiltinThemeFromDisk(themeId, DEFAULT_TUI_THEME, options);
}

/**
 * 读取用户级 TUI theme；展示配置必须容错，不能阻断应用启动。
 */
function readTuiTheme(options: ReadTuiThemeOptions = {}): TuiTheme {
  const configPath = options.configPath || getDefaultThemeConfigPath();
  const readFile = options.readFile || fs.readFileSync;

  try {
    const parsedConfig = new JsonConfigFile(configPath, {readFile}).readOptional();
    return normalizeTuiTheme(parsedConfig, resolveTuiThemeBase(parsedConfig, {readFile}));
  } catch {
    return cloneTheme(DEFAULT_TUI_THEME);
  }
}

/**
 * 读取用户级 theme base id；无效、缺失或不可读取时回到 default。
 */
function readTuiThemeBaseId(options: ReadTuiThemeOptions = {}): string {
  const configPath = options.configPath || getDefaultThemeConfigPath();
  const readFile = options.readFile || fs.readFileSync;

  try {
    const parsedConfig = new JsonConfigFile(configPath, {readFile}).readOptional();
    return resolveTuiThemeBaseId(parsedConfig, {readFile});
  } catch {
    return 'default';
  }
}

/**
 * 只更新 theme.json 根字段 theme，保留已有自定义 token override。
 */
function selectBuiltinTheme(themeId: string, options: SelectBuiltinThemeOptions = {}): SelectBuiltinThemeResult {
  const readFile = options.readFile || fs.readFileSync;
  const targetPath = options.configPath || getDefaultThemeConfigPath();

  if (!readBuiltinTheme(themeId, {readFile})) {
    return {ok: false, error: `未知 theme: ${themeId}`};
  }

  try {
    new JsonConfigFile(targetPath, options).update((rootConfig) => {
      rootConfig.theme = themeId;
    });
    return {ok: true};
  } catch (error: unknown) {
    if (error instanceof JsonConfigFileError && error.kind === 'invalid_root') {
      return {ok: false, error: 'theme.json 必须是 JSON object'};
    }

    if (error instanceof JsonConfigFileError) {
      return {ok: false, error: '无法读取 theme.json'};
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * 把用户输入归一化为完整 theme；未知字段和无效颜色都按默认值处理。
 */
function createTuiTheme(rawConfig: unknown): TuiTheme {
  return normalizeTuiTheme(rawConfig, DEFAULT_TUI_THEME);
}

function normalizeTuiTheme(rawConfig: unknown, baseTheme: TuiTheme): TuiTheme {
  const theme = cloneTheme(baseTheme);

  if (!isPlainObject(rawConfig)) {
    return theme;
  }

  normalizeColorGroup(theme.blocks.colors, rawConfig.blocks, 'colors');
  normalizeStyleGroup(theme.markdown.styles, rawConfig.markdown, 'styles');
  normalizeStyleGroup(theme.syntax, rawConfig.syntax, null);

  const rawFooter = rawConfig.footer;
  normalizeColorGroup(theme.footer.colors, rawFooter, 'colors');
  if (isPlainObject(rawFooter) && typeof rawFooter.focusBar === 'string' && rawFooter.focusBar.length > 0) {
    theme.footer.focusBar = Array.from(rawFooter.focusBar)[0] || theme.footer.focusBar;
  }

  return theme;
}

function resolveTuiThemeBase(rawConfig: unknown, options: BuiltinThemeOptions = {}): TuiTheme {
  const themeId = resolveTuiThemeBaseId(rawConfig, options);
  return readBuiltinTheme(themeId, options) || cloneTheme(DEFAULT_TUI_THEME);
}

function resolveTuiThemeBaseId(rawConfig: unknown, options: BuiltinThemeOptions = {}): string {
  if (!isPlainObject(rawConfig) || typeof rawConfig.theme !== 'string') {
    return 'default';
  }

  const themeId = rawConfig.theme.trim();

  if (!themeId || !readBuiltinTheme(themeId, options)) {
    return 'default';
  }

  return themeId;
}

function normalizeColorGroup<T extends Record<string, ThemeColor>>(target: T, rawSection: unknown, fieldName: string | null): void {
  const rawColors = resolveSectionObject(rawSection, fieldName);

  if (!rawColors) {
    return;
  }

  for (const key of Object.keys(target) as Array<keyof T>) {
    const parsed = parseThemeColor(rawColors[String(key)]);

    if (parsed) {
      target[key] = parsed as T[keyof T];
    }
  }
}

function normalizeStyleGroup<T extends Record<string, ThemeTextStyle>>(target: T, rawSection: unknown, fieldName: string | null): void {
  const rawStyles = resolveSectionObject(rawSection, fieldName);

  if (!rawStyles) {
    return;
  }

  for (const key of Object.keys(target) as Array<keyof T>) {
    const parsed = parseThemeTextStyle(rawStyles[String(key)]);

    if (parsed) {
      target[key] = parsed as T[keyof T];
    }
  }
}

function resolveSectionObject(rawSection: unknown, fieldName: string | null): ConfigSource | null {
  if (!isPlainObject(rawSection)) {
    return null;
  }

  if (!fieldName) {
    return rawSection;
  }

  return isPlainObject(rawSection[fieldName]) ? rawSection[fieldName] : null;
}

function parseThemeColor(rawColor: unknown): ThemeColor | null {
  if (typeof rawColor === 'string') {
    return parseHexColor(rawColor);
  }

  if (Array.isArray(rawColor)) {
    return parseRgbTuple(rawColor);
  }

  if (isPlainObject(rawColor)) {
    return parseAnsi256Color(rawColor);
  }

  return null;
}

function parseHexColor(rawColor: string): ThemeColor | null {
  const normalized = rawColor.trim();
  const match = /^#?([0-9a-fA-F]{6})$/.exec(normalized);

  if (!match) {
    return null;
  }

  const value = match[1];
  return rgb(
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16)
  );
}

function parseRgbTuple(rawColor: unknown[]): ThemeColor | null {
  if (rawColor.length !== 3) {
    return null;
  }

  const values = rawColor.map((value) => Number(value));

  if (!values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    return null;
  }

  return rgb(values[0], values[1], values[2]);
}

function parseAnsi256Color(rawColor: ConfigSource): ThemeColor | null {
  if (rawColor.ansi256 !== undefined) {
    const code = Number(rawColor.ansi256);

    if (!Number.isInteger(code) || code < 0 || code > 255) {
      return null;
    }

    return ansi256(code);
  }

  return null;
}

function parseThemeTextStyle(rawStyle: unknown): ThemeTextStyle | null {
  const color = parseThemeColor(rawStyle);
  if (color) {
    return {foreground: color};
  }

  if (!isPlainObject(rawStyle)) {
    return null;
  }

  const style: ThemeTextStyle = {};

  if (rawStyle.foreground !== undefined) {
    const foreground = parseThemeColor(rawStyle.foreground);

    if (!foreground) {
      return null;
    }

    style.foreground = foreground;
  }

  if (rawStyle.background !== undefined) {
    const background = parseThemeColor(rawStyle.background);

    if (!background) {
      return null;
    }

    style.background = background;
  }

  if (rawStyle.bold !== undefined) {
    if (typeof rawStyle.bold !== 'boolean') {
      return null;
    }

    style.bold = rawStyle.bold;
  }

  if (rawStyle.dim !== undefined) {
    if (typeof rawStyle.dim !== 'boolean') {
      return null;
    }

    style.dim = rawStyle.dim;
  }

  if (rawStyle.inverse !== undefined) {
    if (typeof rawStyle.inverse !== 'boolean') {
      return null;
    }

    style.inverse = rawStyle.inverse;
  }

  return style;
}

function rgb(r: number, g: number, b: number): RgbThemeColor {
  return {
    kind: 'rgb',
    value: [r, g, b]
  };
}

function ansi256(code: number): Ansi256ThemeColor {
  return {
    ansi256: code,
    kind: 'ansi256'
  };
}

function cloneTheme(theme: TuiTheme): TuiTheme {
  const footerColors = Object.fromEntries(
    Object.entries(theme.footer.colors).map(([key, color]) => [key, cloneThemeColor(color)])
  ) as FooterThemeColors;
  const blocksColors = Object.fromEntries(
    Object.entries(theme.blocks.colors).map(([key, color]) => [key, cloneThemeColor(color)])
  ) as BlocksThemeColors;
  const markdownStyles = Object.fromEntries(
    Object.entries(theme.markdown.styles).map(([key, style]) => [key, cloneThemeTextStyle(style)])
  ) as MarkdownThemeStyles;
  const syntax = Object.fromEntries(
    Object.entries(theme.syntax).map(([key, style]) => [key, cloneThemeTextStyle(style)])
  ) as SyntaxTheme;

  return {
    blocks: {
      colors: blocksColors
    },
    footer: {
      colors: footerColors,
      focusBar: theme.footer.focusBar
    },
    markdown: {
      styles: markdownStyles
    },
    syntax
  };
}

function cloneThemeColor(color: ThemeColor): ThemeColor {
  return color.kind === 'rgb'
    ? {kind: 'rgb', value: [...color.value] as unknown as RgbColor}
    : {...color};
}

function cloneThemeTextStyle(style: ThemeTextStyle): ThemeTextStyle {
  return {
    ...style,
    ...(style.background ? {background: cloneThemeColor(style.background)} : {}),
    ...(style.foreground ? {foreground: cloneThemeColor(style.foreground)} : {})
  };
}

function isPlainObject(value: unknown): value is ConfigSource {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidBuiltinThemeId(themeId: string): boolean {
  return BUILTIN_THEME_ID_PATTERN.test(themeId);
}

function readBuiltinThemeFromDisk(themeId: string, baseTheme: TuiTheme, options: BuiltinThemeOptions = {}): TuiTheme | null {
  const themePath = getBuiltinThemeConfigPath(themeId, options);
  const readFile = options.readFile || fs.readFileSync;

  if (!themePath) {
    return null;
  }

  try {
    return normalizeTuiTheme(JSON.parse(readFile(themePath, 'utf8')), baseTheme);
  } catch {
    return null;
  }
}

function readBuiltinThemeInfo(themeId: string, options: BuiltinThemeOptions): BuiltinThemeInfo | null {
  const themePath = getBuiltinThemeConfigPath(themeId, options);
  const readFile = options.readFile || fs.readFileSync;

  if (!themePath) {
    return null;
  }

  try {
    const rawConfig = JSON.parse(readFile(themePath, 'utf8'));

    if (!isPlainObject(rawConfig)) {
      return null;
    }

    return {
      description: typeof rawConfig.description === 'string' ? rawConfig.description : '',
      id: themeId,
      label: typeof rawConfig.label === 'string' && rawConfig.label.trim() ? rawConfig.label : themeId,
      path: themePath
    };
  } catch {
    return null;
  }
}

export {
  DEFAULT_TUI_THEME,
  createTuiTheme,
  getBuiltinThemeConfigPath,
  getBuiltinThemeDir,
  getDefaultThemeConfigPath,
  listBuiltinThemes,
  readBuiltinTheme,
  readTuiTheme,
  readTuiThemeBaseId,
  selectBuiltinTheme
};

export type {
  BuiltinThemeInfo,
  BuiltinThemeOptions,
  BlocksTheme,
  BlocksThemeColors,
  FooterTheme,
  FooterThemeColors,
  MarkdownTheme,
  MarkdownThemeStyles,
  ReadTuiThemeOptions,
  RgbColor,
  SelectBuiltinThemeOptions,
  SelectBuiltinThemeResult,
  SyntaxTheme,
  SyntaxTokenKind,
  ThemeColor,
  ThemeTextStyle,
  TuiTheme
};
