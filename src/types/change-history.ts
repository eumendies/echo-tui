import type {CompactionState} from './transcript';

export type ChangeCheckpointStatus = 'recording' | 'ready' | 'used' | 'invalid';

export type ChangeFileSnapshot = {
  exists: boolean; // 编辑前目标是否存在；不存在时 undo 删除工具创建的文件。
  content?: string; // 编辑前的 UTF-8 文本，恢复时原样写入。
  contentBase64?: string; // 非 UTF-8 文件的原始字节，避免恢复时发生有损转码。
  mode?: number; // 编辑前普通文件的权限位。
  linkTarget?: string; // 原路径为符号链接时的真实目标，用于检测换链。
};

export type ChangeFileEntryState = 'pending' | 'created' | 'updated';

export type ChangeFileEntry = {
  path: string; // 受控编辑目标的绝对路径。
  snapshot: ChangeFileSnapshot; // 本轮首次受控编辑前的恢复基线。
  state: ChangeFileEntryState; // 仅成功写盘的 created/updated 条目参与恢复。
  afterFingerprint?: string; // 最后一次受控写盘后的指纹；旧记录可能缺失。
  beforeFingerprint?: string; // 首次受控编辑前的原始字节、权限及链接目标指纹。
};

export type ChangeCheckpoint = {
  id: string; // 轮次恢复身份，用于异步清理后的目标核验。
  createdAt: string; // 本轮开始记录快照的时间。
  cwd: string; // 创建本轮时的工作目录。
  transcriptStartIndex: number; // 本轮 user record 之前的完整历史边界。
  compactionBefore?: CompactionState; // 回退本轮时需要恢复的压缩状态。
  files: ChangeFileEntry[]; // 本轮受控编辑的文件快照。
  status: ChangeCheckpointStatus; // 记录、可恢复、已使用，或因快照失败/活动写任务而失效。
  invalidReason?: string; // 真正失效的原因；普通未知 bash 不设置此字段。
  untrackedReason?: string; // 仅记录本轮实际执行的未追踪操作，不向新轮继承。
  untrackedEffects?: 'notice' | 'retained'; // 已撤销操作的遗留风险；notice 提醒下一次确认，retained 仅保护旧记录。
};

export type UndoReadySummary = {
  status: 'ready'; // 栈顶允许用户确认恢复。
  checkpointId: string; // 当前确认面板对应的恢复目标。
  fileCount: number; // 成功受控写盘的文件总数。
  restoreFileCount: number; // 需要恢复原内容的已有文件数量。
  deleteFileCount: number; // 需要删除的本轮新增文件数量。
  untrackedReason?: string; // 有限恢复需要展示的未追踪范围。
  undoneUntrackedNotice?: string; // 上次有限恢复遗留影响的一次性说明，不改变本轮恢复范围。
  uncheckedFileCount?: number; // 旧记录中缺少结束指纹的文件数量。
};

export type UndoUnavailableSummary =
  | {status: 'none'}
  | {status: 'invalid'; reason: string};

export type UndoSummary = UndoReadySummary | UndoUnavailableSummary;

export type UndoExecuteResult =
  | {ok: true; checkpoint: ChangeCheckpoint}
  | {ok: false; reason: 'none' | 'invalid' | 'conflict' | 'restore_failed'; message: string};

/**
 * change history 栈的一次改动；写入侧据此生成增量 journal 操作，避免每轮重写整份栈。
 */
export type ChangeHistoryDelta =
  | {
    kind: 'push'; // 一轮 loop 结束时新增一个 ready checkpoint。
    checkpoint: ChangeCheckpoint; // 本轮新增的栈顶 checkpoint，创建后不再被改动。
  }
  | {
    kind: 'pop'; // /undo 成功回退一个栈顶 checkpoint。
  }
  | {
    kind: 'reset'; // 失效边界：栈被整份替换，只用于自包含语义必需的场合。
    history: ChangeCheckpoint[]; // 替换后的完整栈，通常只含单个 invalid checkpoint。
  };

export type ChangeFileRecorder = {
  captureFileBefore(filePath: string): void; // 受控写盘前记录恢复基线。
  captureFileAfter(filePath: string): void; // 成功写盘后更新状态和冲突指纹。
  invalidate(reason: string): void; // 快照失败等情况中止本轮恢复。
  markUntracked(reason: string): void; // 标记范围外操作，同时继续受控编辑记录。
};
