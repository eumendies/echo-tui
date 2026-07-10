import crypto from 'node:crypto';

import type {LlmConfig} from '../types/agent';
import type {ToolDefinition} from '../types/tool';
import type {TranscriptRecord} from '../types/transcript';

/**
 * 生成 provider 路由用的 prompt cache key；只使用稳定前缀材料，避免用户消息变化打散缓存。
 */
function createPromptCacheKey(records: TranscriptRecord[], config: Pick<LlmConfig, 'model'>, toolDefinitions: ToolDefinition[] = []): string {
  const systemPrompt = records.find((record) => record.role === 'system')?.text || '';
  // system prompt里面包含cwd、AGENTS.md等动态内容，各用户互不相同，所以相当于按照用户进行路由分组
  const payload = stableStringify({
    model: config.model,
    systemPrompt,
    tools: toolDefinitions
  });
  const hash = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);

  return `echo-tui-${hash}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForStableStringify);
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortForStableStringify((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}

export {createPromptCacheKey};
