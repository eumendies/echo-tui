// 字符→token 启发式系数：CJK 字符约 1.5 字符/token，其余约 4 字符/token。
const CJK_CHARS_PER_TOKEN = 1.5;
const OTHER_CHARS_PER_TOKEN = 4;

function isCjkOrFullWidth(codePoint: number): boolean {
  return (codePoint >= 0x3000 && codePoint <= 0x9fff) || (codePoint >= 0xff00 && codePoint <= 0xffef);
}

/**
 * 估算单段文本的 token 数：区分 CJK 与其它字符各自的字符/token 系数。
 */
function estimateTextTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  const value = String(text);

  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index) || 0;

    if (isCjkOrFullWidth(codePoint)) {
      cjk += 1;
    } else {
      other += 1;
    }

    index += codePoint > 0xffff ? 2 : 1;
  }

  return Math.ceil(cjk / CJK_CHARS_PER_TOKEN + other / OTHER_CHARS_PER_TOKEN);
}

/**
 * 把结构化 provider payload 以稳定 JSON 文本估算 token，避免调用方各自拼接对象字段。
 */
function estimateJsonTokens(value: unknown): number {
  return estimateTextTokens(JSON.stringify(value));
}

export {
  estimateJsonTokens,
  estimateTextTokens
};
