import path from 'node:path';

/**
 * 共享只读 bash 命令判定：对外暴露 plan mode 与 undo 失效保护两个具体判定函数，
 * 两者共享单命令只读判定核心 isReadonlySingleArgv，仅通过各自阈值配置区分。
 * plan mode 只放行明确的只读检查命令与纯只读组合命令，任何未知命令一律拒绝；
 * undo 失效保护额外放行内置 agent-memory 脚本，find 拦截集合更窄，
 * 且不拆解组合命令，保持既有"不可追踪变更 → undo 失效"语义。
 */

// 两档共用的只读文件检查命令；需要参数级约束的 rg/printf 在判定函数中单独处理。
const READONLY_FILE_COMMANDS = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'echo']);
// 宽松模式（undo 失效保护）拦截的 find 写选项。
const CHANGE_HISTORY_BLOCKED_FIND_OPTIONS = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir']);
// 严格模式额外拦截 GNU find 的写文件选项，避免 plan mode 漏网写操作。
const PLAN_BLOCKED_FIND_OPTIONS = new Set([...CHANGE_HISTORY_BLOCKED_FIND_OPTIONS, '-fprint', '-fprint0', '-fprintf', '-fls']);
// 两档共用的 git 只读子命令；带写形态的 grep/ls-remote/fsck 及 branch/tag/stash/config/remote 在判定函数中单独处理。
const GIT_READONLY_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'merge-base', 'blame', 'describe', 'rev-list', 'for-each-ref', 'ls-tree', 'count-objects', 'name-rev', 'shortlog']);
const BLOCKED_GIT_OPTIONS = new Set(['--output', '--ext-diff', '--external-diff']);
// git branch 只读选项集合；禁止位置参数（`git branch foo` 是创建分支）。
const GIT_BRANCH_READONLY_OPTIONS = new Set(['-a', '-r', '-l', '--list', '-v', '-vv', '--all', '--remotes', '--verbose', '--no-color', '--merged', '--no-merged', '--sort', '--show-current']);
// git tag 只读选项集合；禁止位置参数（`git tag v1` 创建标签）。
const GIT_TAG_READONLY_OPTIONS = new Set(['-l', '--list', '--sort', '-n']);
// git config 读取类无参选项。
const GIT_CONFIG_READONLY_FLAG_OPTIONS = new Set(['--get', '--get-all', '--get-regexp', '--list', '-l', '--show-origin', '--show-scope', '-z', '--null', '--local', '--global', '--system', '--worktree']);
// git config 带值选项；`--xxx=value` 形式或消费下一个 token 作为选项值。
const GIT_CONFIG_VALUE_OPTIONS = new Set(['--type', '--file']);
const BUILTIN_AGENT_MEMORY_SCRIPT_PATH = path.resolve(__dirname, '../skills/builtin/agent-memory/scripts/memory.js');

type ReadonlySingleCommandOptions = {
  findBlockedOptions: ReadonlySet<string>; // 当前策略必须拦截的 find 写入型选项。
  pwdStrict: boolean; // 是否要求 pwd 不携带任何参数。
};
// plan mode 单命令判定阈值：find 拦截全部写选项、pwd 仅无参放行。
const PLAN_SINGLE_COMMAND_OPTIONS: ReadonlySingleCommandOptions = {findBlockedOptions: PLAN_BLOCKED_FIND_OPTIONS, pwdStrict: true};
// undo 失效保护单命令判定阈值：find 沿用既有拦截集合、pwd 任意参数。
const CHANGE_HISTORY_SINGLE_COMMAND_OPTIONS: ReadonlySingleCommandOptions = {findBlockedOptions: CHANGE_HISTORY_BLOCKED_FIND_OPTIONS, pwdStrict: false};

/**
 * plan mode 严格只读判定：先按顶层元字符拆分组合命令，再逐段递归判定，
 * 任一段不满足只读条件即整体拒绝。
 */
function isPlanReadonlyBashCommand(command: string): boolean {
  const segments = splitCommandSegments(command);

  if (!segments) {
    return false;
  }

  return segments.length > 0 && segments.every((segment) => {
    const trimmed = segment.trim();

    if (trimmed === '') {
      return true;
    }

    const argv = parseSingleCommand(trimmed);
    return argv !== null && isReadonlySingleArgv(argv, PLAN_SINGLE_COMMAND_OPTIONS);
  });
}

/**
 * undo 失效保护判定：命令可能修改工作区文件时返回 false，使 change history 失效。
 * 与 plan 档相同地拆解组合命令，逐段按宽松阈值判定；memory 脚本整条优先判定，
 * 因为其专用 tokenizer 支持引号拼接（如 `'a'\''b'`），拆段器不支持，必须先于拆段检查。
 */
function isChangeHistoryReadonlyBashCommand(command: string): boolean {
  if (isBuiltinAgentMemoryScriptCommand(command)) {
    return true;
  }

  const segments = splitCommandSegments(command);

  if (!segments) {
    return false;
  }

  return segments.length > 0 && segments.every((segment) => {
    const trimmed = segment.trim();

    if (trimmed === '') {
      return true;
    }

    const argv = parseSingleCommand(trimmed);
    return argv !== null && isReadonlySingleArgv(argv, CHANGE_HISTORY_SINGLE_COMMAND_OPTIONS);
  });
}

/**
 * 单条命令的只读判定。pwdStrict=true 时 pwd 仅无参放行；
 * find 的拦截集合按严格/宽松模式分别传入。
 */
function isReadonlySingleArgv(argv: string[], options: ReadonlySingleCommandOptions): boolean {
  const head = argv[0];

  if (head === 'pwd') {
    return !options.pwdStrict || argv.length === 1;
  }

  if (READONLY_FILE_COMMANDS.has(head)) {
    return true;
  }

  if (head === 'rg') {
    return !argv.slice(1).some(isBlockedRipgrepOption);
  }

  if (head === 'printf') {
    return argv[1] !== '-v' && !argv[1]?.startsWith('-v');
  }

  if (head === 'find') {
    return !argv.slice(1).some((arg) => options.findBlockedOptions.has(arg));
  }

  if (head === 'git') {
    return isReadonlyGitCommand(argv);
  }

  return false;
}

/**
 * git 只读子命令判定：统一扫描写类选项后，按子命令形态分派。
 */
function isReadonlyGitCommand(argv: string[]): boolean {
  if (argv.length < 2) {
    return false;
  }

  // 统一拦截会改写工作区或调用外部程序的 git 选项，避免子命令分支遗漏。
  if (argv.slice(2).some(isBlockedGitOption)) {
    return false;
  }

  const subcommand = argv[1];

  if (subcommand === 'branch') {
    return isGitOptionOnly(argv.slice(2), GIT_BRANCH_READONLY_OPTIONS);
  }

  if (subcommand === 'tag') {
    return isGitOptionOnly(argv.slice(2), GIT_TAG_READONLY_OPTIONS);
  }

  if (subcommand === 'stash') {
    return argv.length >= 3 && (argv[2] === 'list' || argv[2] === 'show');
  }

  if (subcommand === 'config') {
    return isGitConfigReadonly(argv.slice(2));
  }

  if (subcommand === 'remote') {
    return isGitRemoteReadonly(argv);
  }

  if (subcommand === 'grep') {
    return !argv.slice(2).some(isBlockedGitGrepOption);
  }

  if (subcommand === 'ls-remote') {
    return !argv.slice(2).some(isBlockedGitLsRemoteOption);
  }

  if (subcommand === 'fsck') {
    return !argv.slice(2).some((arg) => arg === '--lost-found');
  }

  return GIT_READONLY_SUBCOMMANDS.has(subcommand);
}

/**
 * 参数必须全部命中只读选项集合（支持 `--opt=value` 形式），且不允许位置参数。
 */
function isGitOptionOnly(args: string[], readonlyOptions: ReadonlySet<string>): boolean {
  return args.every((arg) => {
    if (readonlyOptions.has(arg)) {
      return true;
    }

    const equalsIndex = arg.indexOf('=');
    return equalsIndex > 0 && readonlyOptions.has(arg.slice(0, equalsIndex));
  });
}

/**
 * git config 只读形态：仅读取类选项（可消费选项值），位置参数至多 1 个；
 * 2 个位置参数即 key+value 赋值，未知选项一律拒绝。
 */
function isGitConfigReadonly(args: string[]): boolean {
  let positionals = 0;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (GIT_CONFIG_READONLY_FLAG_OPTIONS.has(arg)) {
      continue;
    }

    if (GIT_CONFIG_VALUE_OPTIONS.has(arg) || [...GIT_CONFIG_VALUE_OPTIONS].some((option) => arg.startsWith(`${option}=`))) {
      if (!arg.includes('=')) {
        index += 1;

        if (index >= args.length) {
          return false;
        }
      }

      continue;
    }

    if (arg.startsWith('-')) {
      return false;
    }

    positionals += 1;
  }

  return positionals <= 1;
}

/**
 * git remote 只读形态：无参、-v/--verbose、show <name>、get-url <name>。
 */
function isGitRemoteReadonly(argv: string[]): boolean {
  if (argv.length === 2) {
    return true;
  }

  if (argv.length === 3 && (argv[2] === '-v' || argv[2] === '--verbose')) {
    return true;
  }

  return argv.length === 4 && (argv[2] === 'show' || argv[2] === 'get-url');
}

function isBlockedGitOption(arg: string): boolean {
  return BLOCKED_GIT_OPTIONS.has(arg) || arg.startsWith('--output=');
}

function isBlockedRipgrepOption(arg: string): boolean {
  return arg === '--pre'
    || arg.startsWith('--pre=')
    || arg === '--hostname-bin'
    || arg.startsWith('--hostname-bin=');
}

function isBlockedGitGrepOption(arg: string): boolean {
  return arg === '--open-files-in-pager'
    || arg.startsWith('--open-files-in-pager=')
    || arg === '-O'
    || arg.startsWith('-O');
}

function isBlockedGitLsRemoteOption(arg: string): boolean {
  return arg === '--upload-pack'
    || arg.startsWith('--upload-pack=')
    || arg === '--exec'
    || arg.startsWith('--exec=');
}

/**
 * 引号感知的顶层命令拆分：按 `|`、`&&`、`;`、`||`、换行切段，引号内元字符不拆分。
 * 顶层出现写类元字符（重定向、命令替换、反引号、变量展开、单个 `&` 后台符、子 shell）
 * 时返回 null，表示整条命令拒绝。
 */
function splitCommandSegments(command: string): string[] | null {
  const segments: string[] = [];
  let segment = '';
  let quote: 'single' | 'double' | null = null;
  const flushSegment = () => {
    segments.push(segment);
    segment = '';
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote === 'single') {
      segment += char;

      if (char === "'") {
        quote = null;
      }

      continue;
    }

    if (quote === 'double') {
      segment += char;

      if (char === '\\') {
        const next = command[index + 1];

        if (next === undefined) {
          return null;
        }

        if ('$`"\\\r\n'.includes(next)) {
          segment += next;
          index += 1;
        }
      } else if (char === '"') {
        quote = null;
      } else if (char === '$' || char === '`') {
        return null;
      }

      continue;
    }

    if (char === '\\') {
      const next = command[index + 1];

      if (next === undefined) {
        return null;
      }

      segment += char + next;
      index += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char === "'" ? 'single' : 'double';
      segment += char;
      continue;
    }

    if (char === '\r' || char === '\n') {
      flushSegment();
      continue;
    }

    if (char === '|') {
      flushSegment();

      if (command[index + 1] === '|') {
        index += 1;
      }

      continue;
    }

    if (char === '&') {
      if (command[index + 1] !== '&') {
        return null;
      }

      flushSegment();
      index += 1;
      continue;
    }

    if (char === ';') {
      flushSegment();
      continue;
    }

    if (char === '>' || char === '<' || char === '`' || char === '$' || char === '(' || char === ')') {
      return null;
    }

    segment += char;
  }

  if (quote) {
    return null;
  }

  flushSegment();
  return segments;
}

/**
 * 只识别当前安装包内的固定 memory 脚本；拒绝 shell 组合与命令替换，避免任意 Node 命令绕过 workspace history 失效保护。
 */
function isBuiltinAgentMemoryScriptCommand(command: string): boolean {
  const argv = parseTrustedScriptCommand(command);
  if (!argv || argv.length < 2) return false;
  const executable = argv[0] === 'node' || path.resolve(argv[0]) === path.resolve(process.execPath);
  return executable && path.resolve(argv[1]) === BUILTIN_AGENT_MEMORY_SCRIPT_PATH;
}

function parseTrustedScriptCommand(command: string): string[] | null {
  const argv: string[] = [];
  let token = '';
  let quote: 'single' | 'double' | null = null;
  let tokenStarted = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote === 'single') {
      if (char === "'") quote = null;
      else token += char;
      tokenStarted = true;
      continue;
    }

    if (char === '\\') {
      const next = command[index + 1];
      if (next === undefined || (quote === 'double' && (next === '$' || next === '`'))) return null;
      token += next;
      tokenStarted = true;
      index += 1;
      continue;
    }

    if (quote === 'double') {
      if (char === '"') quote = null;
      else {
        if (char === '$' || char === '`') return null;
        token += char;
      }
      tokenStarted = true;
      continue;
    }

    if (char === "'") {
      quote = 'single';
      tokenStarted = true;
      continue;
    }

    if (char === '"') {
      quote = 'double';
      tokenStarted = true;
      continue;
    }

    if (/\s/u.test(char)) {
      if (char === '\r' || char === '\n') return null;
      if (tokenStarted) {
        argv.push(token);
        token = '';
        tokenStarted = false;
      }
      continue;
    }

    if (';&|<>`$()'.includes(char)) return null;
    token += char;
    tokenStarted = true;
  }

  if (quote) return null;
  if (tokenStarted) argv.push(token);
  return argv.length > 0 ? argv : null;
}

function parseSingleCommand(command: string): string[] | null {
  const trimmed = command.trim();

  if (trimmed === '') {
    return null;
  }

  const argv: string[] = [];
  let token = '';
  let quote: 'single' | 'double' | null = null;
  let tokenStarted = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if (quote === 'single') {
      if (char === "'") {
        quote = null;
      } else {
        token += char;
      }
      tokenStarted = true;
      continue;
    }

    if (quote === 'double') {
      if (char === '"') {
        quote = null;
      } else if (char === '\\') {
        const next = trimmed[index + 1];

        if (next === undefined) {
          return null;
        }

        if ('$`"\\'.includes(next)) {
          token += next;
          index += 1;
        } else if (next === '\r' || next === '\n') {
          index += 1;
        } else {
          token += char;
        }
      } else if (char === '$' || char === '`') {
        // 双引号内命令替换/变量展开按命令替换处理，避免 `git status "$(rm x)"` 绕过拦截。
        return null;
      } else {
        token += char;
      }
      tokenStarted = true;
      continue;
    }

    if (char === '\\') {
      const next = trimmed[index + 1];

      if (next === undefined) {
        return null;
      }

      if (next !== '\r' && next !== '\n') {
        token += next;
        tokenStarted = true;
      }

      index += 1;
      continue;
    }

    if (char === "'") {
      quote = 'single';
      tokenStarted = true;
      continue;
    }

    if (char === '"') {
      quote = 'double';
      tokenStarted = true;
      continue;
    }

    if (/\s/u.test(char)) {
      if (tokenStarted) {
        argv.push(token);
        token = '';
        tokenStarted = false;
      }
      continue;
    }

    // 引号外出现 shell 元字符说明命令含重定向、管道、连接或替换，直接拒绝。
    if (';&|<>`$()'.includes(char)) {
      return null;
    }

    token += char;
    tokenStarted = true;
  }

  if (quote) {
    return null;
  }

  if (tokenStarted) {
    argv.push(token);
  }

  return argv.length > 0 ? argv : null;
}

export {
  isChangeHistoryReadonlyBashCommand,
  isPlanReadonlyBashCommand,
};
