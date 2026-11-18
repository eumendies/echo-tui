import {createConfiguredAgent} from '../agent/agent-setup';
import {splitGraphemes} from '../input/graphemes';
import {SESSION_TITLE_MAX_CHARS} from '../persistence/transcript-store';
import {AgentAbortError} from '../types/agent';

import type {AgentUserConfigSnapshot, LlmConfig, ProviderAgent} from '../types/agent';

const SESSION_TITLE_TIMEOUT_MS = 15_000;

const SESSION_TITLE_SYSTEM_PROMPT = [
  'Generate a concise, sentence-case title (3-7 words) that captures the main topic or goal of this coding session.',
  'The title should be clear enough that the user recognizes the session in a list.',
  'Write the title in the same language as the user message, and use sentence case for languages that distinguish it.',
  '',
  'Return JSON with a single "title" field.',
  '',
  'Good examples:',
  '{"title": "Fix login button on mobile"}',
  '{"title": "Add OAuth authentication"}',
  '{"title": "Debug failing CI tests"}',
  '',
  'Bad (too vague): {"title": "Code changes"}',
  'Bad (too long): {"title": "Investigate and fix the issue where the login button does not respond on mobile devices"}'
].join('\n');

type SessionTitleGeneratorInput = {
  firstUserMessage: string; // 会话首条用户消息正文，已由调用方完成角色与来源过滤。
  userConfigSnapshot: Pick<AgentUserConfigSnapshot, 'getAppSettings' | 'resolveLlmConfig' | 'resolveLlmConfigForProfile'>; // 与主运行同 revision 的配置快照。
};

type SessionTitleGeneratorDependencies = {
  createAgent?: (config: LlmConfig) => ProviderAgent; // 无 registry provider 构造的测试替换缝。
  timeoutMs?: number; // 独立 deadline 的测试替换缝。
};

type SessionTitleGenerator = (input: SessionTitleGeneratorInput) => Promise<string | null>;

type TitleDeadline = {
  dispose: () => void; // 清理 deadline timer 与父信号监听。
  run: <Value>(operation: Promise<Value>) => Promise<Value>; // 在 deadline 或父中断前等待 provider 请求。
  signal: AbortSignal; // 同时反映 deadline 与父信号的 provider-facing signal。
};

/**
 * 创建一次性的会话标题生成器：无工具、强制 low effort、失败返回 null。
 * 调用方无需处理错误，所有异常都在边界内转换为"本次不生成"。
 */
function createSessionTitleGenerator(dependencies: SessionTitleGeneratorDependencies = {}): SessionTitleGenerator {
  return async (input) => {
    const message = String(input.firstUserMessage || '').trim();

    if (message === '') {
      return null;
    }

    let deadline: TitleDeadline | undefined;

    try {
      if (input.userConfigSnapshot.getAppSettings().titleGenerationEnabled === false) {
        return null;
      }

      const config = resolveTitleConfig(input.userConfigSnapshot);
      const agent = dependencies.createAgent
        ? dependencies.createAgent(config)
        : createConfiguredAgent(config);
      deadline = createTitleDeadline(dependencies.timeoutMs ?? SESSION_TITLE_TIMEOUT_MS);
      // 只保留 system 指令与首条用户消息：不注入项目指令、skill catalog 与 plan 约束。
      const result = await deadline.run(agent.runTurn([
        {role: 'system', text: SESSION_TITLE_SYSTEM_PROMPT},
        {role: 'user', text: message}
      ], undefined, {abortSignal: deadline.signal}));

      return result.toolCalls.length === 0 ? parseSessionTitle(result.draft) : null;
    } catch {
      return null;
    } finally {
      deadline?.dispose();
    }
  };
}

/**
 * 解析标题请求的 provider 配置：配置了专用 profile 时严格解析且不回退，
 * 否则复用当前生效模型并覆盖 low effort。
 */
function resolveTitleConfig(
  snapshot: Pick<AgentUserConfigSnapshot, 'getAppSettings' | 'resolveLlmConfig' | 'resolveLlmConfigForProfile'>
): LlmConfig {
  const profileId = snapshot.getAppSettings().titleGenerationModelProfileId;
  const loaded = profileId
    ? snapshot.resolveLlmConfigForProfile(profileId)
    : snapshot.resolveLlmConfig({reasoningEffortOverride: 'low'});
  // 标题生成不需要 reasoning summary；统一强制 low 以固定延迟与成本。
  const {reasoningSummary: _reasoningSummary, ...rest} = loaded;

  return {...rest, reasoningEffort: 'low'};
}

/**
 * 从模型输出解析标题：优先读取 JSON 的 title 字段，失败时把全文当作纯文本标题。
 * 规范化只做可判定的清洗，无法得到非空结果时返回 null。
 */
function parseSessionTitle(text: string): string | null {
  const source = String(text || '').trim();

  if (source === '') {
    return null;
  }

  // 先按完整输出解析，再只取首个对象：多段 JSON 或带解释文字时不会因贪婪匹配整体失败。
  for (const candidate of [source, source.match(/\{[\s\S]*?\}/)?.[0]]) {
    if (!candidate || !candidate.startsWith('{')) {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(candidate);
      const title = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).title
        : undefined;

      if (typeof title === 'string') {
        return normalizeSessionTitle(title);
      }
    } catch {
      // 非法 JSON 时继续尝试下一个候选，最终回退到纯文本解析。
    }
  }

  return normalizeSessionTitle(source);
}

/**
 * 去除包裹引号、压缩空白、去掉结尾标点，并按 code point 截断，避免切开代理对。
 */
function normalizeSessionTitle(raw: string): string | null {
  const normalized = raw
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.?!。？！]+$/g, '')
    .trim();

  if (normalized === '') {
    return null;
  }

  // 按 grapheme 截断，避免拆开 ZWJ 组合或代理对。
  const characters = splitGraphemes(normalized);

  return characters.length > SESSION_TITLE_MAX_CHARS
    ? characters.slice(0, SESSION_TITLE_MAX_CHARS).join('')
    : normalized;
}

/**
 * 创建独立 deadline 信号，并用 Promise.race 约束忽略 signal 的 adapter。
 */
function createTitleDeadline(timeoutMs: number): TitleDeadline {
  const controller = new AbortController();
  let rejectTimeout: ((error: Error) => void) | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    controller.abort();
    rejectTimeout?.(new AgentAbortError('session title generation timed out'));
  }, timeoutMs);

  return {
    dispose() {
      clearTimeout(timer);
    },
    run<Value>(operation: Promise<Value>): Promise<Value> {
      return Promise.race([operation, timeoutPromise]);
    },
    signal: controller.signal
  };
}

export {
  createSessionTitleGenerator,
  normalizeSessionTitle,
  parseSessionTitle,
  SESSION_TITLE_MAX_CHARS
};

export type {SessionTitleGenerator, SessionTitleGeneratorDependencies, SessionTitleGeneratorInput};
