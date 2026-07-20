import {AgentAbortError} from '../../types/agent';
import type {AgentCallbacks, AgentSessionInput, AgentTurnCallbacks, AgentTurnOptions, AgentTurnResult, ProviderAgent, RunAgent} from '../../types/agent';
import type {TranscriptRecord} from '../../types/transcript';

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AgentAbortError());
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new AgentAbortError());
    };

    timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

const FAKE_AGENT_THINKING_MS = 2000;
const FAKE_AGENT_TOKEN_DELAY_MS = 35;

async function streamFakeDraft(records: TranscriptRecord[], callbacks: AgentTurnCallbacks = {}, options: AgentTurnOptions = {}): Promise<string> {
  const input = findLatestUserText(records);
  let draft = '';

  await delay(FAKE_AGENT_THINKING_MS, options.abortSignal);

  for (const char of Array.from(input)) {
    // 按字符 streaming，中文字符也会作为一个 token-like 单元输出。
    await delay(FAKE_AGENT_TOKEN_DELAY_MS, options.abortSignal);
    draft += char;
    callbacks.onToken?.(char, draft);
  }

  return draft;
}

const runFakeAgent: RunAgent = async (
  session: AgentSessionInput,
  callbacks: AgentCallbacks = {}
): Promise<string> => {
  // fake agent 只模拟生命周期；真实模型接入时可以替换这一层。
  callbacks.onThinking?.();

  const draft = await streamFakeDraft(session.records, callbacks, {abortSignal: session.abortSignal});

  callbacks.onComplete?.(draft);

  return draft;
};

function createFakeAgent(): ProviderAgent {
  return {
    /**
     * 执行一次 fake provider turn：回放最新用户输入并且永不产生 tool call。
     */
    async runTurn(records: TranscriptRecord[], callbacks: AgentTurnCallbacks = {}, options: AgentTurnOptions = {}): Promise<AgentTurnResult> {
      return {
        draft: await streamFakeDraft(records, callbacks, options),
        toolCalls: []
      };
    }
  };
}

function findLatestUserText(records: TranscriptRecord[]): string {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];

    if (record.role === 'user') {
      return record.text;
    }
  }

  return '';
}

export {
  createFakeAgent,
  runFakeAgent
};
