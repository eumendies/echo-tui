import type {SandboxRuntimeContext} from '../sandbox/types';

/** 后台任务状态;stopping 只是终止进行中,不是终态。 */
type BackgroundTaskState = 'running' | 'stopping' | 'exited' | 'stopped' | 'failed';

/** 任务结束原因;自然退出不写原因,本地终止必须写明触发来源。 */
type BackgroundTaskStopReason =
  | 'user_stop' // 用户在 /tasks 中确认停止。
  | 'timeout' // 配置的硬超时从进程启动起计时到期。
  | 'output_limit' // 单任务日志达到 8 MiB 上限。
  | 'session_cleanup' // /clear、/resume 或 /fork 离开原会话。
  | 'app_exit' // 正常退出应用。
  | 'cleanup_timeout' // 有界清理超期,进程最终结果未知。
  | 'runtime_error'; // 日志或状态文件写入失败等运行时故障。

/** tool_result.details 中持久化的任务引用;三元身份用于跨实例去重与 undo 定位。 */
type BackgroundTaskReference = {
  taskId: string; // 当前应用实例内的稳定短 ID,形如 bash-3。
  sessionId: string; // 启动时所属 session;会话切换后旧任务不再属于新会话。
  ownerInstanceId: string; // 启动它的应用实例;短 ID 可能重复,必须与实例配对。
  outputPath: string; // output.log 绝对路径,启动结果返回时已可读。
  statusPath: string; // status.json 绝对路径,原子替换发布。
};

/** status.json 的版本化快照;读取方只会看到完整的一版。 */
type BackgroundTaskStatusSnapshot = {
  version: 1; // 快照结构版本;后续新增字段时递增。
  taskId: string; // 与引用的 taskId 一致。
  sessionId: string; // 拥有者 session;历史引用按它过滤。
  ownerInstanceId: string; // 拥有者应用实例。
  command: string; // 原始命令文本,不做 shell 展开。
  cwd: string; // 启动时固定的工作目录。
  state: BackgroundTaskState; // 当前状态。
  startedAt: string; // 进程启动的 ISO 时间戳。
  finishedAt: string | null; // 终态时间;未结束时为 null。
  exitCode: number | null; // 真实退出码;未知或被信号终止时为 null。
  signal: string | null; // 终止进程的信号名;自然退出为 null。
  reason: BackgroundTaskStopReason | null; // 结束原因;非终态为 null。
  outputPath: string; // 与引用一致的日志路径,便于模型只读一个文件就拿到位置。
  outputTruncated: boolean; // 是否因日志上限被截断;true 时日志不是完整输出。
};

/** /tasks 与渲染投影消费的任务视图;合并内存条目与仅有文件引用的历史条目。 */
type BackgroundTaskView = {
  reference: BackgroundTaskReference; // 稳定身份与文件位置。
  managed: boolean; // false 表示当前实例没有句柄,只能读文件且不能停止。
  state: BackgroundTaskState; // 受管任务取内存事实,历史任务取可读快照。
  command: string; // 命令摘要来源;未知时为空串。
  startedAt: string | null; // 已知启动时间。
  finishedAt: string | null; // 已知结束时间。
  exitCode: number | null; // 已知退出码。
  reason: BackgroundTaskStopReason | null; // 已知结束原因。
  elapsedMs: number | null; // 快照耗时;运行中取当前时间与启动时间之差。
  outputTruncated: boolean; // 日志是否已被上限截断。
  unreadable?: string; // 文件缺失或格式不合法时的中文原因,不伪装成进程状态。
};

/** 单次后台启动的输入;路径与项目分区由管理器生成,不接受调用方指定。 */
type BackgroundTaskStartOptions = {
  command: string; // 原始命令文本,由处理器校验过非空。
  cwd: string; // 启动时固定的工作目录,后续模式切换不改变。
  sessionId: string; // 拥有者 session;未持久化的新会话也必须有稳定值。
  sandbox?: SandboxRuntimeContext; // 启动时解析的沙箱上下文;缺省按无沙箱执行。
  shell: string; // 底层 shell 可执行文件路径。
  timeoutMs: number | null; // 硬执行期限,从进程启动起计算。
  abortSignal?: AbortSignal; // 交接前取消信号;交接后不再影响已注册任务。
};

/** 启动结果;失败时携带可回传模型的中文原因。 */
type BackgroundTaskStartResult =
  | {
      ok: true; // 文件已发布且进程已 spawn 成功。
      reference: BackgroundTaskReference; // 回填 tool_result.details 的引用。
      state: BackgroundTaskState; // 交接时刻的状态,快速命令可能已是终态。
    }
  | {ok: false; message: string}; // 未留下任何运行中进程。

/** 管理器对外能力;由 app 持有,只注入交互式主会话的运行。 */
type BackgroundTaskManager = {
  readonly ownerInstanceId: string; // 当前应用实例身份,用于区分同短 ID 的历史条目。
  start(options: BackgroundTaskStartOptions): Promise<BackgroundTaskStartResult>; // 启动并完成交接。
  listManaged(sessionId: string): BackgroundTaskView[]; // 当前实例持有的该会话任务。
  getManaged(taskId: string): BackgroundTaskView | null; // 按任务 ID 取受管条目。
  stop(taskId: string): Promise<boolean>; // 用户停止;句柄不存在或已结束时返回 false。
  hasActiveWriteTask(sessionId: string): boolean; // 是否存在尚未确认结束的可能写任务。
  stopSessionTasks(sessionId: string): Promise<void>; // 离开会话时清理该会话的运行任务。
  readTaskLog(taskId: string, maxBytes: number): string | null; // 读取受管任务的有界日志尾部。
  readReferenceLog(reference: BackgroundTaskReference, maxBytes: number): string | null; // 读取历史引用日志尾部。
  shutdown(): Promise<void>; // 退出前有界清理全部运行任务。
};

export type {
  BackgroundTaskManager,
  BackgroundTaskReference,
  BackgroundTaskStartOptions,
  BackgroundTaskStartResult,
  BackgroundTaskState,
  BackgroundTaskStatusSnapshot,
  BackgroundTaskStopReason,
  BackgroundTaskView
};
