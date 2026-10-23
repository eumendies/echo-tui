const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');

// 验收值独立写定，不从模型输出、脚本或工具返回值反推答案。
const TASKS = [
  {
    id: 'simple-query',
    prompt: 'Find literal needle in notes.txt. Return {line,column}, with 1-based UTF-8 byte column.',
    expected: {
      line: 1,
      column: 12
    }
  },
  {
    id: 'cross-file-filter',
    prompt:
      'Read services.json and its referenced records. Return {ids: sorted IDs of enabled services with errors >= 2}.',
    expected: {
      ids: ['auth', 'search']
    }
  },
  {
    id: 'dependent-branch',
    prompt: 'Read route.json, then ONLY the file named by active. Return {region,port} from that file.',
    expected: {
      region: 'west',
      port: 8443
    }
  },
  {
    id: 'aggregation',
    prompt: 'Sum amount by team in ledger.json. Return {totals: object keyed by team}.',
    expected: {
      totals: {
        core: 23,
        edge: 7
      }
    }
  },
  {
    id: 'no-match',
    prompt: 'Glob absent/**/*.txt. Return {paths,incomplete}; do not treat successful empty results as a failure.',
    expected: {
      paths: [],
      incomplete: false
    }
  },
  {
    id: 'partial-failure',
    prompt:
      'Read empty.txt, missing.txt and services.json in one batch. Preserve successes despite the missing file. Return {emptyLines,serviceCount,missing: sorted missing paths}.',
    expected: {
      emptyLines: 0,
      serviceCount: 4,
      missing: ['missing.txt']
    }
  },
  {
    id: 'pagination-truncation',
    prompt:
      'Read numbers.txt in pages of exactly 3 lines until EOF; sum every value. Also read long.txt with limit 1. Return {sum,lines,longLineIncomplete,safeResume}. safeResume means a line offset can continue the missing part of that same long line; do not invent a byte cursor.',
    expected: {
      sum: 78,
      lines: 12,
      longLineIncomplete: true,
      safeResume: false
    }
  },
  {
    id: 'list-truncation',
    prompt:
      'First glob bulk/*.txt (over the list cap), then narrow to bulk/a*.txt and bulk/b*.txt to count all files. Return {initialIncomplete,count}; do not count a capped list as complete.',
    expected: {
      initialIncomplete: true,
      count: 205
    }
  },
  {
    id: 'script-repair',
    prompt:
      'Return {serviceCount} from services.json. Native tools remain allowed. If using run_code, first try this candidate unchanged, then repair it based on the actual diagnostic: return (await tools.read_files({files:[{path:"services.json"}]})).files[0].content;',
    expected: {
      serviceCount: 4
    }
  }
];

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-code-eval-'));
  const cwd = path.join(root, 'project');
  const home = path.join(root, 'home');
  fs.mkdirSync(cwd);
  fs.mkdirSync(home);
  const put = (name, content) => {
    const target = path.join(cwd, name);
    fs.mkdirSync(path.dirname(target), {
      recursive: true
    });
    fs.writeFileSync(target, content);
  };
  put('notes.txt', '中文🙂 needle\nsecond line\n');
  put(
    'services.json',
    JSON.stringify([
      {
        id: 'auth',
        enabled: true,
        file: 'records/auth.json'
      },
      {
        id: 'search',
        enabled: true,
        file: 'records/search.json'
      },
      {
        id: 'billing',
        enabled: false,
        file: 'records/billing.json'
      },
      {
        id: 'cdn',
        enabled: true,
        file: 'records/cdn.json'
      }
    ])
  );
  for (const [id, errors] of [
    ['auth', 3],
    ['search', 2],
    ['billing', 10],
    ['cdn', 0]
  ]) {
    put(
      `records/${id}.json`,
      JSON.stringify({
        errors
      })
    );
  }
  put('route.json', '{"active":"backup.json"}');
  put('backup.json', '{"region":"west","port":8443}');
  put('primary.json', '{"region":"east","port":443}');
  put('ledger.json', '[{"team":"core","amount":10},{"team":"edge","amount":7},{"team":"core","amount":13}]');
  put('empty.txt', '');
  put(
    'numbers.txt',
    Array.from(
      {
        length: 12
      },
      (_, index) => index + 1
    ).join('\n') + '\n'
  );
  put('long.txt', 'x'.repeat(100_000) + ' tail\n');
  for (let index = 0; index < 205; index += 1) {
    put(`bulk/${index < 103 ? 'a' : 'b'}${String(index).padStart(3, '0')}.txt`, 'data\n');
  }
  return {
    root,
    cwd,
    home,
    cleanup: () =>
      fs.rmSync(root, {
        recursive: true,
        force: true
      })
  };
}

// 不跟随符号链接；检查持久内容、链接目标、文件类型及权限，不把读操作造成的 atime 当写入。
function snapshotTree(root) {
  const entries = {};
  function visit(relative) {
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    const entry = {
      mode: stat.mode & 0o7777
    };
    if (stat.isSymbolicLink()) {
      entry.kind = 'symlink';
      entry.target = fs.readlinkSync(absolute);
    } else if (stat.isDirectory()) {
      entry.kind = 'directory';
    } else if (stat.isFile()) {
      entry.kind = 'file';
      entry.bytes = stat.size;
      entry.sha256 = createHash('sha256')
        .update(fs.readFileSync(absolute))
        .digest('hex');
    } else {
      entry.kind = 'special';
    }
    entries[relative || '.'] = entry;
    if (entry.kind === 'directory') {
      for (const child of fs.readdirSync(absolute).sort()) {
        visit(path.join(relative, child));
      }
    }
  }
  if (fs.existsSync(root)) {
    visit('');
  }
  return entries;
}

function compareTrees(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter((name) => !isDeepStrictEqual(before[name], after[name]))
    .map((name) => ({
      path: name,
      before: before[name] || null,
      after: after[name] || null
    }));
}

function judge(task, rawText) {
  let actual;
  try {
    actual = JSON.parse(rawText);
  } catch {
    return {
      success: false,
      reason: 'Final answer is not a single JSON value',
      rawText
    };
  }
  return {
    success: isDeepStrictEqual(actual, task.expected),
    expected: task.expected,
    actual
  };
}

module.exports = {
  TASKS,
  createFixture,
  snapshotTree,
  compareTrees,
  judge
};
