const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const {createSkillManager} = require('../../src/skills/skill-manager');
const {captureSkillSnapshot, createScopedSkillRegistry} = require('../../src/skills/skill-snapshot');

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-skill-snapshot-'));
  const builtin = path.join(root, 'builtin');
  const user = path.join(root, 'user');
  const project = path.join(root, 'project');
  for (const dir of [builtin, user, project]) {
    fs.mkdirSync(dir, {recursive: true});
  }
  return {builtin, project, root, user};
}

function writeSkill(base, name, description, content = `# ${name}\n\nBody for ${name}.`) {
  const dir = path.join(base, name);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${content}\n`, 'utf8');
  return path.join(dir, 'SKILL.md');
}

function createManager(workspace) {
  return createSkillManager({
    builtinSkillsDir: workspace.builtin,
    cwd: workspace.project,
    projectSkillsDir: workspace.project,
    userSkillsDir: workspace.user
  });
}

test('skill snapshot freezes enabled catalog, content, and disabled state at capture time', () => {
  const workspace = createWorkspace();
  try {
    writeSkill(workspace.builtin, 'alpha-skill', 'Alpha description.', '# Alpha original');
    writeSkill(workspace.project, 'beta-skill', 'Beta description.');
    const manager = createManager(workspace);
    const snapshot = captureSkillSnapshot(manager);

    assert.deepEqual(snapshot.listCatalog().map(({name, sourceKind}) => ({name, sourceKind})), [
      {name: 'alpha-skill', sourceKind: 'builtin'},
      {name: 'beta-skill', sourceKind: 'project'}
    ]);
    const loaded = snapshot.loadSkill('alpha-skill');
    assert.equal(loaded.ok, true);
    assert.equal(loaded.skill.content, '# Alpha original');
    assert.deepEqual(loaded.skill.resources, []);

    // 同名 skill 使用冻结时刻按来源优先级胜出的单个定义，不跨来源合并。
    writeSkill(workspace.project, 'alpha-skill', 'Project alpha.', '# Project alpha');
    const overriddenSnapshot = captureSkillSnapshot(createManager(workspace));
    const overridden = overriddenSnapshot.loadSkill('alpha-skill');
    assert.equal(overridden.ok, true);
    assert.equal(overridden.skill.sourceKind, 'project');
    assert.equal(overridden.skill.content, '# Project alpha');
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('skill snapshot keeps load results stable while files and enabled state change mid-run', () => {
  const workspace = createWorkspace();
  try {
    const skillPath = writeSkill(workspace.project, 'stable-skill', 'Stable description.', '# Stable original');
    writeSkill(workspace.project, 'disabled-skill', 'Disabled description.');
    const manager = createManager(workspace);
    const stateRoot = workspace.project;
    manager.saveSkillStates(manager.listSkills().map((item) => item.name === 'disabled-skill' ? {...item, enabled: false} : item));
    const snapshot = captureSkillSnapshot(manager);

    assert.equal(snapshot.listCatalog().some(({name}) => name === 'disabled-skill'), false);
    const disabled = snapshot.loadSkill('disabled-skill');
    assert.equal(disabled.ok, false);
    assert.equal(disabled.reason, 'disabled');
    assert.match(disabled.message, /disabled/u);

    // 捕获后修改文件与启用状态都不得影响当前快照。
    fs.writeFileSync(skillPath, '---\nname: stable-skill\ndescription: Stable description.\n---\n\n# Rewritten body\n', 'utf8');
    manager.saveSkillStates(manager.listSkills().map((item) => ({...item, enabled: true})));
    const stillOriginal = snapshot.loadSkill('stable-skill');
    assert.equal(stillOriginal.ok, true);
    assert.equal(stillOriginal.skill.content, '# Stable original');
    assert.equal(snapshot.listCatalog().some(({name}) => name === 'disabled-skill'), false);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('scoped registry filters catalog and loadSkill with the same allowed name set', () => {
  const workspace = createWorkspace();
  try {
    writeSkill(workspace.builtin, 'review-skill', 'Review description.');
    writeSkill(workspace.project, 'test-skill', 'Test description.');
    writeSkill(workspace.project, 'hidden-skill', 'Hidden description.');
    const snapshot = captureSkillSnapshot(createManager(workspace));

    const allScope = createScopedSkillRegistry(snapshot, undefined);
    assert.deepEqual(allScope.listCatalog().map(({name}) => name), ['hidden-skill', 'review-skill', 'test-skill']);
    assert.equal(allScope.loadSkill('review-skill').ok, true);

    const noneScope = createScopedSkillRegistry(snapshot, []);
    assert.deepEqual(noneScope.listCatalog(), []);
    const denied = noneScope.loadSkill('review-skill');
    assert.equal(denied.ok, false);
    assert.deepEqual(denied.availableSkills, []);

    const narrowScope = createScopedSkillRegistry(snapshot, ['review-skill', 'missing-skill']);
    assert.deepEqual(narrowScope.listCatalog().map(({name}) => name), ['review-skill']);
    assert.equal(narrowScope.loadSkill('test-skill').ok, false);
    assert.deepEqual(narrowScope.loadSkill('test-skill').availableSkills.map(({name}) => name), ['review-skill']);
    // 未授权加载不泄露目标正文、来源路径或 scope 外目录。
    const rejected = narrowScope.loadSkill('hidden-skill');
    assert.equal(rejected.ok, false);
    assert.equal(JSON.stringify(rejected).includes('Hidden description'), false);
    assert.equal(JSON.stringify(rejected).includes('hidden-skill/SKILL.md'), false);
    assert.deepEqual(rejected.availableSkills.map(({name}) => name), ['review-skill']);

    // 允许名称的加载保持正文与资源可用，并且缺失名称按 unknown 失败。
    const allowed = narrowScope.loadSkill('review-skill');
    assert.equal(allowed.ok, true);
    assert.equal(allowed.skill.content.includes('review-skill'), true);
    const unknown = narrowScope.loadSkill('never-existed');
    assert.equal(unknown.ok, false);
    assert.equal(unknown.reason, 'missing');
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('snapshot preserves per-skill model and effort overrides for scoped loads', () => {
  const workspace = createWorkspace();
  try {
    writeSkill(workspace.project, 'override-skill', 'Override description.');
    const manager = createManager(workspace);
    manager.saveSkillStates(manager.listSkills().map((item) => ({
      ...item,
      enabled: true,
      modelProfileId: 'fast-model',
      reasoningEffortOverride: 'low'
    })));
    const snapshot = captureSkillSnapshot(manager);
    const loaded = snapshot.loadSkill('override-skill');
    assert.equal(loaded.ok, true);
    assert.equal(loaded.modelProfileId, 'fast-model');
    assert.equal(loaded.reasoningEffortOverride, 'low');

    const scoped = createScopedSkillRegistry(snapshot, ['override-skill']);
    const scopedLoad = scoped.loadSkill('override-skill');
    assert.equal(scopedLoad.ok, true);
    assert.equal(scopedLoad.modelProfileId, 'fast-model');
    assert.equal(scopedLoad.reasoningEffortOverride, 'low');
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});
