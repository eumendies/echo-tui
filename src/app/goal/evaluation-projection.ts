import type {TranscriptRecord} from '../../types/transcript';

const GOAL_EVIDENCE_MAX_RECORDS = 60;
const GOAL_EVIDENCE_MAX_CHARACTERS = 12_000;
const GOAL_EVIDENCE_MAX_RECORD_CHARACTERS = 2_000;
const EVIDENCE_TRUNCATION_MARKER = '…[truncated]…';

/**
 * 从最近的有界窗口构造 goal 评估证据：按时间倒序收集可见角色，超出条数或字符预算即停止，
 * 再翻转回时间顺序。预算内至少保留一条最新证据；没有任何可用证据时为空字符串。
 */
function createGoalEvidenceProjection(records: TranscriptRecord[]): string {
  const parts: string[] = [];
  let characterCount = 0;

  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (parts.length >= GOAL_EVIDENCE_MAX_RECORDS) {
      break;
    }

    const entry = createEvidenceEntry(records[index]);

    if (!entry) {
      continue;
    }

    const nextCharacterCount = characterCount + entry.length + (parts.length > 0 ? 1 : 0);

    if (parts.length > 0 && nextCharacterCount > GOAL_EVIDENCE_MAX_CHARACTERS) {
      break;
    }

    parts.push(entry);
    characterCount = nextCharacterCount;
  }

  return parts.reverse().join('\n');
}

/** 把单条 transcript 记录投影为证据行；不可见角色或空文本返回 null。 */
function createEvidenceEntry(record: TranscriptRecord): string | null {
  const text = typeof record.text === 'string' ? record.text.trim() : '';

  if (text === '') {
    return null;
  }

  const bounded = boundEvidenceText(text);

  switch (record.role) {
    case 'user':
      return `[user] ${bounded}`;
    case 'assistant':
      return `[assistant] ${bounded}`;
    case 'tool_result':
      return `[tool_result:${record.toolName}] ${bounded}`;
    case 'local_notice':
      return `[local_notice] ${bounded}`;
    case 'error':
      return `[error] ${bounded}`;
    default:
      return null;
  }
}

/** 单条证据超限时保留头尾两部分，让测试输出等长文本的结论行仍然可见。 */
function boundEvidenceText(text: string): string {
  if (text.length <= GOAL_EVIDENCE_MAX_RECORD_CHARACTERS) {
    return text;
  }

  const half = Math.floor((GOAL_EVIDENCE_MAX_RECORD_CHARACTERS - EVIDENCE_TRUNCATION_MARKER.length) / 2);
  return `${text.slice(0, half)}${EVIDENCE_TRUNCATION_MARKER}${text.slice(-half)}`;
}

export {createGoalEvidenceProjection};

