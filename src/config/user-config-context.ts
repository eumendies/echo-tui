import fs from 'node:fs';
import {createHash} from 'node:crypto';

import {applyAppSettingsDraft, normalizeAppSettings} from './app-settings-config';
import {JsonConfigFile, JsonConfigFileError, isJsonConfigObject} from './json-config-file';
import {
  LlmConfigError,
  createLlmModelConfigInfo,
  parseLlmConfiguration,
  parseToolRuntimeConfig,
  resolveLlmConfig,
  resolveLlmConfigForProfile
} from './llm-config';
import {LlmConfigEditorError, applyLlmConfigDraft, createLlmConfigDraft} from './llm-config-editor';
import {applyMcpEnabledStateDraft, createMcpConfig, createMcpConfigDraft, parseMcpConfigModel} from './mcp-config';
import {getDefaultUserConfigPath, watchUserConfig} from './user-config';
import {applyLifecycleHookConfigDraft, parseLifecycleHookConfig, parseLifecycleHookConfigDraft} from '../hooks/config';

import type {AppSettings} from './app-settings-config';
import type {JsonConfigFileOptions, JsonConfigObject, JsonConfigFileErrorKind} from './json-config-file';
import type {LlmModelConfigInfo, ParsedLlmConfiguration, ResolveLlmConfigOptions} from './llm-config';
import type {LlmConfig, ToolRuntimeConfig} from '../types/agent';
import type {LifecycleHookConfig, LifecycleHookConfigDraft} from '../types/hooks';
import type {LlmConfigDraft} from '../types/command';
import type {McpConfig, McpConfigDraft, McpEnabledStateDraft} from '../types/mcp';
import type {UserConfigWatcher} from './user-config';

type UserConfigSourceState = 'valid' | 'missing' | 'invalid_json' | 'invalid_root' | 'read_error';

type UserConfigDomains = {
  appSettings: boolean; // 归一化常规设置是否发生语义变化。
  hooks: boolean; // hooks 根节点是否发生语义变化。
  llm: boolean; // LLM provider/model 根节点是否发生语义变化。
  mcp: boolean; // MCP 根节点是否发生语义变化。
  tools: boolean; // tools 根节点是否发生语义变化。
};

type UserConfigChange = {
  domains: UserConfigDomains; // 本次 revision 中已知配置域的变化集合。
  previousRevision: number; // 被替换 snapshot 的 revision。
  revision: number; // 新安装 snapshot 的 revision。
  snapshot: UserConfigSnapshot; // 新 revision 的不可变读取入口。
};

type UserConfigRefreshResult = {
  changed: boolean; // fingerprint 是否变化并安装了新 snapshot。
  domains: UserConfigDomains; // changed=false 时所有字段均为 false。
  revision: number; // refresh 完成后的当前 revision。
  snapshot: UserConfigSnapshot; // refresh 完成后的当前 snapshot。
};

type UserConfigUpdateOptions = {
  allowMissing?: boolean; // 文件缺失时是否允许从空对象创建。
  missingRoot?: JsonConfigObject; // 文件缺失时替代空对象的领域草稿根。
};

type UserConfigContextOptions = JsonConfigFileOptions & {
  configPath?: string; // 用户配置路径，缺省时使用 ~/.echo/config.json。
  watchConfig?: (onChange: () => void, onError?: (error: Error) => void) => UserConfigWatcher; // watcher 测试替换缝。
};

type LoadedUserConfig = {
  fingerprint: string; // 整体内容或错误状态的不可逆摘要。
  root: JsonConfigObject; // 有效 JSON 根；无效状态使用私有空对象占位。
  sourceState: UserConfigSourceState; // 当前磁盘来源分类。
};

type DomainFingerprints = {
  appSettings: string; // 归一化 App settings 摘要。
  hooks: string; // hooks 根节点摘要。
  llm: string; // llm 根节点摘要。
  mcp: string; // mcp 根节点摘要。
  tools: string; // tools 根节点摘要。
};

const UNCHANGED_DOMAINS: Readonly<UserConfigDomains> = Object.freeze({
  appSettings: false,
  hooks: false,
  llm: false,
  mcp: false,
  tools: false
});

/**
 * 表示一次用户配置读取形成的不可变 revision；selector 只在内存中解析该 revision。
 */
class UserConfigSnapshot {
  readonly revision: number;
  readonly sourceState: UserConfigSourceState;
  private appSettingsCache?: AppSettings;
  private appSettingsDraftCache?: AppSettings;
  private hooksCache?: LifecycleHookConfig;
  private hooksDraftCache?: LifecycleHookConfigDraft;
  private llmDraftCache?: LlmConfigDraft;
  private llmParsedCache?: ParsedLlmConfiguration;
  private mcpDraftCache?: McpConfigDraft;
  private mcpRuntimeCache?: McpConfig;
  private modelInfoCache?: LlmModelConfigInfo;
  private readonly configPath: string;
  private readonly root: JsonConfigObject;
  private toolsCache?: ToolRuntimeConfig;

  constructor(revision: number, sourceState: UserConfigSourceState, root: JsonConfigObject, configPath: string) {
    this.revision = revision;
    this.sourceState = sourceState;
    this.root = cloneJson(root);
    this.configPath = configPath;
  }

  /** 返回容错常规设置；无效 source 按既有 runtime 语义回退默认值。 */
  getAppSettings(): AppSettings {
    this.appSettingsCache ||= freezeValue(normalizeAppSettings(this.sourceState === 'valid' ? this.root : {}));
    return this.appSettingsCache;
  }

  /** 返回常规设置草稿；只有 missing 可视为空配置，损坏文件继续抛出分类错误。 */
  getAppSettingsDraft(): AppSettings {
    this.assertDraftReadable();
    this.appSettingsDraftCache ||= freezeValue(normalizeAppSettings(this.root));
    return structuredClone(this.appSettingsDraftCache);
  }

  /** 返回当前模型目录，不暴露 provider 凭据。 */
  getLlmModelConfigInfo(): LlmModelConfigInfo {
    this.modelInfoCache ||= freezeValue(createLlmModelConfigInfo(this.getParsedLlm()));
    return this.modelInfoCache;
  }

  /** 解析宽松 per-run profile/effort 覆盖，并复用当前 revision 的 provider 图。 */
  resolveLlmConfig(options: ResolveLlmConfigOptions = {}): LlmConfig {
    return freezeValue(structuredClone(resolveLlmConfig(this.getParsedLlm(), this.getToolRuntimeConfig(), options)));
  }

  /** 严格解析指定 profile，不回退全局或 session 模型。 */
  resolveLlmConfigForProfile(modelProfileId: string): LlmConfig {
    return freezeValue(structuredClone(resolveLlmConfigForProfile(this.getParsedLlm(), this.getToolRuntimeConfig(), modelProfileId)));
  }

  /** 返回与 snapshot 根隔离的 LLM 配置草稿。 */
  getLlmConfigDraft(): LlmConfigDraft {
    this.assertLlmDraftReadable();
    this.llmDraftCache ||= freezeValue(createLlmConfigDraft(this.root));
    return structuredClone(this.llmDraftCache);
  }

  /** 返回 MCP runtime 投影；无效 source 按可选能力语义降级为空根。 */
  getMcpConfig(): McpConfig {
    this.mcpRuntimeCache ||= freezeValue(createMcpConfig(parseMcpConfigModel(this.getOptionalRoot())));
    return this.mcpRuntimeCache;
  }

  /** 返回保留 disabled/invalid server 的 MCP 面板草稿。 */
  getMcpConfigDraft(): McpConfigDraft {
    this.mcpDraftCache ||= freezeValue(createMcpConfigDraft(parseMcpConfigModel(this.getOptionalRoot())));
    return structuredClone(this.mcpDraftCache);
  }

  /** 返回启用且有效的 lifecycle hooks runtime 配置。 */
  getLifecycleHookConfig(): LifecycleHookConfig {
    this.hooksCache ||= freezeValue(parseLifecycleHookConfig(this.getOptionalRoot()));
    return this.hooksCache;
  }

  /** 返回保留 disabled entries 与诊断的 hooks 管理草稿。 */
  getLifecycleHookConfigDraft(): LifecycleHookConfigDraft {
    this.hooksDraftCache ||= freezeValue(parseLifecycleHookConfigDraft(this.getOptionalRoot(), this.configPath));
    return structuredClone(this.hooksDraftCache);
  }

  private getOptionalRoot(): JsonConfigObject {
    return this.sourceState === 'valid' ? this.root : {};
  }

  private getParsedLlm(): ParsedLlmConfiguration {
    this.assertLlmReadable();
    this.llmParsedCache ||= parseLlmConfiguration(this.root);
    return this.llmParsedCache;
  }

  private getToolRuntimeConfig(): ToolRuntimeConfig {
    this.toolsCache ||= freezeValue(parseToolRuntimeConfig(this.getOptionalRoot()));
    return this.toolsCache;
  }

  private assertDraftReadable(): void {
    if (this.sourceState === 'valid' || this.sourceState === 'missing') {
      return;
    }

    throw new JsonConfigFileError(toJsonConfigErrorKind(this.sourceState), this.configPath);
  }

  private assertLlmDraftReadable(): void {
    if (this.sourceState === 'valid' || this.sourceState === 'missing') {
      return;
    }

    if (this.sourceState === 'invalid_json') {
      throw new LlmConfigEditorError(`LLM 配置文件不是有效 JSON：${this.configPath}`);
    }
    if (this.sourceState === 'invalid_root') {
      throw new LlmConfigEditorError(`LLM 配置文件根节点必须是对象：${this.configPath}`);
    }
    throw new LlmConfigEditorError(`无法读取 LLM 配置文件：${this.configPath}`);
  }

  private assertLlmReadable(): void {
    if (this.sourceState === 'valid') {
      return;
    }

    if (this.sourceState === 'missing') {
      throw new LlmConfigError(`LLM 配置文件不存在：${this.configPath}`);
    }
    if (this.sourceState === 'invalid_json') {
      throw new LlmConfigError(`LLM 配置文件不是有效 JSON：${this.configPath}`);
    }
    if (this.sourceState === 'invalid_root') {
      throw new LlmConfigError('LLM 配置 根节点必须是对象');
    }
    throw new LlmConfigError(`无法读取 LLM 配置文件：${this.configPath}`);
  }
}

/**
 * 管理单个用户配置文件的 revision、watcher 和原子写后刷新；领域解析由 snapshot selector 承担。
 */
class UserConfigContext {
  private current: UserConfigSnapshot;
  private currentDomainFingerprints: DomainFingerprints;
  private currentFingerprint: string;
  private readonly configFile: JsonConfigFile;
  private readonly configPath: string;
  private readonly listeners = new Set<(change: UserConfigChange) => void>();
  private readonly readFile: (filePath: string, encoding: BufferEncoding) => string;
  private readonly watchConfig: (onChange: () => void, onError?: (error: Error) => void) => UserConfigWatcher;
  private watcher?: UserConfigWatcher;

  constructor(options: UserConfigContextOptions = {}) {
    this.configPath = options.configPath || getDefaultUserConfigPath();
    this.readFile = options.readFile || fs.readFileSync;
    this.configFile = new JsonConfigFile(this.configPath, options);
    this.watchConfig = options.watchConfig || ((onChange, onError) => watchUserConfig(onChange, onError, {configPath: this.configPath}));
    const loaded = this.load();
    this.currentFingerprint = loaded.fingerprint;
    this.currentDomainFingerprints = createDomainFingerprints(loaded);
    this.current = new UserConfigSnapshot(1, loaded.sourceState, loaded.root, this.configPath);
  }

  /** 返回当前不可变 snapshot；后续 refresh 不改变已返回实例。 */
  capture(): UserConfigSnapshot {
    return this.current;
  }

  /** 读取一次磁盘并在语义变化时安装新 revision。 */
  refresh(): UserConfigRefreshResult {
    return this.install(this.load());
  }

  /** 订阅 revision 变化；返回的函数只移除当前 listener。 */
  subscribe(listener: (change: UserConfigChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 启动单个 watcher 后立即补读，覆盖构造读取与监听注册之间的配置变化。 */
  startWatching(onError?: (error: Error) => void): void {
    if (this.watcher) {
      return;
    }

    this.watcher = this.watchConfig(() => this.refresh(), onError);
    this.refresh();
  }

  /** 关闭 watcher 并释放订阅者，供 TUI 退出和测试清理。 */
  close(): void {
    this.watcher?.close();
    this.watcher = undefined;
    this.listeners.clear();
  }

  /**
   * 以磁盘最新根执行领域变换并原子替换；成功写入后立即安装同一根形成的新 revision。
   */
  updateRoot(mutator: (root: JsonConfigObject) => void, options: UserConfigUpdateOptions = {}): UserConfigRefreshResult {
    let root: JsonConfigObject;

    try {
      root = this.configFile.read();
    } catch (error: unknown) {
      if (error instanceof JsonConfigFileError && error.kind === 'missing' && options.allowMissing !== false) {
        root = cloneJson(options.missingRoot || {});
      } else {
        throw error;
      }
    }

    mutator(root);
    this.configFile.write(root);
    return this.install(createLoadedValidConfig(root));
  }

  /** 保存常规设置并立即发布安装后的 snapshot。 */
  saveAppSettingsDraft(draft: AppSettings): UserConfigRefreshResult {
    return this.updateRoot((root) => applyAppSettingsDraft(root, draft));
  }

  /** 保存 LLM provider/model 草稿；缺失文件时沿用草稿携带的未知根节点。 */
  saveLlmConfigDraft(draft: LlmConfigDraft): UserConfigRefreshResult {
    try {
      return this.updateRoot((root) => applyLlmConfigDraft(root, draft), {
        missingRoot: isJsonConfigObject(draft.rootConfig) ? draft.rootConfig : {}
      });
    } catch (error: unknown) {
      if (error instanceof JsonConfigFileError && error.kind === 'invalid_json') {
        throw new LlmConfigEditorError(`LLM 配置文件不是有效 JSON：${this.configPath}`);
      }
      if (error instanceof JsonConfigFileError && error.kind === 'invalid_root') {
        throw new LlmConfigEditorError(`LLM 配置文件根节点必须是对象：${this.configPath}`);
      }
      throw error;
    }
  }

  /** 保存 MCP 开关；与旧 writer 一致，目标配置文件必须已经存在且有效。 */
  saveMcpEnabledStateDraft(draft: McpEnabledStateDraft): UserConfigRefreshResult {
    return this.updateRoot((root) => applyMcpEnabledStateDraft(root, draft), {allowMissing: false});
  }

  /** 保存 lifecycle hooks 草稿并立即发布安装后的 snapshot。 */
  saveLifecycleHookConfigDraft(draft: LifecycleHookConfigDraft): UserConfigRefreshResult {
    return this.updateRoot((root) => applyLifecycleHookConfigDraft(root, draft));
  }

  private load(): LoadedUserConfig {
    let raw: string;

    try {
      raw = this.readFile(this.configPath, 'utf8');
    } catch (error: unknown) {
      const sourceState: UserConfigSourceState = isNodeErrorCode(error, 'ENOENT') ? 'missing' : 'read_error';
      return createLoadedInvalidConfig(sourceState, sourceState);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return createLoadedInvalidConfig('invalid_json', raw);
    }

    if (!isJsonConfigObject(parsed)) {
      return createLoadedInvalidConfig('invalid_root', raw);
    }

    return createLoadedValidConfig(parsed);
  }

  private install(loaded: LoadedUserConfig): UserConfigRefreshResult {
    if (loaded.fingerprint === this.currentFingerprint) {
      return {
        changed: false,
        domains: {...UNCHANGED_DOMAINS},
        revision: this.current.revision,
        snapshot: this.current
      };
    }

    const previousRevision = this.current.revision;
    const nextDomainFingerprints = createDomainFingerprints(loaded);
    const domains = compareDomainFingerprints(this.currentDomainFingerprints, nextDomainFingerprints);
    this.currentFingerprint = loaded.fingerprint;
    this.currentDomainFingerprints = nextDomainFingerprints;
    this.current = new UserConfigSnapshot(previousRevision + 1, loaded.sourceState, loaded.root, this.configPath);
    const change = {domains, previousRevision, revision: this.current.revision, snapshot: this.current};

    for (const listener of this.listeners) {
      listener(change);
    }

    return {changed: true, domains, revision: this.current.revision, snapshot: this.current};
  }
}

function createLoadedValidConfig(root: JsonConfigObject): LoadedUserConfig {
  const cloned = cloneJson(root);
  return {fingerprint: hashText(`valid:${stableStringify(cloned)}`), root: cloned, sourceState: 'valid'};
}

function createLoadedInvalidConfig(sourceState: Exclude<UserConfigSourceState, 'valid'>, identity: string): LoadedUserConfig {
  return {fingerprint: hashText(`${sourceState}:${identity}`), root: {}, sourceState};
}

function createDomainFingerprints(loaded: LoadedUserConfig): DomainFingerprints {
  if (loaded.sourceState !== 'valid') {
    const fingerprint = hashText(`source:${loaded.sourceState}:${loaded.fingerprint}`);
    return {appSettings: fingerprint, hooks: fingerprint, llm: fingerprint, mcp: fingerprint, tools: fingerprint};
  }

  return {
    appSettings: hashValue(normalizeAppSettings(loaded.root)),
    hooks: hashValue(loaded.root.hooks),
    llm: hashValue(loaded.root.llm),
    mcp: hashValue(loaded.root.mcp),
    tools: hashValue(loaded.root.tools)
  };
}

function compareDomainFingerprints(previous: DomainFingerprints, next: DomainFingerprints): UserConfigDomains {
  return {
    appSettings: previous.appSettings !== next.appSettings,
    hooks: previous.hooks !== next.hooks,
    llm: previous.llm !== next.llm,
    mcp: previous.mcp !== next.mcp,
    tools: previous.tools !== next.tools
  };
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value: unknown): string {
  return hashText(stableStringify(value));
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

function freezeValue<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const entry of Object.values(value as Record<string, unknown>)) {
      freezeValue(entry);
    }
  }
  return value;
}

function toJsonConfigErrorKind(sourceState: UserConfigSourceState): JsonConfigFileErrorKind {
  return sourceState === 'read_error' ? 'read' : sourceState as JsonConfigFileErrorKind;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

export {
  UserConfigContext,
  UserConfigSnapshot
};

export type {
  UserConfigChange,
  UserConfigContextOptions,
  UserConfigDomains,
  UserConfigRefreshResult,
  UserConfigSourceState,
  UserConfigUpdateOptions
};
