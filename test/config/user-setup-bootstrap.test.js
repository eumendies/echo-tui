const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  bootstrapEchoUserSetup,
  createDefaultUserConfig
} = require('../../src/config/user-setup-bootstrap');
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

function readBuiltinSetupSkillTemplate() {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'skills', 'builtin', 'echo-tui-setup', 'SKILL.md'), 'utf8');
}

test('bootstrapEchoUserSetup creates default config without real secrets', () => {
  const cwd = createTempWorkspace();
  const echoDir = path.join(cwd, '.echo');
  const result = bootstrapEchoUserSetup({echoDir});
  const config = JSON.parse(fs.readFileSync(path.join(echoDir, 'config.json'), 'utf8'));

  assert.equal(result.configCreated, true);
  assert.deepEqual(config, createDefaultUserConfig());
  assert.equal(config.llm.providers.default.preset, 'fake-agent');
  assert.equal('apiKey' in config.llm.providers.default, false);
  assert.equal('mcp' in config, false);
});

test('bootstrapEchoUserSetup is idempotent and does not modify existing config', () => {
  const cwd = createTempWorkspace();
  const echoDir = path.join(cwd, '.echo');
  const configPath = path.join(echoDir, 'config.json');

  fs.mkdirSync(echoDir, {recursive: true});
  fs.writeFileSync(configPath, '{"custom":true}\n', 'utf8');

  const result = bootstrapEchoUserSetup({echoDir});

  assert.equal(result.configCreated, false);
  assert.equal(fs.readFileSync(configPath, 'utf8'), '{"custom":true}\n');
});

test('packaged echo-tui-setup builtin skill is discoverable and loadable through use_skill', async () => {
  const cwd = createTempWorkspace();
  const registry = createSkillRegistry({cwd, projectSkillsDir: path.join(cwd, 'missing-project'), userSkillsDir: path.join(cwd, 'missing-user')});
  const catalog = registry.listCatalog();

  assert.deepEqual(catalog.find((entry) => entry.name === 'echo-tui-setup'), {
    name: 'echo-tui-setup',
    description: 'Explain how to install echo-tui skills and configure MCP servers, providers, and models.',
    sourceKind: 'builtin',
    sourcePath: path.join(__dirname, '..', '..', 'src', 'skills', 'builtin', 'echo-tui-setup', 'SKILL.md')
  });
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

test('user-level echo-tui-setup overrides the packaged builtin skill', () => {
  const cwd = createTempWorkspace();
  const userSkillsDir = path.join(cwd, 'user-skills');

  writeSkill(userSkillsDir, 'echo-tui-setup', 'name: echo-tui-setup\ndescription: User setup', '# User Setup');

  const registry = createSkillRegistry({cwd, projectSkillsDir: path.join(cwd, 'missing-project'), userSkillsDir});
  const entry = registry.listCatalog().find((skill) => skill.name === 'echo-tui-setup');

  assert.equal(entry.sourceKind, 'user');
  assert.equal(registry.loadSkill('echo-tui-setup').skill.content, '# User Setup');
});

test('default setup skill template stays parseable', () => {
  const content = readBuiltinSetupSkillTemplate();

  assert.match(content, /^---\nname: echo-tui-setup\n/m);
  assert.match(content, /preset/);
});

