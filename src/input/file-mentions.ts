type FileMention = {
  end: number;
  path: string;
  quoted: boolean;
  start: number;
};

/**
 * 将路径格式化为 composer 中的 @ mention；含空白时使用双引号包裹。
 */
function formatFileMention(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');

  if (/\s/u.test(normalized)) {
    return `@"${normalized.replace(/(["\\])/gu, '\\$1')}"`;
  }

  return `@${normalized}`;
}

/**
 * 从 composer 文本中解析文件 mention，返回普通字符串下标范围。
 */
function parseFileMentions(text: string): FileMention[] {
  const chars = Array.from(text);
  const mentions: FileMention[] = [];
  let index = 0;

  while (index < chars.length) {
    if (chars[index] !== '@') {
      index += 1;
      continue;
    }

    const parsed = parseMentionAt(chars, index);

    if (!parsed) {
      index += 1;
      continue;
    }

    mentions.push(parsed);
    index = parsed.end;
  }

  return mentions;
}

function parseMentionAt(chars: string[], start: number): FileMention | null {
  const next = chars[start + 1];

  if (!next) {
    return null;
  }

  if (next === '"') {
    return parseQuotedMention(chars, start);
  }

  if (/\s/u.test(next)) {
    return null;
  }

  let end = start + 1;

  while (end < chars.length && !/\s/u.test(chars[end])) {
    end += 1;
  }

  const filePath = chars.slice(start + 1, end).join('');
  return filePath === '' ? null : {start, end, path: filePath, quoted: false};
}

function parseQuotedMention(chars: string[], start: number): FileMention | null {
  let end = start + 2;
  let value = '';

  while (end < chars.length) {
    const char = chars[end];

    if (char === '"') {
      return value === '' ? null : {start, end: end + 1, path: value, quoted: true};
    }

    if (char === '\\' && end + 1 < chars.length) {
      value += chars[end + 1];
      end += 2;
      continue;
    }

    value += char;
    end += 1;
  }

  return null;
}

export {
  formatFileMention,
  parseFileMentions
};

export type {FileMention};
