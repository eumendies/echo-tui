export type ConfirmedFileMention = {
  start: number; // 已确认显示文本的 grapheme 起始位置，包含 @。
  end: number; // 已确认显示文本的 grapheme 结束位置，不含分隔空格。
  path: string; // 用户确认时选择的实际路径，不从显示文本重新解析。
};

export type ComposerSnapshot = {
  text: string; // 捕获时的原始草稿文本，不含渲染控制序列。
  cursor: number; // 捕获时位于 grapheme 边界的光标位置。
  fileMentions: ConfirmedFileMention[]; // 与 live 草稿独立的已确认引用副本。
};

export type ComposerState = {
  chars: string[]; // 按 grapheme 切分的草稿编辑单元。
  cursor: number; // 当前光标所在的 grapheme 边界。
  fileMentions: ConfirmedFileMention[]; // 有序且不重叠的已确认文件引用。
};
