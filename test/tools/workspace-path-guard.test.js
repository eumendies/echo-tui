const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const {checkWorkspaceWriteTarget} = require('../../src/tools/workspace-path-guard');
const {createEditFileToolHandler} = require('../../src/tools/edit-file-tool-handler');
const {createApplyPatchToolHandler} = require('../../src/tools/apply-patch-tool-handler');

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-workspace-guard-'));
  const workspace = path.join(root, 'worktree');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(workspace, 'src'), {recursive: true});
  fs.mkdirSync(outside, {recursive: true});
  fs.writeFileSync(path.join(workspace, 'src', 'index.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret\n');
  return {outside, root, workspace};
}

test('checkWorkspaceWriteTarget allows paths inside the managed root', () => {
  const {workspace} = createWorkspace();
  assert.deepEqual(checkWorkspaceWriteTarget(workspace, path.join(workspace, 'src', 'index.js')), {kind: 'allowed'});
  // 尚未存在的目标也允许：新文件与新建目录是正常编辑路径。
  assert.deepEqual(checkWorkspaceWriteTarget(workspace, path.join(workspace, 'src', 'nested', 'new.js')), {kind: 'allowed'});
  assert.deepEqual(checkWorkspaceWriteTarget(workspace, workspace), {kind: 'allowed'});
});

test('checkWorkspaceWriteTarget rejects parent traversal and absolute paths outside the root', () => {
  const {outside, root, workspace} = createWorkspace();
  assert.equal(checkWorkspaceWriteTarget(workspace, path.join(workspace, '..', 'outside', 'secret.txt')).kind, 'denied');
  assert.equal(checkWorkspaceWriteTarget(workspace, path.join(outside, 'secret.txt')).kind, 'denied');
  assert.equal(checkWorkspaceWriteTarget(workspace, path.join(root, 'sibling.txt')).kind, 'denied');
});

test('checkWorkspaceWriteTarget rejects a symbolic link that escapes the root', () => {
  const {outside, workspace} = createWorkspace();
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(workspace, 'src', 'link.txt'));
  const result = checkWorkspaceWriteTarget(workspace, path.join(workspace, 'src', 'link.txt'));
  assert.equal(result.kind, 'denied');
  assert.match(result.reason, /symbolic link/u);

  // 通过父目录换链逃逸同样必须拒绝。
  fs.symlinkSync(outside, path.join(workspace, 'escape-dir'));
  const nested = checkWorkspaceWriteTarget(workspace, path.join(workspace, 'escape-dir', 'new.txt'));
  assert.equal(nested.kind, 'denied');
});

test('checkWorkspaceWriteTarget rejects a directory swapped to a link after the first check', () => {
  const {outside, workspace} = createWorkspace();
  const targetDir = path.join(workspace, 'generated');
  fs.mkdirSync(targetDir);
  const target = path.join(targetDir, 'out.txt');

  // 第一次校验通过；随后目录被替换为指向根外的符号链接。
  assert.deepEqual(checkWorkspaceWriteTarget(workspace, target), {kind: 'allowed'});
  fs.rmdirSync(targetDir);
  fs.symlinkSync(outside, targetDir);

  // 写入前复核必须拒绝。这里不声称消除全部同 UID 竞态，只保证不能确认时拒绝。
  const recheck = checkWorkspaceWriteTarget(workspace, target);
  assert.equal(recheck.kind, 'denied');
});

test('edit_file rejects targets outside the managed workspace scope', () => {
  const {outside, workspace} = createWorkspace();
  const inScope = createEditFileToolHandler({cwd: workspace, scopeRoot: workspace});
  const outsideTarget = path.join(outside, 'secret.txt');

  const rejected = inScope.execute(
    {path: outsideTarget, old_string: 'secret', new_string: 'changed'},
    {callId: 'call-1', toolName: 'edit_file', argumentsText: '{}'}
  );
  assert.equal(rejected.ok, false);
  assert.match(rejected.text, /outside the managed worker workspace/u);
  assert.equal(fs.readFileSync(outsideTarget, 'utf8'), 'secret\n');

  const traversal = inScope.execute(
    {path: '../outside/secret.txt', old_string: 'secret', new_string: 'changed'},
    {callId: 'call-2', toolName: 'edit_file', argumentsText: '{}'}
  );
  assert.equal(traversal.ok, false);

  const allowed = inScope.execute(
    {path: 'src/index.js', old_string: 'module.exports = 1;', new_string: 'module.exports = 2;'},
    {callId: 'call-3', toolName: 'edit_file', argumentsText: '{}'}
  );
  assert.equal(allowed.ok, true);
  assert.equal(fs.readFileSync(path.join(workspace, 'src', 'index.js'), 'utf8'), 'module.exports = 2;\n');
});

test('apply_patch rejects targets outside the managed workspace scope', () => {
  const {outside, workspace} = createWorkspace();
  const inScope = createApplyPatchToolHandler({cwd: workspace, scopeRoot: workspace});
  const outsideTarget = path.join(outside, 'secret.txt');

  const rejected = inScope.execute(
    {patch: `*** Begin Patch\n*** Update File: ${outsideTarget}\n@@\n-secret\n+changed\n*** End Patch`},
    {callId: 'call-1', toolName: 'apply_patch', argumentsText: '{}'}
  );
  assert.equal(rejected.ok, false);
  assert.equal(fs.readFileSync(outsideTarget, 'utf8'), 'secret\n');

  const allowed = inScope.execute(
    {patch: '*** Begin Patch\n*** Add File: src/added.js\n+module.exports = 3;\n*** End Patch'},
    {callId: 'call-2', toolName: 'apply_patch', argumentsText: '{}'}
  );
  assert.equal(allowed.ok, true);
  assert.equal(fs.readFileSync(path.join(workspace, 'src', 'added.js'), 'utf8'), 'module.exports = 3;\n');
});

test('main agent tool descriptions keep their original path semantics', () => {
  const unscopedEdit = createEditFileToolHandler({});
  const unscopedPatch = createApplyPatchToolHandler({});
  assert.match(unscopedEdit.definition.description, /absolute paths and \.\. paths are supported/u);
  assert.match(unscopedPatch.definition.description, /absolute paths and \.\. paths are supported/u);

  const scopedEdit = createEditFileToolHandler({scopeRoot: process.cwd()});
  const scopedPatch = createApplyPatchToolHandler({scopeRoot: process.cwd()});
  assert.match(scopedEdit.definition.description, /confined to its managed worker workspace/u);
  assert.match(scopedPatch.definition.description, /confined to its managed worker workspace/u);
});
