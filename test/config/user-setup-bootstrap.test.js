const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_SETUP_SKILL_CONTENT,
  bootstrapEchoUserSetup,
  createDefaultUserConfig
} = require('../../src/config/user-setup-bootstrap');
const { createSkillManager } = require('../../src/skills/skill-manager');
const { createSkillRegistry } = require('../../src/skills/skill-registry');
const { createUseSkillToolHandler } = require('../../src/tools/use-skill-tool-handler');
const { createToolExecutor } = require('../../src/tools/tool-executor');
const { createToolRegistry } = require('../../src/tools/tool-registry');

function createTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'echo-tui-setup-'));
}

function writeSkill(root, folderName, frontmatter, body) {
  const skillDir = path.join(root, folderName);
  fs.mkdirSync(skillDir, {recursive: true});
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}\n`, 'utf8');
}

test('bootstrapEchoUserSetup creates default config and setup skill without real secrets', () => {
  const cwd = createTempWorkspace();
  const echoDir = path.join(cwd, '.echo');
  const result = bootstrapEchoUserSetup({echoDir});
  const config = JSON.parse(fs.readFileSync(path.join(echoDir, 'config.json'), 'utf8'));
  const skill = fs.readFileSync(path.join(echoDir, 'skills', 'echo-tui-setup', 'SKILL.md'), 'utf8');

  assert.equal(result.configCreated, true);
  assert.equal(result.setupSkillCreated, true);
  assert.deepEqual(config, createDefaultUserConfig());
  assert.equal(config.llm.providers.default.preset, 'fake-agent');
  assert.equal('apiKey' in config.llm.providers.default, false);
  assert.equal('mcp' in config, false);
  assert.match(skill, /name: echo-tui-setup/);
  assert.match(skill, /description: Explain how to install echo-tui skills/);
  assert.match(skill, /~\/\.echo\/skills\/<skill-name>\/SKILL\.md/);
  assert.match(skill, /user-level skills override built-ins/);
  assert.match(skill, /never in the npm installation directory/);
  assert.match(skill, /mcp\.servers/);
  assert.match(skill, /llm\.providers/);
  assert.match(skill, /selectedModel/);
});

test('bootstrapEchoUserSetup is idempotent and does not modify existing files or skill state', () => {
  const cwd = createTempWorkspace();
  const echoDir = path.join(cwd, '.echo');
  const configPath = path.join(echoDir, 'config.json');
  const setupSkillPath = path.join(echoDir, 'skills', 'echo-tui-setup', 'SKILL.md');
  const statePath = path.join(echoDir, 'skills', 'skills.json');

  fs.mkdirSync(path.dirname(setupSkillPath), {recursive: true});
  fs.writeFileSync(configPath, '{"custom":true}\n', 'utf8');
  fs.writeFileSync(setupSkillPath, 'custom skill\n', 'utf8');
  fs.writeFileSync(statePath, '{"schemaVersion":1,"disabled":["echo-tui-setup"]}\n', 'utf8');

  const result = bootstrapEchoUserSetup({echoDir});

  assert.equal(result.configCreated, false);
  assert.equal(result.setupSkillCreated, false);
  assert.equal(fs.readFileSync(configPath, 'utf8'), '{"custom":true}\n');
  assert.equal(fs.readFileSync(setupSkillPath, 'utf8'), 'custom skill\n');
  assert.equal(fs.readFileSync(statePath, 'utf8'), '{"schemaVersion":1,"disabled":["echo-tui-setup"]}\n');
});

test('bootstrap setup skill is discovered as a user skill and can be loaded through use_skill', async () => {
  const cwd = createTempWorkspace();
  const echoDir = path.join(cwd, '.echo');
  const userSkillsDir = path.join(echoDir, 'skills');
  const projectSkillsDir = path.join(cwd, 'project', '.echo', 'skills');

  bootstrapEchoUserSetup({echoDir});
  const registry = createSkillRegistry({builtinSkillsDir: path.join(cwd, 'missing-builtin'), cwd, projectSkillsDir, userSkillsDir});
  const catalog = registry.listCatalog();

  assert.deepEqual(catalog.map(({name, sourceKind}) => ({name, sourceKind})), [
    {name: 'echo-tui-setup', sourceKind: 'user'}
  ]);
  assert.equal(registry.loadSkill('echo-tui-setup').skill.content.includes('## MCP servers'), true);

  const executor = createToolExecutor(createToolRegistry([createUseSkillToolHandler(registry)]));
  const result = await executor.execute({
    callId: 'call_setup_skill',
    toolName: 'use_skill',
    argumentsText: JSON.stringify({name: 'echo-tui-setup', arguments: null})
  });

  assert.equal(result.ok, true);
  assert.match(result.text, /skill: echo-tui-setup/);
  assert.match(result.text, /Echo TUI Setup/);
});

test('project setup skill overrides bootstrap user setup skill and state is saved in user root when effective', () => {
  const cwd = createTempWorkspace();
  const echoDir = path.join(cwd, '.echo');
  const userSkillsDir = path.join(echoDir, 'skills');
  const projectSkillsDir = path.join(cwd, 'project-skills');

  bootstrapEchoUserSetup({echoDir});
  writeSkill(projectSkillsDir, 'echo-tui-setup', 'name: echo-tui-setup\ndescription: Project setup', '# Project Setup');

  const overridden = createSkillRegistry({builtinSkillsDir: path.join(cwd, 'missing-builtin'), cwd, projectSkillsDir, userSkillsDir});
  assert.deepEqual(overridden.listCatalog().map(({name, sourceKind, description}) => ({name, sourceKind, description})), [
    {name: 'echo-tui-setup', sourceKind: 'project', description: 'Project setup'}
  ]);

  const manager = createSkillManager({builtinSkillsDir: path.join(cwd, 'missing-builtin'), cwd, projectSkillsDir: path.join(cwd, 'missing-project'), userSkillsDir});
  assert.deepEqual(manager.listSkills().map(({name, enabled, sourceKind}) => ({name, enabled, sourceKind})), [
    {name: 'echo-tui-setup', enabled: true, sourceKind: 'user'}
  ]);
  manager.saveSkillStates(manager.listSkills().map((skill) => ({...skill, enabled: false})));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userSkillsDir, 'skills.json'), 'utf8')).disabled, ['echo-tui-setup']);
});

test('default setup skill template stays parseable', () => {
  assert.match(DEFAULT_SETUP_SKILL_CONTENT, /^---\nname: echo-tui-setup\n/m);
  assert.match(DEFAULT_SETUP_SKILL_CONTENT, /preset/);
});
