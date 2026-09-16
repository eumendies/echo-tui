import {ZERO_WIDTH_RANGES, isInRanges} from '../render/width-data';

let sharedSegmenter: Intl.Segmenter | null = null;

/**
 * grapheme 切分快路径白名单。
 *
 * 这些区块内不存在把相邻码点并入同一 cluster 的规则（Grapheme_Extend、
 * SpacingMark、Prepend、Regional_Indicator 与 Hangul jamo 都不在其中），
 * 因此每个码点自身就是一个 grapheme cluster，可以跳过 Intl.Segmenter。
 * 白名单只服务性能判定，语义仍以 Intl.Segmenter 为准：未列入的脚本（Indic、
 * 东南亚文字、阿拉伯、emoji、Hangul jamo 区等）一律回退；区块内的窄例外
 * （如谚文浊点 U+3099、半角浊点 U+FF9E）再由零宽表守卫兜一层。
 */
const SIMPLE_TEXT_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x007f], // ASCII
  [0x00a0, 0x02ff], // Latin-1 补充与拉丁扩展
  [0x0370, 0x04ff], // 希腊字母与西里尔字母
  [0x2000, 0x2bff], // 常用标点、符号、箭头、框线与装饰符号
  [0x2e80, 0x2fff], // CJK 部首与表意文字描述符
  [0x3000, 0x303f], // CJK 标点
  [0x3040, 0x30ff], // 平假名与片假名
  [0x3130, 0x318f], // 兼容谚文
  [0x3400, 0x4dbf], // CJK 扩展 A
  [0x4e00, 0x9fff], // CJK 统一表意文字
  [0xac00, 0xd7a3], // 谚文音节
  [0xf900, 0xfaff], // CJK 兼容表意文字
  [0xfe10, 0xfe4f], // 竖排形式与 CJK 兼容形式
  [0xff00, 0xffef], // 全角与半角形式
  [0x20000, 0x3fffd] // CJK 扩展 B 及以后
];

/**
 * 按 grapheme cluster 切分文本，避免把复合 emoji 拆成多个显示单元。
 *
 * 该函数是 input 编辑层与 render 宽度层共用的切分口径：composer 编辑模型、
 * displayWidth 与消息块换行都必须以 grapheme 为基本单元，否则同一文本在不同
 * 路径下的宽度与光标位置会互相矛盾。
 */
export function splitGraphemes(text: string): string[] {
  // 会话文本以 ASCII 与 CJK 为主，这些码点自身即 cluster，无需进入 Segmenter。
  // Array.from 按字符串迭代器逐码点收集，与逐码点 push 语义一致，整段文本下更快。
  if (canSplitByCodePoint(text)) {
    return Array.from(text);
  }

  // Segmenter 实例无状态，模块级复用避免高频 footer 重绘重复构造。
  // engines 保证 Node >= 20.3，Intl.Segmenter 必然存在，无需回退分支。
  if (sharedSegmenter === null) {
    sharedSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  }
  return Array.from(sharedSegmenter.segment(text), (segment) => segment.segment);
}

/**
 * 判断文本能否直接按码点切分。
 *
 * 判据取保守方向：只要出现白名单外码点，或出现零宽/组合字符（可能把相邻码点
 * 并入同一 cluster），就回退 Segmenter。漏判只损失性能，不会改变切分结果。
 */
function canSplitByCodePoint(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);

    // ASCII 码点不参与 cluster 合并，只有 CR 会与其后的 LF 合成单个 cluster。
    if (code < 0x80) {
      if (code === 0x0d) {
        return false;
      }

      continue;
    }

    const codePoint = text.codePointAt(index) as number;

    if (!isInRanges(codePoint, SIMPLE_TEXT_RANGES) || isInRanges(codePoint, ZERO_WIDTH_RANGES)) {
      return false;
    }

    // 星号平面字符占两个 code unit，跳过低位代理继续扫描。
    if (codePoint > 0xffff) {
      index += 1;
    }
  }

  return true;
}
