/**
 * 终端展示文本的控制字符净化。
 *
 * 工具参数、模型输出等外部文本可能混入控制字符:CR 会把光标拉回列首并覆盖已写内容,
 * ESC 可向终端注入 ANSI 序列。这里统一归一:CRLF 归一为 LF,孤立 CR 删除,
 * 其余 C0/C1 控制符与 DEL 一并删除;保留 LF(换行)与 TAB(宽度层有制表位语义)。
 * 只能用于样式化之前的原始文本;已含 ANSI 序列的渲染产物不能再过此函数,否则颜色会被剥掉。
 */

const CRLF_PATTERN = /\r\n/g;
const CR_PATTERN = /\r/g;
// C0(除已保留的 LF/TAB)、DEL 与 C1 控制符在终端布局中都没有合法展示语义。
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
// 单字符判定必须有独立非全局副本:全局正则的 lastIndex 会在 test() 之间残留。
const SINGLE_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

/**
 * 判断单个字符是否是 CR/LF 之外、终端投影需要删除的控制字符。
 * 供增量净化按字符推进使用,判定口径与 sanitizeTerminalText 完全一致。
 */
export function isTerminalControlChar(char: string): boolean {
  return SINGLE_CONTROL_PATTERN.test(char);
}

/**
 * 归一文本中的控制字符,返回可直接进入宽度计算与逐行布局的安全文本。
 */
export function sanitizeTerminalText(text: string): string {
  return text.replace(CRLF_PATTERN, '\n').replace(CR_PATTERN, '').replace(CONTROL_PATTERN, '');
}
