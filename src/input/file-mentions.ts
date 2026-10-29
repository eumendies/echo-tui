/**
 * 将路径格式化为 composer 中的 @ mention；含空白时使用双引号包裹。
 */
export function formatFileMention(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');

  if (/\s/u.test(normalized)) {
    return `@"${normalized.replace(/(["\\])/gu, '\\$1')}"`;
  }

  return `@${normalized}`;
}
