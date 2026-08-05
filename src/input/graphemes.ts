let sharedSegmenter: Intl.Segmenter | null = null;

/**
 * 按 grapheme cluster 切分文本，避免把复合 emoji 拆成多个显示单元。
 *
 * 该函数是 input 编辑层与 render 宽度层共用的切分口径：composer 编辑模型、
 * displayWidth 与消息块换行都必须以 grapheme 为基本单元，否则同一文本在不同
 * 路径下的宽度与光标位置会互相矛盾。
 */
export function splitGraphemes(text: string): string[] {
  // Segmenter 实例无状态，模块级复用避免高频 footer 重绘重复构造。
  // engines 保证 Node >= 20.3，Intl.Segmenter 必然存在，无需回退分支。
  if (sharedSegmenter === null) {
    sharedSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  }
  return Array.from(sharedSegmenter.segment(text), (segment) => segment.segment);
}
