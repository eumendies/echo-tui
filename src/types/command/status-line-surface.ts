import type {StatusLineSegment} from '../../config/app-settings-config';

export type StatusLineConfigRowId = StatusLineSegment | 'save';

/**
 * 状态栏显示项子面板的焦点与反馈状态。
 * 开关真值只存在于常规 Tab 草稿，本状态不复制它，避免出现第二份真值。
 */
export type StatusLineConfigState = {
  error?: string; // 最近一次保存失败的原因；下一次操作清除。
  feedback?: string; // 最近一次保存成功的提示。
  selectedIndex: number; // 当前焦点行在开关行投影中的索引；0 为首个 segment。
};
