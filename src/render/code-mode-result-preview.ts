/** 仅从外层响应生成有界 JSON 预览；中间工具正文不进入此投影，也不保留原始对象。 */
import {encodeCodeJson} from '../tools/code-mode/protocol';
import {TOOL_RESULT_MAX_DISPLAY_LINES} from './tool-message-renderers/shared';

const PREVIEW_MAX_CHARACTERS = 4096;
// 外层文本最多 128 Ki 个 UTF-16 单元；历史预览校验不放宽执行器的真实结果预算。
const PREVIEW_MAX_INPUT_BYTES = 512 * 1024;

export type CodeResultPreviewSection = {
  heading: string; // 标明实际外层字段，或日志为空、真实日志截断等辅助事实。
  text: string | null; // 已转义且限长的 JSON 展示文本；仅辅助标题时为空。
  truncated: boolean; // 仅表示本节展示文本被裁剪，不改变实际外层响应。
  tone: 'output' | 'error' | 'muted'; // 结果使用 Bash 输出弱化色，错误保持清晰，辅助说明单独处理。
};

/** 在格式化前限制旧记录的 JSON 复杂度；C1 也转义为 JSON 字面量，不删除返回数据。 */
function jsonSection(
  heading: string,
  value: unknown,
  tone: CodeResultPreviewSection['tone']
): CodeResultPreviewSection {
  encodeCodeJson(value, PREVIEW_MAX_INPUT_BYTES);
  const formatted = JSON.stringify(value, null, 2).replace(
    /[\u007f-\u009f]/gu,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
  const lines = formatted.split('\n');
  const visible = lines.slice(0, TOOL_RESULT_MAX_DISPLAY_LINES).join('\n');
  return {
    heading,
    text: visible.slice(0, PREVIEW_MAX_CHARACTERS).replace(/[\uD800-\uDBFF]$/u, ''),
    truncated:
      lines.length > TOOL_RESULT_MAX_DISPLAY_LINES || visible.length > PREVIEW_MAX_CHARACTERS,
    tone
  };
}

/** 只展示已存在的外层字段；缺字段的旧结果不伪造 null 或空日志。 */
export function createCodeResultPreview(
  value: Record<string, unknown>
): CodeResultPreviewSection[] {
  if (
    !Object.hasOwn(value, 'result') ||
    !Array.isArray(value.logs) ||
    typeof value.logs_truncated !== 'boolean' ||
    !Object.hasOwn(value, 'error')
  ) {
    return [];
  }
  const sections = [jsonSection('Result:', value.result, 'output')];
  if (value.logs.length > 0) {
    sections.push(jsonSection('Logs:', value.logs, 'output'));
  } else {
    sections.push({heading: 'Logs: (none)', text: null, truncated: false, tone: 'muted'});
  }
  if (value.logs_truncated) {
    sections.push({
      heading: 'Logs were truncated before returning to agent.',
      text: null,
      truncated: false,
      tone: 'muted'
    });
  }
  if (value.error !== null) {
    sections.push(jsonSection('Error:', value.error, 'error'));
  }
  return sections;
}
