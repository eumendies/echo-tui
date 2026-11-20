// 字符→token 启发式系数：CJK 字符约 1.5 字符/token，其余约 4 字符/token。
const CJK_CHARS_PER_TOKEN = 1.5;
const OTHER_CHARS_PER_TOKEN = 4;

function isCjkOrFullWidth(codePoint: number): boolean {
  return (codePoint >= 0x3000 && codePoint <= 0x9fff) || (codePoint >= 0xff00 && codePoint <= 0xffef);
}

/**
 * 估算单段文本的浮点 token 数，不做取整。
 * 供跨多个分片累加的统计使用：逐片 ceil 会让每个小分片至少记 1 token，
 * 单字符流（fake agent、按字符切分的 provider 分片）会被系统性高估数倍。
 */
function estimateTextTokensFloat(text: string): number {
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

  return cjk / CJK_CHARS_PER_TOKEN + other / OTHER_CHARS_PER_TOKEN;
}

/**
 * 估算单段文本的 token 数：区分 CJK 与其它字符各自的字符/token 系数，向上取整。
 */
function estimateTextTokens(text: string): number {
  return Math.ceil(estimateTextTokensFloat(text));
}

/**
 * 把结构化 provider payload 以稳定 JSON 文本估算 token，避免调用方各自拼接对象字段。
 */
function estimateJsonTokens(value: unknown): number {
  return estimateTextTokens(JSON.stringify(value));
}

export {
  estimateJsonTokens,
  estimateTextTokensFloat,
  estimateTextTokens
};
