const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectProjectAgentInstructionCandidates,
  findProjectRoot,
  getDefaultGlobalAgentsPath,
  loadAgentInstructions
} = require('../../src/agent/agent-instructions');

function createStats(kind) {
  return {
    isDirectory() {
      return kind === 'dir';
    },
    isFile() {
      return kind === 'file';
    }
  };
}

function createFakeFs(entries, options = {}) {
  const readFailures = new Set(options.readFailures || []);

  return {
    readFile(filePath) {
      const entry = entries[filePath];

      if (!entry || entry.kind !== 'file' || readFailures.has(filePath)) {
        throw new Error(`cannot read ${filePath}`);
      }

      return entry.content;
    },
    stat(filePath) {
      const entry = entries[filePath];

      if (!entry) {
        throw new Error(`missing ${filePath}`);
      }

      return createStats(entry.kind);
    }
  };
}

test('loadAgentInstructions reads global and project AGENTS from root to cwd', () => {
  const homedir = '/home/user';
  const cwd = '/work/repo/src/pkg';
  const fs = createFakeFs({
    '/home/user/.echo/AGENTS.md': {kind: 'file', content: 'global rules'},
    '/work/repo/.git': {kind: 'dir'},
    '/work/repo/AGENTS.md': {kind: 'file', content: 'root rules'},
    '/work/repo/src/AGENTS.md': {kind: 'file', content: 'src rules'},
    '/work/repo/src/pkg/AGENTS.md': {kind: 'file', content: 'pkg rules'}
  });

  const instructions = loadAgentInstructions({cwd, homedir, readFile: fs.readFile, stat: fs.stat});

  assert.deepEqual(instructions.map(({label, sourceKind}) => ({label, sourceKind})), [
    {label: 'AGENTS.md', sourceKind: 'global'},
    {label: 'AGENTS.md', sourceKind: 'project'},
    {label: 'src/AGENTS.md', sourceKind: 'project'},
    {label: 'src/pkg/AGENTS.md', sourceKind: 'project'}
  ]);
  assert.deepEqual(instructions.map((instruction) => instruction.content), [
    'global rules',
    'root rules',
    'src rules',
    'pkg rules'
  ]);
});

test('findProjectRoot supports git file and project echo marker', () => {
  const gitFileFs = createFakeFs({
    '/work/repo/.git': {kind: 'file', content: 'gitdir: ../.git/worktrees/repo'}
  });
  const echoFs = createFakeFs({
    '/work/echo/.echo': {kind: 'dir'}
  });

  assert.equal(findProjectRoot('/work/repo/sub', '/home/user', gitFileFs.stat), '/work/repo');
  assert.equal(findProjectRoot('/work/echo/sub', '/home/user', echoFs.stat), '/work/echo');
});

test('loadAgentInstructions ignores home .echo as project marker and falls back to cwd only', () => {
  const homedir = '/home/user';
  const cwd = '/home/user/project/sub';
  const fs = createFakeFs({
    '/home/user/.echo': {kind: 'dir'},
    '/home/user/.echo/AGENTS.md': {kind: 'file', content: 'global rules'},
    '/home/user/AGENTS.md': {kind: 'file', content: 'home project rules must not load'},
    '/home/user/project/sub/AGENTS.md': {kind: 'file', content: 'cwd rules'}
  });

  const instructions = loadAgentInstructions({cwd, homedir, readFile: fs.readFile, stat: fs.stat});

  assert.deepEqual(instructions.map(({label, sourceKind}) => ({label, sourceKind})), [
    {label: 'AGENTS.md', sourceKind: 'global'},
    {label: 'AGENTS.md', sourceKind: 'project'}
  ]);
  assert.deepEqual(instructions.map((instruction) => instruction.content), ['global rules', 'cwd rules']);
});

test('collectProjectAgentInstructionCandidates uses cwd AGENTS only without project marker', () => {
  const fs = createFakeFs({});

  assert.deepEqual(collectProjectAgentInstructionCandidates('/tmp/no-marker/sub', '/home/user', fs.stat), [
    {
      filePath: '/tmp/no-marker/sub/AGENTS.md',
      label: 'AGENTS.md',
      sourceKind: 'project'
    }
  ]);
});

test('loadAgentInstructions skips missing unreadable and non-file AGENTS entries', () => {
  const homedir = '/home/user';
  const cwd = '/work/repo/src';
  const fs = createFakeFs({
    '/home/user/.echo/AGENTS.md': {kind: 'dir'},
    '/work/repo/.git': {kind: 'dir'},
    '/work/repo/AGENTS.md': {kind: 'file', content: 'unreadable'},
    '/work/repo/src/AGENTS.md': {kind: 'file', content: 'src rules'}
  }, {
    readFailures: ['/work/repo/AGENTS.md']
  });

  const instructions = loadAgentInstructions({cwd, homedir, readFile: fs.readFile, stat: fs.stat});

  assert.deepEqual(instructions.map(({label, sourceKind}) => ({label, sourceKind})), [{label: 'src/AGENTS.md', sourceKind: 'project'}]);
  assert.deepEqual(instructions.map((instruction) => instruction.content), ['src rules']);
});

test('loadAgentInstructions truncates file and total AGENTS content budgets', () => {
  const homedir = '/home/user';
  const cwd = '/work/repo';
  const fs = createFakeFs({
    '/home/user/.echo/AGENTS.md': {kind: 'file', content: 'global'},
    '/work/repo/.git': {kind: 'dir'},
    '/work/repo/AGENTS.md': {kind: 'file', content: 'project rules that should be truncated'}
  });

  const instructions = loadAgentInstructions({
    cwd,
    homedir,
    maxFileBytes: 20,
    maxTotalBytes: 25,
    readFile: fs.readFile,
    stat: fs.stat
  });

  assert.equal(getDefaultGlobalAgentsPath(homedir), '/home/user/.echo/AGENTS.md');
  assert.equal(instructions[0].content, 'global');
  assert.match(instructions[1].content, /\[truncated\]/);
});
