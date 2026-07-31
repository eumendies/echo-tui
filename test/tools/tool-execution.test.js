const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const { createApplyPatchToolHandler, APPLY_PATCH_TOOL_NAME } = require('../../src/tools/apply-patch-tool-handler');
const { ChangeHistoryContext } = require('../../src/app/state/change-history-context');
const {
  ASK_USER_QUESTIONS_TOOL_NAME,
  createAskUserQuestionsCancelledResult,
  createAskUserQuestionsSuccessResult,
  createAskUserQuestionsToolHandler,
  parseAskUserQuestionsArgs,
  parseAskUserQuestionsToolCall
} = require('../../src/tools/ask-user-questions-tool-handler');
const { createBashToolHandler, isChangeHistoryReadonlyBashCommand, RUN_BASH_COMMAND_TOOL_NAME } = require('../../src/tools/bash-tool-handler');
const { runBashCommand } = require('../../src/tools/bash-command-runner');
const { createGlobToolHandler, DEFAULT_MAX_PATHS, GLOB_TOOL_NAME } = require('../../src/tools/glob-tool-handler');
const { createGrepToolHandler, DEFAULT_MAX_MATCHES, GREP_TOOL_NAME } = require('../../src/tools/grep-tool-handler');
const {
  createReadFilesToolHandler,
  DEFAULT_MAX_DIRECTORY_ENTRIES,
  DEFAULT_MAX_PDF_OUTPUT_BYTES,
  DEFAULT_MAX_TOTAL_OUTPUT_BYTES: DEFAULT_READ_FILES_MAX_TOTAL_OUTPUT_BYTES,
  READ_FILES_TOOL_NAME
} = require('../../src/tools/read-files');
const { createWebFetchToolHandler, DEFAULT_MAX_TOTAL_OUTPUT_BYTES: DEFAULT_WEB_FETCH_MAX_TOTAL_OUTPUT_BYTES, WEB_FETCH_TOOL_NAME } = require('../../src/tools/web-fetch-tool-handler');
const { createWebSearchToolHandler, WEB_SEARCH_TOOL_NAME } = require('../../src/tools/web-search');
const { createSkillManager } = require('../../src/skills/skill-manager');
const { createSkillRegistry } = require('../../src/skills/skill-registry');
const { listSkillUseRecords } = require('../../src/skills/skill-usage');
const { createToolExecutor } = require('../../src/tools/tool-executor');
const { createDefaultToolRegistry, createToolRegistry } = require('../../src/tools/tool-registry');
const { createToolResultStore } = require('../../src/tools/tool-result-offloading');
const { COMPLETE_TODO_TOOL_NAME, CREATE_TODOS_TOOL_NAME } = require('../../src/tools/todo-tool-handler');
const { createUseSkillToolHandler, USE_SKILL_TOOL_NAME } = require('../../src/tools/use-skill-tool-handler');

function createCall(overrides = {}) {
  return {
    callId: 'call_1',
    toolName: RUN_BASH_COMMAND_TOOL_NAME,
    argumentsText: JSON.stringify({ command: 'printf hello' }),
    ...overrides
  };
}

function createPatchCall(patch) {
  return {
    callId: 'call_patch',
    toolName: APPLY_PATCH_TOOL_NAME,
    argumentsText: JSON.stringify({ patch })
  };
}

function createRecordingChangeRecorder() {
  const calls = {
    after: [],
    before: [],
    invalidations: []
  };

  return {
    calls,
    recorder: {
      captureFileBefore(filePath) {
        calls.before.push(filePath);
      },
      captureFileAfter(filePath) {
        calls.after.push(filePath);
      },
      invalidate(reason) {
        calls.invalidations.push(reason);
      }
    }
  };
}

function createReadFilesCall(files) {
  return {
    callId: 'call_read',
    toolName: READ_FILES_TOOL_NAME,
    argumentsText: JSON.stringify({ files })
  };
}

function extractToolResultMarkerPath(text) {
  return text.match(/\[tool result truncated: ([^\]]+)\]/)?.[1];
}

function createGrepCall(args) {
  return {
    callId: 'call_grep',
    toolName: GREP_TOOL_NAME,
    argumentsText: JSON.stringify(args)
  };
}

function createGlobCall(args) {
  return {
    callId: 'call_glob',
    toolName: GLOB_TOOL_NAME,
    argumentsText: JSON.stringify(args)
  };
}

function createWebFetchCall(args) {
  return {
    callId: 'call_web',
    toolName: WEB_FETCH_TOOL_NAME,
    argumentsText: JSON.stringify(args)
  };
}

function createWebSearchCall(args) {
  return {
    callId: 'call_search',
    toolName: WEB_SEARCH_TOOL_NAME,
    argumentsText: JSON.stringify(args)
  };
}

function createWebSearchExecutor(fetch, options = {}) {
  return createToolExecutor(createToolRegistry([createWebSearchToolHandler({ fetch, ...options })]));
}

function createBingSearchFixtureUrl(query, overrides = {}) {
  const count = overrides.count === undefined ? 5 : overrides.count;
  const first = overrides.first === undefined ? 1 : overrides.first;
  const safeSearch = overrides.safeSearch || 'Moderate';
  const usesEnglishSearch = overrides.market && (/^en-/i.test(overrides.market) || overrides.englishSearch === true);
  const market = overrides.market ? `&mkt=${encodeURIComponent(overrides.market)}${usesEnglishSearch ? '&ensearch=1' : ''}` : '';
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${count}&first=${first}${market}&safeSearch=${safeSearch}`;
}

function createDuckDuckGoSearchFixtureUrl(query, overrides = {}) {
  const offset = overrides.offset === undefined ? 0 : overrides.offset;
  const safeSearch = overrides.safeSearch || '-1';
  const market = overrides.market ? `&kl=${encodeURIComponent(overrides.market.toLowerCase())}` : '';
  return `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${offset}${market}&kp=${safeSearch}`;
}

function createBingResultHtml({ title, url, snippet = '' }) {
  return `<li class="b_algo"><h2><a href="${url}">${title}</a></h2><p>${snippet}</p></li>`;
}

function createBingResultsPage(results) {
  return `<html><body><ol id="b_results">${results.map(createBingResultHtml).join('\n')}</ol></body></html>`;
}

function createDuckDuckGoResultHtml({ title, url, snippet = '' }) {
  return `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(url)}">${title}</a><a class="result__snippet">${snippet}</a></div>`;
}

function createDuckDuckGoResultsPage(results) {
  return `<html><body>${results.map(createDuckDuckGoResultHtml).join('\n')}</body></html>`;
}

function createBlockedSearchPage() {
  return '<html><body>captcha required</body></html>';
}

function createDuckDuckGoChallengePage() {
  return '<html><body>Unfortunately, bots use DuckDuckGo too. Please complete the following challenge to confirm this search was made by a human. Select all squares containing a duck. error-lite@duckduckgo.com</body></html>';
}

function createLowQualityEchoPage() {
  return createBingResultsPage([
    { title: 'Echo - Definition and Meaning', url: 'https://dictionary.example.com/echo', snippet: 'An echo is a reflected sound.' },
    { title: 'Echo devices', url: 'https://shopping.example.com/echo', snippet: 'Compare echo speakers and smart home devices.' }
  ]);
}

function createFakeFetch(routes) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ init, url });
    const route = routes[url];

    if (route instanceof Error) {
      throw route;
    }

    if (typeof route === 'function') {
      return route(url, init);
    }

    if (!route) {
      throw new Error(`unexpected url: ${url}`);
    }

    const response = new Response(route.body || '', {
      headers: route.headers || {},
      status: route.status || 200,
      statusText: route.statusText || ''
    });

    Object.defineProperty(response, 'url', { value: url });
    return response;
  };

  fetchFn.calls = calls;
  return fetchFn;
}

function createTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'echo-tui-patch-'));
}

function escapePdfText(text) {
  return text.replace(/[\\()]/g, '\\$&');
}

function createPdfFixture(text) {
  const content = text === '' ? '' : `BT /F1 24 Tf 50 100 Td (${escapePdfText(text)}) Tj ET`;
  return createPdfFixtureFromContent(content);
}

function createPdfFixtureWithTextItems(items) {
  const operators = items.map((item, index) => `1 0 0 1 20 ${120 - (index % 8) * 14} Tm (${escapePdfText(item)}) Tj`).join('\n');
  return createPdfFixtureFromContent(`BT /F1 10 Tf\n${operators}\nET`);
}

function createPdfFixtureFromContent(content) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];

  for (const [index, object] of objects.entries()) {
    offsets[index + 1] = Buffer.byteLength(body);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

  for (let index = 1; index <= objects.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }

  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'utf8');
}

function readWorkspaceFile(cwd, filePath) {
  return fs.readFileSync(path.join(cwd, filePath), 'utf8');
}

function writeSkill(root, folderName, frontmatter, body = '# Skill Body\nFollow these steps.') {
  const skillDir = path.join(root, folderName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}\n`, 'utf8');
  return skillDir;
}

function writeSkillResource(skillDir, relativePath, body = 'resource') {
  const resourcePath = path.join(skillDir, relativePath);
  fs.mkdirSync(path.dirname(resourcePath), { recursive: true });
  fs.writeFileSync(resourcePath, body, 'utf8');
}

function createFakeRipgrep(cwd, body) {
  const scriptPath = path.join(cwd, 'fake-rg.js');
  fs.writeFileSync(scriptPath, `#!/usr/bin/env node\n${body}\n`, 'utf8');
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

test('tool registry exposes definitions and resolves handlers by name', () => {
  const handler = createBashToolHandler({ cwd: process.cwd() });
  const registry = createToolRegistry([handler]);

  assert.equal(registry.isEmpty(), false);
  assert.equal(registry.getHandler(RUN_BASH_COMMAND_TOOL_NAME), handler);
  assert.deepEqual(registry.listDefinitions(), [handler.definition]);
});

test('default tool registry exposes developed tools', () => {
  const registry = createDefaultToolRegistry({
    apiKey: 'test',
    baseURL: undefined,
    model: 'model',
    tools: {
      bash: {
        timeoutMs: null,
        maxOutputBytes: 65536
      }
    }
  }, process.cwd());

  assert.equal(registry.getHandler(RUN_BASH_COMMAND_TOOL_NAME) !== undefined, true);
  assert.equal(registry.getHandler(APPLY_PATCH_TOOL_NAME) !== undefined, true);
  assert.equal(registry.getHandler(ASK_USER_QUESTIONS_TOOL_NAME) !== undefined, true);
  assert.equal(registry.getHandler(GLOB_TOOL_NAME) !== undefined, true);
  assert.equal(registry.getHandler(GREP_TOOL_NAME) !== undefined, true);
  assert.equal(registry.getHandler(READ_FILES_TOOL_NAME) !== undefined, true);
  assert.equal(registry.getHandler('read_memory'), undefined);
  assert.equal(registry.getHandler('add_memory'), undefined);
  assert.equal(registry.getHandler('update_memory'), undefined);
  assert.equal(registry.getHandler('remove_memory'), undefined);
  assert.equal(registry.getHandler(CREATE_TODOS_TOOL_NAME) !== undefined, true);
  assert.equal(registry.getHandler(COMPLETE_TODO_TOOL_NAME) !== undefined, true);
  assert.equal(registry.getHandler(USE_SKILL_TOOL_NAME) !== undefined, true);
  assert.equal(registry.getHandler(WEB_FETCH_TOOL_NAME) !== undefined, true);
  assert.equal(registry.getHandler(WEB_SEARCH_TOOL_NAME) !== undefined, true);
  assert.deepEqual(registry.listDefinitions().map((definition) => definition.name), [
    RUN_BASH_COMMAND_TOOL_NAME,
    APPLY_PATCH_TOOL_NAME,
    ASK_USER_QUESTIONS_TOOL_NAME,
    GLOB_TOOL_NAME,
    GREP_TOOL_NAME,
    READ_FILES_TOOL_NAME,
    CREATE_TODOS_TOOL_NAME,
    COMPLETE_TODO_TOOL_NAME,
    USE_SKILL_TOOL_NAME,
    WEB_FETCH_TOOL_NAME,
    WEB_SEARCH_TOOL_NAME
  ]);
});

test('skill registry discovers builtin resources and applies builtin then user then project precedence', () => {
  const cwd = createTempWorkspace();
  const builtinSkillsDir = path.join(cwd, 'builtin-skills');
  const userSkillsDir = path.join(cwd, 'user-skills');
  const projectSkillsDir = path.join(cwd, '.echo', 'skills');
  const builtin = writeSkill(builtinSkillsDir, 'memory', 'name: memory\ndescription: Builtin memory', '# Builtin');
  writeSkillResource(builtin, 'reference/protocol.md');
  writeSkillResource(builtin, 'scripts/memory.js');
  writeSkill(userSkillsDir, 'memory', 'name: memory\ndescription: User memory', '# User');
  writeSkill(projectSkillsDir, 'memory', 'name: memory\ndescription: Project memory', '# Project');

  const registry = createSkillRegistry({builtinSkillsDir, cwd, projectSkillsDir, userSkillsDir});
  const loaded = registry.loadSkill('memory');

  assert.deepEqual(registry.listCatalog().map(({name, description, sourceKind}) => ({name, description, sourceKind})), [
    {name: 'memory', description: 'Project memory', sourceKind: 'project'}
  ]);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.skill.content, '# Project');
  assert.deepEqual(loaded.skill.resources, []);
});

test('skill manager stores builtin state in the user skill root', () => {
  const cwd = createTempWorkspace();
  const builtinSkillsDir = path.join(cwd, 'builtin-skills');
  const userSkillsDir = path.join(cwd, 'user-skills');
  const projectSkillsDir = path.join(cwd, 'missing-project');
  writeSkill(builtinSkillsDir, 'agent-memory', 'name: agent-memory\ndescription: Memory', '# Memory');
  fs.mkdirSync(userSkillsDir, {recursive: true});
  fs.writeFileSync(path.join(userSkillsDir, 'skills.json'), JSON.stringify({schemaVersion: 3, disabled: ['agent-memory']}), 'utf8');

  const manager = createSkillManager({builtinSkillsDir, cwd, projectSkillsDir, userSkillsDir});
  assert.equal(manager.listSkills()[0].sourceKind, 'builtin');
  assert.equal(manager.listSkills()[0].enabled, false);

  manager.saveSkillStates(manager.listSkills().map((skill) => ({...skill, enabled: true})));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userSkillsDir, 'skills.json'), 'utf8')).disabled, []);
  assert.equal(fs.existsSync(path.join(builtinSkillsDir, 'skills.json')), false);
});

test('skill registry discovers user and project skills with project override', () => {
  const cwd = createTempWorkspace();
  const userSkillsDir = path.join(cwd, 'user-skills');
  const projectSkillsDir = path.join(cwd, '.echo', 'skills');

  writeSkill(userSkillsDir, 'unit-test', 'name: unit-test\ndescription: Generate unit tests', '# Unit Test');
  writeSkill(userSkillsDir, 'review', 'name: review\ndescription: User review', '# User Review');
  writeSkill(projectSkillsDir, 'review', 'name: review\ndescription: Project review', '# Project Review');

  const registry = createSkillRegistry({ builtinSkillsDir: path.join(cwd, 'missing-builtin'), cwd, projectSkillsDir, userSkillsDir });

  assert.deepEqual(registry.listCatalog().map(({ name, description, sourceKind }) => ({ name, description, sourceKind })), [
    { name: 'review', description: 'Project review', sourceKind: 'project' },
    { name: 'unit-test', description: 'Generate unit tests', sourceKind: 'user' }
  ]);
  assert.equal(registry.loadSkill('review').skill.content, '# Project Review');
});

test('skill registry discovers sorted resources from reference and scripts only', () => {
  const cwd = createTempWorkspace();
  const projectSkillsDir = path.join(cwd, '.echo', 'skills');
  const skillDir = writeSkill(projectSkillsDir, 'review', 'name: review\ndescription: Review code', '# Review');
  writeSkillResource(skillDir, 'scripts/collect.sh');
  writeSkillResource(skillDir, 'reference/zeta.md');
  writeSkillResource(skillDir, 'reference/nested/alpha.md');
  writeSkillResource(skillDir, 'notes/ignored.md');
  fs.mkdirSync(path.join(skillDir, 'reference', 'empty-dir'), { recursive: true });

  const registry = createSkillRegistry({ builtinSkillsDir: path.join(cwd, 'missing-builtin'), cwd, projectSkillsDir, userSkillsDir: path.join(cwd, 'missing-user') });
  const result = registry.loadSkill('review');

  assert.equal(result.ok, true);
  assert.deepEqual(result.skill.resources, [
    'reference/nested/alpha.md',
    'reference/zeta.md',
    'scripts/collect.sh'
  ]);
});

test('skill registry skips unreadable resource directories without failing skill load', () => {
  const cwd = createTempWorkspace();
  const projectSkillsDir = path.join(cwd, '.echo', 'skills');
  const skillDir = writeSkill(projectSkillsDir, 'review', 'name: review\ndescription: Review code', '# Review');
  writeSkillResource(skillDir, 'reference/checklist.md');
  writeSkillResource(skillDir, 'scripts/collect.sh');

  const registry = createSkillRegistry({
    cwd,
    projectSkillsDir,
    userSkillsDir: path.join(cwd, 'missing-user'),
    readDir(dirPath) {
      if (dirPath === path.join(skillDir, 'reference')) {
        throw new Error('unreadable');
      }

      return fs.readdirSync(dirPath, { withFileTypes: true });
    }
  });
  const result = registry.loadSkill('review');

  assert.equal(result.ok, true);
  assert.deepEqual(result.skill.resources, ['scripts/collect.sh']);
});

test('skill registry reports invalid skill when loading by folder name', () => {
  const cwd = createTempWorkspace();
  const projectSkillsDir = path.join(cwd, '.echo', 'skills');
  writeSkill(projectSkillsDir, 'broken', 'name: broken', '# Broken');

  const registry = createSkillRegistry({ builtinSkillsDir: path.join(cwd, 'missing-builtin'), cwd, projectSkillsDir, userSkillsDir: path.join(cwd, 'missing-user') });
  const result = registry.loadSkill('broken');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid');
  assert.match(result.message, /description is required/);
  assert.deepEqual(result.availableSkills, []);
});

test('skill manager reads disabled state and saves by effective source root', () => {
  const cwd = createTempWorkspace();
  const userSkillsDir = path.join(cwd, 'user-skills');
  const projectSkillsDir = path.join(cwd, '.echo', 'skills');

  writeSkill(userSkillsDir, 'unit-test', 'name: unit-test\ndescription: Generate unit tests', '# Unit Test');
  writeSkill(userSkillsDir, 'review', 'name: review\ndescription: User review', '# User Review');
  writeSkill(projectSkillsDir, 'review', 'name: review\ndescription: Project review', '# Project Review');
  fs.writeFileSync(path.join(userSkillsDir, 'skills.json'), JSON.stringify({
    schemaVersion: 2,
    disabled: [],
    effortOverrides: {review: 'low', 'unit-test': 'none'},
    modelOverrides: {review: 'ignored-user-profile'}
  }), 'utf8');
  fs.writeFileSync(path.join(projectSkillsDir, 'skills.json'), JSON.stringify({
    schemaVersion: 2,
    disabled: ['review'],
    effortOverrides: {review: 'high'},
    modelOverrides: {review: 'project-profile'}
  }), 'utf8');

  const manager = createSkillManager({ builtinSkillsDir: path.join(cwd, 'missing-builtin'), cwd, projectSkillsDir, userSkillsDir });

  assert.deepEqual(manager.listSkills().map(({ name, enabled, sourceKind, modelProfileId, reasoningEffortOverride }) => ({ name, enabled, sourceKind, modelProfileId, reasoningEffortOverride })), [
    { name: 'review', enabled: false, sourceKind: 'project', modelProfileId: 'project-profile', reasoningEffortOverride: 'high' },
    { name: 'unit-test', enabled: true, sourceKind: 'user', modelProfileId: undefined, reasoningEffortOverride: 'none' }
  ]);
  assert.deepEqual(manager.listCatalog().map((skill) => skill.name), ['unit-test']);
  const disabled = manager.loadSkill('review');
  assert.equal(disabled.ok, false);
  assert.equal(disabled.reason, 'disabled');

  manager.saveSkillStates(manager.listSkills().map((skill) => skill.name === 'review'
    ? { ...skill, enabled: true, modelProfileId: undefined, reasoningEffortOverride: 'minimal' }
    : { ...skill, enabled: false, modelProfileId: 'user-profile', reasoningEffortOverride: undefined }));

  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(projectSkillsDir, 'skills.json'), 'utf8')), {
    schemaVersion: 3,
    disabled: [],
    effortOverrides: {review: 'minimal'},
    modelOverrides: {}
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userSkillsDir, 'skills.json'), 'utf8')), {
    schemaVersion: 3,
    disabled: ['unit-test'],
    effortOverrides: {},
    modelOverrides: {'unit-test': 'user-profile'}
  });
});

test('skill manager falls back to enabled on invalid state file', () => {
  const cwd = createTempWorkspace();
  const projectSkillsDir = path.join(cwd, '.echo', 'skills');
  writeSkill(projectSkillsDir, 'known', 'name: known\ndescription: Known skill', '# Known');
  fs.writeFileSync(path.join(projectSkillsDir, 'skills.json'), '{not-json', 'utf8');

  const manager = createSkillManager({ cwd, projectSkillsDir, userSkillsDir: path.join(cwd, 'missing-user') });

  assert.equal(manager.listSkills()[0].enabled, true);
  assert.equal(manager.loadSkill('known').ok, true);
});

test('use_skill handler returns skill content and arguments', async () => {
  const cwd = createTempWorkspace();
  const projectSkillsDir = path.join(cwd, '.echo', 'skills');
  const skillDir = writeSkill(projectSkillsDir, 'code-review', 'name: code-review\ndescription: Review code', '# Code Review\nCheck correctness.');
  writeSkillResource(skillDir, 'reference/checklist.md');
  writeSkillResource(skillDir, 'scripts/collect-diff.sh');
  const handler = createUseSkillToolHandler(createSkillRegistry({ cwd, projectSkillsDir, userSkillsDir: path.join(cwd, 'missing-user') }));
  const executor = createToolExecutor(createToolRegistry([handler]));

  const result = await executor.execute({
    callId: 'call_skill',
    toolName: USE_SKILL_TOOL_NAME,
    argumentsText: JSON.stringify({ name: 'code-review', arguments: 'src/foo.ts' })
  });

  assert.equal(result.ok, true);
  assert.equal(result.toolName, USE_SKILL_TOOL_NAME);
  assert.match(result.text, /skill: code-review/);
  assert.match(result.text, /arguments: src\/foo\.ts/);
  assert.match(result.text, /# Code Review/);
  assert.match(result.text, /\[Skill Resources\]\n- reference\/checklist\.md\n- scripts\/collect-diff\.sh/);
});

test('use_skill handler omits resource section when skill has no resources', async () => {
  const cwd = createTempWorkspace();
  const projectSkillsDir = path.join(cwd, '.echo', 'skills');
  writeSkill(projectSkillsDir, 'known', 'name: known\ndescription: Known skill', '# Known');
  const executor = createToolExecutor(createToolRegistry([
    createUseSkillToolHandler(createSkillRegistry({ cwd, projectSkillsDir, userSkillsDir: path.join(cwd, 'missing-user') }))
  ]));

  const result = await executor.execute({
    callId: 'call_skill',
    toolName: USE_SKILL_TOOL_NAME,
    argumentsText: JSON.stringify({ name: 'known', arguments: null })
  });

  assert.equal(result.ok, true);
  assert.doesNotMatch(result.text, /\[Skill Resources\]/);
});

test('use_skill handler fails for unknown and invalid arguments', async () => {
  const cwd = createTempWorkspace();
  const projectSkillsDir = path.join(cwd, '.echo', 'skills');
  writeSkill(projectSkillsDir, 'known', 'name: known\ndescription: Known skill', '# Known');
  const executor = createToolExecutor(createToolRegistry([
    createUseSkillToolHandler(createSkillRegistry({ cwd, projectSkillsDir, userSkillsDir: path.join(cwd, 'missing-user') }))
  ]));

  const unknown = await executor.execute({
    callId: 'call_unknown',
    toolName: USE_SKILL_TOOL_NAME,
    argumentsText: JSON.stringify({ name: 'missing', arguments: null })
  });
  const invalid = await executor.execute({
    callId: 'call_invalid',
    toolName: USE_SKILL_TOOL_NAME,
    argumentsText: JSON.stringify({ name: '', arguments: 123 })
  });

  assert.equal(unknown.ok, false);
  assert.match(unknown.text, /Unknown skill: missing/);
  assert.match(unknown.text, /- known/);
  assert.equal(invalid.ok, false);
  assert.match(invalid.text, /name must be a non-empty string/);
});

test('use_skill handler fails for disabled skill and lists enabled skills only', async () => {
  const cwd = createTempWorkspace();
  const projectSkillsDir = path.join(cwd, '.echo', 'skills');
  writeSkill(projectSkillsDir, 'disabled', 'name: disabled\ndescription: Disabled skill', '# Disabled Secret');
  writeSkill(projectSkillsDir, 'enabled', 'name: enabled\ndescription: Enabled skill', '# Enabled');
  fs.writeFileSync(path.join(projectSkillsDir, 'skills.json'), JSON.stringify({ schemaVersion: 1, disabled: ['disabled'] }), 'utf8');
  const executor = createToolExecutor(createToolRegistry([
    createUseSkillToolHandler(createSkillManager({ cwd, projectSkillsDir, userSkillsDir: path.join(cwd, 'missing-user') }))
  ]));

  const disabled = await executor.execute({
    callId: 'call_disabled',
    toolName: USE_SKILL_TOOL_NAME,
    argumentsText: JSON.stringify({ name: 'disabled', arguments: null })
  });
  const unknown = await executor.execute({
    callId: 'call_unknown',
    toolName: USE_SKILL_TOOL_NAME,
    argumentsText: JSON.stringify({ name: 'missing', arguments: null })
  });

  assert.equal(disabled.ok, false);
  assert.match(disabled.text, /disabled/i);
  assert.match(disabled.text, /\/skills/);
  assert.doesNotMatch(disabled.text, /\/skills manage/);
  assert.doesNotMatch(disabled.text, /Disabled Secret/);
  assert.match(unknown.text, /- enabled/);
  assert.doesNotMatch(unknown.text, /- disabled/);
});

test('listSkillUseRecords extracts tool and slash skill uses only', () => {
  const records = [
    { role: 'tool_call', text: '', toolCallId: 'call_skill', toolName: USE_SKILL_TOOL_NAME, argumentsText: JSON.stringify({ name: 'review', arguments: 'diff' }), createdAt: '2026-06-09T00:00:00.000Z' },
    { role: 'tool_result', text: '# Review', toolCallId: 'call_skill', toolName: USE_SKILL_TOOL_NAME, ok: true },
    { role: 'tool_call', text: '', toolCallId: 'call_bash', toolName: RUN_BASH_COMMAND_TOOL_NAME, argumentsText: JSON.stringify({ command: 'pwd' }) },
    { role: 'tool_call', text: '', toolCallId: 'call_bad', toolName: USE_SKILL_TOOL_NAME, argumentsText: '{not-json' },
    { role: 'user', text: '[Skill Invocation]', metadata: {skillInvocation: { source: 'slash', skillName: 'unit-test', argumentsText: 'legacy args', userRequestText: 'src/foo.ts', sourceKind: 'project', sourcePath: '/workspace/.echo/skills/unit-test/SKILL.md' }}, createdAt: '2026-06-09T00:01:00.000Z' },
    { role: 'user', text: 'plain user' }
  ];

  assert.deepEqual(listSkillUseRecords(records), [
    {
      source: 'tool',
      skillName: 'review',
      argumentsText: 'diff',
      toolCallId: 'call_skill',
      createdAt: '2026-06-09T00:00:00.000Z'
    },
    {
      source: 'slash',
      skillName: 'unit-test',
      argumentsText: 'src/foo.ts',
      createdAt: '2026-06-09T00:01:00.000Z'
    }
  ]);
});

test('ask_user_questions schema exposes only semantic required fields', () => {
  const handler = createAskUserQuestionsToolHandler();
  const questionSchema = handler.definition.parameters.properties.questions.items;
  const optionSchema = questionSchema.properties.options.items;

  assert.equal(handler.definition.name, ASK_USER_QUESTIONS_TOOL_NAME);
  assert.match(handler.definition.description, /clarification questions/);
  assert.equal(Object.hasOwn(handler.definition, 'strict'), false);
  assert.deepEqual(handler.definition.parameters.required, ['questions']);
  assert.deepEqual(questionSchema.required, ['question', 'options']);
  assert.deepEqual(optionSchema.required, ['label']);
  assert.equal(optionSchema.properties.description.type, 'string');
  assert.equal(questionSchema.properties.multiSelect.type, 'boolean');
  assert.match(questionSchema.properties.multiSelect.description, /Defaults to false/);
});

test('ask_user_questions parser accepts single and multi-select questions while trimming fields', () => {
  const result = parseAskUserQuestionsArgs({
    questions: [
      {
        question: '  Pick one?  ',
        options: [
          { label: '  A  ', description: '  First  ' },
          { label: 'B', description: null }
        ]
      },
      {
        question: '  Pick many?  ',
        multiSelect: true,
        options: [
          { label: '  X  ' },
          { label: 'Y' }
        ]
      }
    ]
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      questions: [
        {
          question: 'Pick one?',
          options: [
            { label: 'A', description: 'First' },
            { label: 'B' }
          ]
        },
        {
          question: 'Pick many?',
          multiSelect: true,
          options: [
            { label: 'X' },
            { label: 'Y' }
          ]
        }
      ]
    }
  });
});

test('ask_user_questions parser rejects invalid arguments', () => {
  assert.deepEqual(parseAskUserQuestionsToolCall({
    callId: 'call_1',
    toolName: ASK_USER_QUESTIONS_TOOL_NAME,
    argumentsText: '{not-json'
  }), { ok: false, message: 'ask_user_questions arguments are not valid JSON' });
  assert.deepEqual(parseAskUserQuestionsToolCall({
    callId: 'call_1',
    toolName: ASK_USER_QUESTIONS_TOOL_NAME,
    argumentsText: '[]'
  }), { ok: false, message: 'ask_user_questions arguments must be a JSON object' });
  assert.deepEqual(parseAskUserQuestionsArgs({ questions: [] }), { ok: false, message: 'questions must be a non-empty array' });
  assert.deepEqual(parseAskUserQuestionsArgs({ questions: [{ question: '', options: [{ label: 'A' }] }] }), {
    ok: false,
    message: 'questions[0].question must be a non-empty string'
  });
  assert.deepEqual(parseAskUserQuestionsArgs({ questions: [{ question: 'Q', options: [] }] }), {
    ok: false,
    message: 'questions[0].options must be a non-empty array'
  });
  assert.deepEqual(parseAskUserQuestionsArgs({ questions: [{ question: 'Q', options: [{ label: '' }] }] }), {
    ok: false,
    message: 'questions[0].options[0].label must be a non-empty string'
  });
  assert.deepEqual(parseAskUserQuestionsArgs({ questions: [{ question: 'Q', multiSelect: 'yes', options: [{ label: 'A' }] }] }), {
    ok: false,
    message: 'questions[0].multiSelect must be a boolean'
  });
});

test('ask_user_questions result builders return structured JSON text for single and multi-select answers', () => {
  const call = {
    callId: 'call_questions',
    toolName: ASK_USER_QUESTIONS_TOOL_NAME,
    argumentsText: '{}'
  };
  const success = createAskUserQuestionsSuccessResult(call, [
    { question: 'Q?', selectedOption: { label: 'A', description: 'Alpha' } },
    { question: 'Many?', multiSelect: true, selectedOptions: [{ label: 'B' }, { label: 'Other' }], customText: 'Custom answer' },
    { question: 'Other?', selectedOption: { label: 'Other' }, customText: 'Single custom' }
  ]);
  const cancelled = createAskUserQuestionsCancelledResult(call, 'No answer');

  assert.equal(success.ok, true);
  assert.deepEqual(JSON.parse(success.text), {
    answers: [
      { index: 0, selected: 'A' },
      { index: 1, multiSelect: true, selectedOptions: ['B', 'Other'], customText: 'Custom answer' },
      { index: 2, selected: 'Other', customText: 'Single custom' }
    ]
  });
  assert.equal(cancelled.ok, false);
  assert.deepEqual(JSON.parse(cancelled.text), { cancelled: true, reason: 'No answer' });
});

test('web_search schema exposes only semantic required fields', () => {
  const handler = createWebSearchToolHandler();

  assert.equal(Object.hasOwn(handler.definition, 'strict'), false);
  assert.deepEqual(handler.definition.parameters.required, ['query']);
  assert.equal(handler.definition.parameters.properties.count.type, 'number');
  assert.equal(handler.definition.parameters.properties.offset.type, 'number');
  assert.equal(handler.definition.parameters.properties.market.type, 'string');
  assert.equal(handler.definition.parameters.properties.safe_search.type, 'string');
});

test('web_fetch schema exposes only semantic required fields', () => {
  const handler = createWebFetchToolHandler();

  assert.equal(Object.hasOwn(handler.definition, 'strict'), false);
  assert.deepEqual(handler.definition.parameters.required, ['url']);
  assert.equal(handler.definition.parameters.properties.offset.type, 'number');
  assert.equal(handler.definition.parameters.properties.limit.type, 'number');
});

test('glob schema exposes only semantic required fields', () => {
  const handler = createGlobToolHandler();

  assert.equal(Object.hasOwn(handler.definition, 'strict'), false);
  assert.deepEqual(handler.definition.parameters.required, ['pattern']);
  assert.equal(handler.definition.parameters.properties.paths.type, 'array');
});

test('grep schema exposes only semantic required fields', () => {
  const handler = createGrepToolHandler();

  assert.equal(Object.hasOwn(handler.definition, 'strict'), false);
  assert.deepEqual(handler.definition.parameters.required, ['pattern']);
  assert.equal(handler.definition.parameters.properties.paths.type, 'array');
  assert.equal(handler.definition.parameters.properties.glob.type, 'string');
  assert.equal(handler.definition.parameters.properties.literal.type, 'boolean');
  assert.equal(handler.definition.parameters.properties.literal.description, 'Defaults to true. Set to false to enable regex search, equivalent to grep -E/rg regex.');
  assert.equal(handler.definition.parameters.properties.case_sensitive.type, 'boolean');
});

test('read_files schema exposes only semantic required fields', () => {
  const handler = createReadFilesToolHandler();
  const itemSchema = handler.definition.parameters.properties.files.items;

  assert.equal(Object.hasOwn(handler.definition, 'strict'), false);
  assert.match(handler.definition.description, /direct children of known directories/);
  assert.match(handler.definition.description, /non-recursive/);
  assert.match(handler.definition.description, /Use glob/);
  assert.match(handler.definition.description, /grep/);
  assert.deepEqual(handler.definition.parameters.required, ['files']);
  assert.deepEqual(itemSchema.required, ['path']);
  assert.equal(itemSchema.properties.offset.type, 'number');
  assert.equal(itemSchema.properties.limit.type, 'number');
});

test('tool executor returns failure results for unknown tools and invalid arguments', async () => {
  const executor = createToolExecutor(createToolRegistry([]));

  assert.deepEqual(
    await executor.execute(createCall({ toolName: 'missing_tool' })),
    {
      callId: 'call_1',
      toolName: 'missing_tool',
      ok: false,
      details: {kind: 'generic'},
      text: 'Unknown tool: missing_tool'
    }
  );

  const bashExecutor = createToolExecutor(createToolRegistry([createBashToolHandler()]));

  assert.deepEqual(
    await bashExecutor.execute(createCall({ argumentsText: '{not-json' })),
    {
      callId: 'call_1',
      toolName: RUN_BASH_COMMAND_TOOL_NAME,
      ok: false,
      details: {kind: 'generic'},
      text: 'Tool arguments are not valid JSON'
    }
  );
  assert.deepEqual(
    await bashExecutor.execute(createCall({ argumentsText: '[]' })),
    {
      callId: 'call_1',
      toolName: RUN_BASH_COMMAND_TOOL_NAME,
      ok: false,
      details: {kind: 'generic'},
      text: 'Tool arguments must be a JSON object'
    }
  );
});

test('tool executor passes execution options to handlers', async () => {
  const controller = new AbortController();
  const change = createRecordingChangeRecorder();
  let receivedOptions = null;
  const handler = {
    definition: {
      name: 'capture_options',
      description: 'Capture executor options',
      parameters: { type: 'object' }
    },
    execute(_args, call, options) {
      receivedOptions = options;
      return {
        callId: call.callId,
        toolName: call.toolName,
        ok: true,
        details: {kind: 'generic'},
        text: 'ok'
      };
    }
  };
  const executor = createToolExecutor(createToolRegistry([handler]));

  const result = await executor.execute({
    callId: 'call_options',
    toolName: 'capture_options',
    argumentsText: '{}'
  }, { abortSignal: controller.signal, changeRecorder: change.recorder });

  assert.equal(result.ok, true);
  assert.equal(receivedOptions.abortSignal, controller.signal);
  assert.equal(receivedOptions.changeRecorder, change.recorder);
});

test('bash tool executes successful non-interactive commands', async () => {
  const executor = createToolExecutor(createToolRegistry([createBashToolHandler({ cwd: process.cwd() })]));
  const result = await executor.execute(createCall({ argumentsText: JSON.stringify({ command: 'printf hello' }) }));

  assert.equal(result.callId, 'call_1');
  assert.equal(result.toolName, RUN_BASH_COMMAND_TOOL_NAME);
  assert.equal(result.ok, true);
  assert.equal(result.details.exitCode, 0);
  assert.equal(result.details.timedOut, false);
  assert.equal(result.details.truncated, false);
  assert.equal(result.text, 'hello');
});

test('bash tool invalidates change history only for commands outside readonly inspection allowlist', async () => {
  const executor = createToolExecutor(createToolRegistry([createBashToolHandler({ cwd: process.cwd() })]));
  const readonlyCommands = ['pwd', 'ls', 'cat package.json', 'find . -maxdepth 0 -type d', 'printf hello'];

  for (const command of readonlyCommands) {
    const readonlyChange = createRecordingChangeRecorder();
    const readonlyResult = await executor.execute(createCall({ argumentsText: JSON.stringify({ command }) }), {changeRecorder: readonlyChange.recorder});

    assert.equal(readonlyResult.ok, true, command);
    assert.deepEqual(readonlyChange.calls.invalidations, [], command);
  }

  const writeLikeChange = createRecordingChangeRecorder();
  const writeLikeResult = await executor.execute(createCall({ argumentsText: JSON.stringify({ command: 'node -e "console.log(1)"' }) }), {changeRecorder: writeLikeChange.recorder});

  assert.equal(writeLikeResult.ok, true);
  assert.equal(writeLikeChange.calls.invalidations.length, 1);
  assert.match(writeLikeChange.calls.invalidations[0], /不可追踪/);
});

test('builtin agent-memory script preserves change history without trusting composed shell commands', () => {
  const scriptPath = require.resolve('../../src/skills/builtin/agent-memory/scripts/memory');

  assert.equal(isChangeHistoryReadonlyBashCommand(`node '${scriptPath}' validate`), true);
  assert.equal(isChangeHistoryReadonlyBashCommand(`node '${scriptPath}' add --catalog 'rules' --content 'can'\\''t; expand'`), true);
  assert.equal(isChangeHistoryReadonlyBashCommand(`node '${scriptPath}' validate; rm file.txt`), false);
  assert.equal(isChangeHistoryReadonlyBashCommand(`node '${scriptPath}' add --catalog rules --content "$(rm file.txt)"`), false);
  assert.equal(isChangeHistoryReadonlyBashCommand('node other-script.js validate'), false);
});

test('shared bash runner captures stdout, stderr, and merged terminal output', async () => {
  const result = await runBashCommand({
    command: 'printf out; printf err >&2',
    cwd: process.cwd()
  });

  assert.equal(result.command, 'printf out; printf err >&2');
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.truncated, false);
  assert.equal(result.stdout, 'out');
  assert.equal(result.stderr, 'err');
  assert.match(result.output, /out/);
  assert.match(result.output, /err/);
  assert.equal(typeof result.durationMs, 'number');
});

test('shared bash runner can retain unbounded output for shell-local transcripts', async () => {
  const output = `head-${'x'.repeat(70_000)}-tail`;
  const result = await runBashCommand({
    command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(`process.stdout.write(${JSON.stringify(output)})`)}`,
    cwd: process.cwd(),
    maxOutputBytes: null
  });

  assert.equal(result.stdout, output);
  assert.equal(result.output, output);
  assert.equal(result.truncated, false);
  assert.equal(result.offloadFilePath, undefined);
});

test('shared bash runner emits bounded stdout and stderr output events', async () => {
  const events = [];
  const result = await runBashCommand({
    command: 'printf stdout; printf stderr >&2',
    cwd: process.cwd(),
    onOutput(event) {
      events.push(event);
    }
  });

  assert.equal(result.stdout, 'stdout');
  assert.equal(result.stderr, 'stderr');
  assert.match(result.output, /stdout/);
  assert.match(result.output, /stderr/);
  assert.equal(events.some((event) => event.stream === 'stdout' && event.chunk.includes('stdout')), true);
  assert.equal(events.some((event) => event.stream === 'stderr' && event.chunk.includes('stderr')), true);

  const truncatedEvents = [];
  const truncated = await runBashCommand({
    command: 'printf 123456789',
    cwd: process.cwd(),
    maxOutputBytes: 5,
    onOutput(event) {
      truncatedEvents.push(event);
    }
  });

  assert.equal(truncated.truncated, true);
  assert.equal(truncated.stdout, '56789');
  assert.equal(truncated.output, '56789');
  assert.equal(truncatedEvents.map((event) => event.chunk).join(''), '12345');
});

test('shared bash runner supports abort without timeout', async () => {
  const controller = new AbortController();
  const script = "process.stdout.write('start'); setInterval(() => {}, 1000);";
  const result = await runBashCommand({
    abortSignal: controller.signal,
    command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
    cwd: process.cwd(),
    onOutput(event) {
      if (event.chunk.includes('start')) {
        controller.abort();
      }
    }
  });

  assert.equal(result.timedOut, false);
  assert.equal(result.output, 'start');
  assert.equal(result.stdout, 'start');
  assert.equal(result.error, 'Command interrupted');
});

test('shared bash runner force kills commands that ignore termination', async () => {
  const controller = new AbortController();
  const script = "process.on('SIGTERM', () => {}); process.stdout.write('start'); setInterval(() => {}, 1000);";
  const result = await runBashCommand({
    abortSignal: controller.signal,
    command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
    cwd: process.cwd(),
    timeoutMs: null,
    onOutput(event) {
      if (event.chunk.includes('start')) {
        controller.abort();
      }
    }
  });

  assert.equal(result.timedOut, false);
  assert.equal(result.output, 'start');
  assert.equal(result.error, 'Command interrupted');
  assert.ok(result.durationMs < 3000);
});

test('shared bash runner force kills timed out commands that ignore termination', async () => {
  const script = "process.on('SIGTERM', () => {}); process.stdout.write('start'); setInterval(() => {}, 1000);";
  const result = await runBashCommand({
    command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
    cwd: process.cwd(),
    timeoutMs: 100
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.output, 'start');
  assert.ok(result.durationMs < 3000);
});

test('shared bash runner reports non-zero exit, timeout, and truncation', async () => {
  const failed = await runBashCommand({
    command: 'printf nope >&2; exit 9',
    cwd: process.cwd()
  });
  const timedOut = await runBashCommand({
    command: 'sleep 1',
    cwd: process.cwd(),
    timeoutMs: 50
  });
  const truncated = await runBashCommand({
    command: 'printf 123456789',
    cwd: process.cwd(),
    maxOutputBytes: 5
  });

  assert.equal(failed.exitCode, 9);
  assert.equal(failed.stderr, 'nope');
  assert.equal(timedOut.timedOut, true);
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.stdout, '56789');
  assert.equal(truncated.output, '56789');
});

test('bash tool reports non-zero exit code as tool failure result', async () => {
  const executor = createToolExecutor(createToolRegistry([createBashToolHandler({ cwd: process.cwd() })]));
  const result = await executor.execute(createCall({
    argumentsText: JSON.stringify({ command: 'printf err >&2; exit 7' })
  }));

  assert.equal(result.ok, false);
  assert.equal(result.details.exitCode, 7);
  assert.equal(result.details.timedOut, false);
  assert.match(result.text, /command: printf err >&2; exit 7/);
  assert.match(result.text, /exit_code: 7/);
  assert.match(result.text, /stderr:\nerr/);
});

test('bash tool times out long-running commands', async () => {
  const executor = createToolExecutor(createToolRegistry([createBashToolHandler({
    cwd: process.cwd(),
    timeoutMs: 50
  })]));
  const result = await executor.execute(createCall({ argumentsText: JSON.stringify({ command: 'sleep 1' }) }));

  assert.equal(result.ok, false);
  assert.equal(result.details.timedOut, true);
  assert.match(result.text, /command: sleep 1/);
  assert.match(result.text, /timed_out: true/);
  assert.match(result.text, /Command timed out/);
});

test('bash tool defaults to no timeout and responds to executor abort signal', async () => {
  const controller = new AbortController();
  const script = "process.stdout.write('start'); setInterval(() => {}, 1000);";
  const executor = createToolExecutor(createToolRegistry([createBashToolHandler({
    cwd: process.cwd()
  })]));
  const pending = executor.execute(createCall({
    argumentsText: JSON.stringify({ command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}` })
  }), { abortSignal: controller.signal });

  setTimeout(() => controller.abort(), 50);
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.details.timedOut, false);
  assert.match(result.text, /command: /);
  assert.match(result.text, /error: Command interrupted/);
});

test('bash tool truncates oversized output', async () => {
  const executor = createToolExecutor(createToolRegistry([createBashToolHandler({
    cwd: process.cwd(),
    maxOutputBytes: 5
  })]));
  const result = await executor.execute(createCall({ argumentsText: JSON.stringify({ command: 'printf 123456789' }) }));

  assert.equal(result.ok, true);
  assert.equal(result.details.truncated, true);
  assert.match(result.text, /command: printf 123456789/);
  assert.match(result.text, /truncated: true/);
  assert.match(result.text, /stdout:\n56789/);
  assert.doesNotMatch(result.text, /stdout:\n123456789/);
});

test('bash runner offloads complete merged output and bash tool returns marker before tail', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-bash-offload-'));
  const cwd = createTempWorkspace();
  const toolResultStore = createToolResultStore({cwd, rootDir});
  const runResult = await runBashCommand({
    command: 'printf 123456789',
    cwd,
    maxOutputBytes: 5,
    toolResultStore
  });
  const executor = createToolExecutor(createToolRegistry([createBashToolHandler({
    cwd,
    maxOutputBytes: 5,
    toolResultStore
  })]));
  const toolResult = await executor.execute(createCall({argumentsText: JSON.stringify({command: 'printf 123456789'})}));
  const markerPath = toolResult.text.match(/\[tool result truncated: ([^\]]+)\]/)?.[1];

  assert.equal(runResult.stdout, '56789');
  assert.equal(runResult.output, '56789');
  assert.equal(fs.readFileSync(runResult.offloadFilePath, 'utf8'), '123456789');
  assert.equal(markerPath.startsWith(rootDir), true);
  assert.equal(fs.readFileSync(markerPath, 'utf8'), '123456789');
  assert.match(toolResult.text, /command: printf 123456789/);
  assert.match(toolResult.text, /exit_code: 0/);
  assert.match(toolResult.text, /\[tool result truncated: [^\]]+\]\n\nstdout:\n56789/);
  assert.doesNotMatch(toolResult.text, /Output was truncated/);
  assert.equal(fs.existsSync(path.join(cwd, 'tool-results')), false);
});

test('bash runner preserves merged stdout and stderr arrival order in the offloaded artifact', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-bash-merged-offload-'));
  const cwd = createTempWorkspace();
  const toolResultStore = createToolResultStore({cwd, rootDir});
  const script = [
    "process.stdout.write('out1\\n');",
    "setTimeout(() => process.stderr.write('err1\\n'), 20);",
    "setTimeout(() => process.stdout.write('out2\\n'), 40);",
    'setTimeout(() => process.exit(0), 60);'
  ].join('');
  const result = await runBashCommand({
    command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
    cwd,
    maxOutputBytes: 5,
    toolResultStore
  });

  assert.equal(result.truncated, true);
  assert.equal(fs.readFileSync(result.offloadFilePath, 'utf8'), 'out1\nerr1\nout2\n');
});

test('bash runner finalizes overflow artifacts after timeout and interruption', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-bash-stop-offload-'));
  const cwd = createTempWorkspace();
  const toolResultStore = createToolResultStore({cwd, rootDir});
  const script = "process.stdout.write('123456789'); setInterval(() => {}, 1000);";
  const timedOut = await runBashCommand({
    command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
    cwd,
    maxOutputBytes: 5,
    timeoutMs: 100,
    toolResultStore
  });
  const controller = new AbortController();
  const interruptedPromise = runBashCommand({
    abortSignal: controller.signal,
    command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
    cwd,
    maxOutputBytes: 5,
    onOutput() {
      controller.abort();
    },
    toolResultStore
  });

  const interrupted = await interruptedPromise;

  assert.equal(timedOut.timedOut, true);
  assert.equal(fs.readFileSync(timedOut.offloadFilePath, 'utf8'), '123456789');
  assert.equal(interrupted.error, 'Command interrupted');
  assert.equal(fs.readFileSync(interrupted.offloadFilePath, 'utf8'), '123456789');
});

test('bash offloading failure keeps a bounded tail without an invalid path', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-bash-offload-failure-'));
  const blockingFile = path.join(rootDir, 'blocked');
  fs.writeFileSync(blockingFile, 'block', 'utf8');
  const toolResultStore = createToolResultStore({cwd: process.cwd(), rootDir: blockingFile});
  const executor = createToolExecutor(createToolRegistry([createBashToolHandler({
    cwd: process.cwd(),
    maxOutputBytes: 5,
    toolResultStore
  })]));
  const result = await executor.execute(createCall({argumentsText: JSON.stringify({command: 'printf 123456789'})}));

  assert.equal(result.details.truncated, true);
  assert.match(result.text, /stdout:\n56789/);
  assert.match(result.text, /Output was truncated/);
  assert.doesNotMatch(result.text, /\[tool result truncated:/);
});

test('read_files reads a text file with line pagination metadata', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'src.txt'), 'zero\none\ntwo\nthree\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd })]));
  const result = await executor.execute(createReadFilesCall([
    { path: 'src.txt', offset: 1, limit: 2 }
  ]));

  assert.equal(result.callId, 'call_read');
  assert.equal(result.toolName, READ_FILES_TOOL_NAME);
  assert.equal(result.ok, true);
  assert.equal(result.details.truncated, false);
  assert.match(result.text, /--- text: src\.txt/);
  assert.match(result.text, /has_more: true/);
  assert.match(result.text, /content:/);
  assert.match(result.text, /```\n2 │ one\n3 │ two\n```/);
  assert.doesNotMatch(result.text, /absolute_path: /);
  assert.doesNotMatch(result.text, /media_type: /);
  assert.doesNotMatch(result.text, /zero/);
  assert.doesNotMatch(result.text, /three/);
});

test('read_files reads multiple files and preserves successful content on partial failure', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'a.md'), '# Title\nbody\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'b.json'), '{"ok":true}\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd })]));
  const result = await executor.execute(createReadFilesCall([
    { path: 'a.md' },
    { path: 'missing.txt' },
    { path: 'b.json', limit: 1 }
  ]));

  assert.equal(result.ok, false);
  assert.doesNotMatch(result.text, /file_count:/);
  assert.match(result.text, /# Title/);
  assert.match(result.text, /error: ENOENT/);
  assert.match(result.text, /\{"ok":true\}/);
});

test('read_files reads from offset to end when limit is omitted', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'all.txt'), 'zero\none\ntwo\nthree\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd })]));
  const result = await executor.execute(createReadFilesCall([
    { path: 'all.txt', offset: 1, limit: null }
  ]));

  assert.equal(result.ok, true);
  assert.match(result.text, /```\n2 │ one\n3 │ two\n4 │ three\n```/);
  assert.doesNotMatch(result.text, /has_more: false/);
  assert.doesNotMatch(result.text, /limit: none/);
  assert.doesNotMatch(result.text, /zero/);
});

test('read_files does not reject large explicit line limits', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'short.txt'), 'only\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd })]));
  const result = await executor.execute(createReadFilesCall([
    { path: 'short.txt', limit: 100_000 }
  ]));

  assert.equal(result.ok, true);
  assert.doesNotMatch(result.text, /limit: 100000/);
  assert.match(result.text, /only/);
});

test('read_files rejects invalid arguments and unsafe paths', async () => {
  const cwd = createTempWorkspace();
  fs.mkdirSync(path.join(cwd, '.git'));
  fs.writeFileSync(path.join(cwd, '.git', 'config'), 'secret', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd, maxFiles: 1 })]));

  assert.match((await executor.execute(createReadFilesCall([]))).text, /files must not be empty/);
  assert.match((await executor.execute(createReadFilesCall([{ path: 'a' }, { path: 'b' }]))).text, /files exceeds 1 entries/);
  assert.match((await executor.execute(createReadFilesCall([{ path: '' }]))).text, /path must be a non-empty string/);
  assert.match((await executor.execute(createReadFilesCall([{ path: 'a', offset: -1 }]))).text, /offset must be a non-negative integer/);
  assert.match((await executor.execute(createReadFilesCall([{ path: 'a', limit: 0 }]))).text, /limit must be a positive integer/);
  assert.match((await executor.execute(createReadFilesCall([{ path: '.git/config' }]))).text, /\.git paths are not allowed/);
  assert.match((await executor.execute(createReadFilesCall([{ path: `bad\0path` }]))).text, /path must not contain NUL/);
});

test('read_files reports unsupported media, content limits, and total output truncation', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'image.bmp'), Buffer.from([0x42, 0x4d, 0x00]));
  fs.writeFileSync(path.join(cwd, 'large.txt'), '1234567890', 'utf8');
  fs.writeFileSync(path.join(cwd, 'long.txt'), 'alpha\nbeta\ngamma\n', 'utf8');

  const limitedExecutor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd, maxFileContentBytes: 5 })]));
  const limitedResult = await limitedExecutor.execute(createReadFilesCall([{ path: 'large.txt' }]));
  assert.equal(limitedResult.ok, true);
  assert.equal(limitedResult.details.truncated, true);
  assert.match(limitedResult.text, /content_truncated: true/);
  assert.match(limitedResult.text, /12345/);
  assert.doesNotMatch(limitedResult.text, /123456/);

  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd })]));
  const imageResult = await executor.execute(createReadFilesCall([{ path: 'image.bmp', offset: 1, limit: 2 }]));
  const truncatingExecutor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd, maxTotalOutputBytes: 50 })]));
  const truncatedResult = await truncatingExecutor.execute(createReadFilesCall([{ path: 'long.txt' }]));

  assert.equal(imageResult.ok, false);
  assert.match(imageResult.text, /--- image: image\.bmp/);
  assert.match(imageResult.text, /error: unsupported media type/);
  assert.doesNotMatch(imageResult.text, /content:\nBM/);
  assert.equal(truncatedResult.details.truncated, true);
  assert.match(truncatedResult.text, /Output was truncated/);
});

test('read_files lists direct directory entries with reusable paths, types, sizes, and stable ordering', async () => {
  const cwd = createTempWorkspace();
  const directory = path.join(cwd, 'dir');
  fs.mkdirSync(path.join(directory, '.git'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'nested'));
  fs.writeFileSync(path.join(directory, '.hidden'), 'h', 'utf8');
  fs.writeFileSync(path.join(directory, 'alpha.txt'), 'alpha', 'utf8');
  fs.writeFileSync(path.join(directory, '.git', 'config'), 'secret', 'utf8');
  fs.symlinkSync('alpha.txt', path.join(directory, 'current'));
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd })]));
  const result = await executor.execute(createReadFilesCall([{ path: 'dir' }]));

  assert.equal(result.ok, true);
  assert.equal(result.details.truncated, false);
  assert.match(result.text, /--- directory: dir/);
  assert.doesNotMatch(result.text, /returned_entries:/);
  assert.doesNotMatch(result.text, /has_more: false/);
  assert.match(result.text, /- dir\/\.hidden; file; size_bytes: 1/);
  assert.match(result.text, /- dir\/alpha\.txt; file; size_bytes: 5/);
  assert.match(result.text, /- dir\/current; symlink/);
  assert.match(result.text, /- dir\/nested; directory/);
  assert.equal(result.text.indexOf('dir/.hidden') < result.text.indexOf('dir/alpha.txt'), true);
  assert.equal(result.text.indexOf('dir/alpha.txt') < result.text.indexOf('dir/current'), true);
  assert.equal(result.text.indexOf('dir/current') < result.text.indexOf('dir/nested'), true);
  assert.doesNotMatch(result.text, /\.git/);
  assert.doesNotMatch(result.text, /secret/);
});

test('read_files paginates directories within the directory entry safety limit', async () => {
  const cwd = createTempWorkspace();
  const directory = path.join(cwd, 'dir');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'a.txt'), 'a', 'utf8');
  fs.writeFileSync(path.join(directory, 'b.txt'), 'bb', 'utf8');
  fs.writeFileSync(path.join(directory, 'c.txt'), 'ccc', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({
    cwd,
    maxDirectoryEntries: 2
  })]));

  const defaultPage = await executor.execute(createReadFilesCall([{ path: 'dir' }]));
  assert.equal(defaultPage.ok, true);
  assert.equal(defaultPage.details.truncated, true);
  assert.match(defaultPage.text, /has_more: true/);
  assert.match(defaultPage.text, /dir\/a\.txt/);
  assert.match(defaultPage.text, /dir\/b\.txt/);
  assert.doesNotMatch(defaultPage.text, /dir\/c\.txt/);

  const explicitPage = await executor.execute(createReadFilesCall([{ path: 'dir', offset: 1, limit: 1 }]));
  assert.equal(explicitPage.ok, true);
  assert.equal(explicitPage.details.truncated, false);
  assert.match(explicitPage.text, /has_more: true/);
  assert.doesNotMatch(explicitPage.text, /dir\/a\.txt/);
  assert.match(explicitPage.text, /dir\/b\.txt/);
  assert.doesNotMatch(explicitPage.text, /dir\/c\.txt/);

  const cappedPage = await executor.execute(createReadFilesCall([{ path: 'dir', limit: 100_000 }]));
  assert.equal(cappedPage.ok, true);
  assert.equal(cappedPage.details.truncated, true);
  assert.match(cappedPage.text, /has_more: true/);
});

test('read_files returns an explicit successful result for empty directories', async () => {
  const cwd = createTempWorkspace();
  fs.mkdirSync(path.join(cwd, 'empty'));
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd })]));
  const result = await executor.execute(createReadFilesCall([{ path: 'empty' }]));

  assert.equal(result.ok, true);
  assert.equal(result.details.truncated, false);
  assert.doesNotMatch(result.text, new RegExp(`effective_limit: ${DEFAULT_MAX_DIRECTORY_ENTRIES}`));
  assert.doesNotMatch(result.text, /has_more: false/);
  assert.match(result.text, /entries:\n\(empty\)/);
});

test('read_files preserves directory and file results in mixed batches with failures', async () => {
  const cwd = createTempWorkspace();
  fs.mkdirSync(path.join(cwd, 'dir'));
  fs.writeFileSync(path.join(cwd, 'dir', 'child.txt'), 'child', 'utf8');
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'note\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd })]));
  const result = await executor.execute(createReadFilesCall([
    { path: 'dir' },
    { path: 'missing' },
    { path: 'note.txt' }
  ]));

  assert.equal(result.ok, false);
  assert.doesNotMatch(result.text, /file_count:/);
  assert.match(result.text, /--- directory: dir/);
  assert.match(result.text, /dir\/child\.txt/);
  assert.match(result.text, /error: ENOENT/);
  assert.match(result.text, /content:\n```\n1 │ note\n```/);
});

test('read_files applies the total output cap to directory results', async () => {
  const cwd = createTempWorkspace();
  const directory = path.join(cwd, 'dir');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'a-very-long-file-name-for-output-truncation.txt'), 'content', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({
    cwd,
    maxTotalOutputBytes: 60
  })]));
  const result = await executor.execute(createReadFilesCall([{ path: 'dir' }]));

  assert.equal(result.ok, true);
  assert.equal(result.details.truncated, true);
  assert.match(result.text, /Output was truncated/);
});

test('read_files attaches supported images without exposing base64 in text', async () => {
  const cwd = createTempWorkspace();
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  fs.writeFileSync(path.join(cwd, 'image.png'), imageBytes);
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'hello\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd })]));
  const result = await executor.execute(createReadFilesCall([
    { path: 'image.png', offset: 1, limit: 2 },
    { path: 'missing.jpg' },
    { path: 'note.txt' }
  ]));

  assert.equal(result.ok, false);
  assert.equal(result.details.truncated, false);
  assert.deepEqual(result.attachments, [{
    kind: 'image',
    mediaType: 'image/png',
    dataBase64: imageBytes.toString('base64'),
    path: 'image.png',
    sizeBytes: imageBytes.length
  }]);
  assert.doesNotMatch(result.text, /file_count: 3/);
  assert.match(result.text, /image_attached: true/);
  assert.doesNotMatch(result.text, /offset_limit_ignored: true/);
  assert.match(result.text, /error: ENOENT/);
  assert.match(result.text, /hello/);
  assert.doesNotMatch(result.text, new RegExp(imageBytes.toString('base64')));
});

test('read_files rejects oversized images without creating partial attachments', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'large.webp'), Buffer.from([0x01, 0x02, 0x03, 0x04]));
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({autoCompressImages: false, cwd, maxImageBytes: 3})]));
  const result = await executor.execute(createReadFilesCall([{ path: 'large.webp' }]));

  assert.equal(result.ok, false);
  assert.equal(result.attachments, undefined);
  assert.match(result.text, /image exceeds max size/);
});

test('read_files automatically compresses oversized images and reports output metadata', async () => {
  const cwd = createTempWorkspace();
  const width = 256;
  const height = 256;
  const pixels = Buffer.alloc(width * height * 3);

  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = (index * 31 + Math.floor(index / 7)) & 0xff;
  }

  const imageBytes = await sharp(pixels, {raw: {width, height, channels: 3}}).png().toBuffer();
  fs.writeFileSync(path.join(cwd, 'large.png'), imageBytes);
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({cwd, maxImageBytes: 2_000})]));
  const result = await executor.execute(createReadFilesCall([{path: 'large.png'}]));

  assert.equal(result.ok, true);
  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0].path, 'large.png');
  assert.equal(result.attachments[0].mediaType, 'image/png');
  assert.ok(result.attachments[0].sizeBytes <= 2_000);
  assert.match(result.text, new RegExp(`original_size_bytes: ${imageBytes.length}`));
  assert.match(result.text, /image_compressed: true/);
  assert.match(result.text, new RegExp(`size_bytes: ${result.attachments[0].sizeBytes}`));
  assert.equal(result.text.includes(result.attachments[0].dataBase64), false);
});

test('read_files extracts PDF text without exposing binary or attachments', async () => {
  const cwd = createTempWorkspace();
  const rootDir = createTempWorkspace();
  const pdfBytes = createPdfFixture('Hello PDF World');
  fs.writeFileSync(path.join(cwd, 'doc.pdf'), pdfBytes);
  const toolResultStore = createToolResultStore({ cwd, rootDir });
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd, toolResultStore })]));
  const result = await executor.execute(createReadFilesCall([{ path: 'doc.pdf' }]));

  assert.equal(result.ok, true);
  assert.equal(result.details.truncated, false);
  assert.equal(result.attachments, undefined);
  assert.match(result.text, /--- pdf: doc\.pdf/);
  assert.match(result.text, /pages: 1/);
  assert.match(result.text, /pages_with_text: 1/);
  assert.doesNotMatch(result.text, /content_truncated: false/);
  assert.doesNotMatch(result.text, /text_items:/);
  assert.doesNotMatch(result.text, /has_more:/);
  assert.match(result.text, /extracted_text:\n```\nHello PDF World\n```/);
  assert.doesNotMatch(result.text, /%PDF-1\.4/);
  assert.doesNotMatch(result.text, new RegExp(pdfBytes.toString('base64').slice(0, 16)));
  assert.equal(fs.existsSync(path.join(rootDir, 'projects')), false);
});

test('read_files defaults PDF previews to 64 KiB without changing its general output cap', () => {
  assert.equal(DEFAULT_MAX_PDF_OUTPUT_BYTES, 65_536);
  assert.equal(DEFAULT_READ_FILES_MAX_TOTAL_OUTPUT_BYTES, 256_000);
});

test('read_files offloads oversized PDF formatted text and supports exact artifact rereads', async () => {
  const rootDir = createTempWorkspace();
  const cwd = path.join(rootDir, 'workspace');
  const pdfItems = ['PDF_HEAD', ...Array.from({ length: 40 }, (_, index) => `item-${index}-${'x'.repeat(12)}`), 'PDF_TAIL'];
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, 'large.pdf'), createPdfFixtureWithTextItems(pdfItems));

  const baselineExecutor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({
    cwd,
    maxTotalOutputBytes: 10_000
  })]));
  const baseline = await baselineExecutor.execute(createReadFilesCall([{ path: 'large.pdf' }]));
  const toolResultStore = createToolResultStore({ cwd, rootDir });
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({
    cwd,
    maxPdfOutputBytes: 120,
    toolResultStore
  })]));
  const result = await executor.execute(createReadFilesCall([{ path: 'large.pdf' }]));
  const artifactPath = extractToolResultMarkerPath(result.text);

  assert.equal(result.ok, true);
  assert.equal(result.details.truncated, true);
  assert.match(result.text, /^--- pdf: large\.pdf\npages: 1\npages_with_text: 1/);
  assert.equal(result.text.endsWith(`[tool result truncated: ${artifactPath}]`), true);
  assert.doesNotMatch(result.text, /PDF_TAIL/);
  assert.equal(fs.readFileSync(artifactPath, 'utf8'), baseline.text);

  const reread = await baselineExecutor.execute(createReadFilesCall([{ path: artifactPath }]));
  assert.equal(reread.ok, true);
  assert.match(reread.text, /PDF_HEAD/);
  assert.match(reread.text, /PDF_TAIL/);
});

test('read_files PDF offloading keeps UTF-8 preview boundaries intact', async () => {
  const rootDir = createTempWorkspace();
  const cwd = path.join(rootDir, 'workspace');
  const toolResultStore = createToolResultStore({ cwd, rootDir });
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, '你.pdf'), createPdfFixture('UTF8 boundary PDF text'));
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({
    cwd,
    maxPdfOutputBytes: 100,
    maxTotalOutputBytes: 10,
    toolResultStore
  })]));
  const result = await executor.execute(createReadFilesCall([{ path: '你.pdf' }]));
  const artifactPath = extractToolResultMarkerPath(result.text);

  assert.equal(result.ok, true);
  assert.equal(result.details.truncated, true);
  assert.equal(result.text.startsWith('--- pdf: \n\n[tool result truncated: '), true);
  assert.doesNotMatch(result.text, /\uFFFD/);
  assert.match(fs.readFileSync(artifactPath, 'utf8'), /--- pdf: 你\.pdf/);
});

test('read_files PDF offloading failure falls back to a bounded head without changing success', async () => {
  const rootDir = createTempWorkspace();
  const cwd = path.join(rootDir, 'workspace');
  const blockingFile = path.join(rootDir, 'not-a-directory');
  fs.mkdirSync(cwd);
  fs.writeFileSync(blockingFile, 'block', 'utf8');
  fs.writeFileSync(path.join(cwd, 'large.pdf'), createPdfFixtureWithTextItems(['HEAD', ...Array.from({ length: 20 }, (_, index) => `item-${index}-${'x'.repeat(12)}`), 'TAIL']));
  const toolResultStore = createToolResultStore({ cwd, rootDir: blockingFile });
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({
    cwd,
    maxPdfOutputBytes: 80,
    toolResultStore
  })]));
  const result = await executor.execute(createReadFilesCall([{ path: 'large.pdf' }]));

  assert.equal(result.ok, true);
  assert.equal(result.details.truncated, true);
  assert.match(result.text, /^--- pdf: large\.pdf\npages: 1/);
  assert.match(result.text, /Output was truncated\.$/);
  assert.doesNotMatch(result.text, /tool result truncated/);
  assert.doesNotMatch(result.text, /_TAIL/);
});

test('read_files ignores PDF offset and limit without treating them as pages', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'doc.pdf'), createPdfFixture('Offset Limit Ignored'));
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd })]));
  const result = await executor.execute(createReadFilesCall([{ path: 'doc.pdf', offset: 9, limit: 1 }]));

  assert.equal(result.ok, true);
  assert.doesNotMatch(result.text, /offset: 9/);
  assert.doesNotMatch(result.text, /limit: 1/);
  assert.match(result.text, /pages: 1/);
  assert.match(result.text, /Offset Limit Ignored/);
});

test('read_files reports PDF extraction failures and size limits clearly', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'empty.pdf'), createPdfFixture(''));
  fs.writeFileSync(path.join(cwd, 'broken.pdf'), Buffer.from('%PDF-1.4\nbroken'));
  fs.writeFileSync(path.join(cwd, 'large.pdf'), createPdfFixture('Oversized'));
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd })]));
  const limitedExecutor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd, maxPdfBytes: 3 })]));

  const emptyResult = await executor.execute(createReadFilesCall([{ path: 'empty.pdf' }]));
  const brokenResult = await executor.execute(createReadFilesCall([{ path: 'broken.pdf' }]));
  const largeResult = await limitedExecutor.execute(createReadFilesCall([{ path: 'large.pdf' }]));

  assert.equal(emptyResult.ok, false);
  assert.equal(emptyResult.attachments, undefined);
  assert.match(emptyResult.text, /--- pdf: empty\.pdf/);
  assert.match(emptyResult.text, /no extractable text/);
  assert.match(emptyResult.text, /OCR and page rendering are not supported/);
  assert.equal(brokenResult.ok, false);
  assert.match(brokenResult.text, /PDF text extraction failed/);
  assert.equal(largeResult.ok, false);
  assert.match(largeResult.text, /PDF exceeds max size/);
});

test('read_files preserves PDF text, text files, and image attachments in mixed batches', async () => {
  const cwd = createTempWorkspace();
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  fs.writeFileSync(path.join(cwd, 'doc.pdf'), createPdfFixture('Batch PDF Text'));
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'plain text\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'image.png'), imageBytes);
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd })]));
  const result = await executor.execute(createReadFilesCall([
    { path: 'doc.pdf' },
    { path: 'missing.pdf' },
    { path: 'note.txt' },
    { path: 'image.png' }
  ]));

  assert.equal(result.ok, false);
  assert.deepEqual(result.attachments, [{
    kind: 'image',
    mediaType: 'image/png',
    dataBase64: imageBytes.toString('base64'),
    path: 'image.png',
    sizeBytes: imageBytes.length
  }]);
  assert.doesNotMatch(result.text, /file_count: 4/);
  assert.match(result.text, /Batch PDF Text/);
  assert.match(result.text, /error: ENOENT/);
  assert.match(result.text, /plain text/);
  assert.match(result.text, /image_attached: true/);
  assert.ok(result.text.indexOf('Batch PDF Text') < result.text.indexOf('error: ENOENT'));
  assert.ok(result.text.indexOf('error: ENOENT') < result.text.indexOf('plain text'));
  assert.ok(result.text.indexOf('plain text') < result.text.indexOf('image_attached: true'));
});

test('read_files can read a limited slice from a large text file', async () => {
  const cwd = createTempWorkspace();
  const lines = Array.from({ length: 2000 }, (_, index) => `line-${index}`);
  fs.writeFileSync(path.join(cwd, 'large.txt'), `${lines.join('\n')}\n`, 'utf8');
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd, maxFileContentBytes: 32 })]));
  const result = await executor.execute(createReadFilesCall([
    { path: 'large.txt', offset: 1500, limit: 2 }
  ]));

  assert.equal(result.ok, true);
  assert.equal(result.details.truncated, false);
  assert.match(result.text, /has_more: true/);
  assert.match(result.text, /1501 │ line-1500\n1502 │ line-1501/);
  assert.doesNotMatch(result.text, /line-1499/);
});

test('read_files reports empty line range without line zero', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'empty.txt'), '', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createReadFilesToolHandler({ cwd })]));
  const result = await executor.execute(createReadFilesCall([
    { path: 'empty.txt' }
  ]));

  assert.equal(result.ok, true);
  assert.match(result.text, /content:\n```\n```/);
  assert.doesNotMatch(result.text, /start_line:/);
  assert.doesNotMatch(result.text, /0 │/);
});

test('web_fetch defaults model-visible output to 64 KiB', () => {
  assert.equal(DEFAULT_WEB_FETCH_MAX_TOTAL_OUTPUT_BYTES, 65_536);
});

test('web_fetch rejects invalid arguments and unsafe URLs', async () => {
  const executor = createToolExecutor(createToolRegistry([createWebFetchToolHandler({ fetch: createFakeFetch({}), maxUrlBytes: 64 })]));
  const longUrl = `https://example.com/${'x'.repeat(80)}`;
  const cases = [
    [{ url: '', offset: null, limit: null }, /url must be a non-empty string/],
    [{ url: '/relative', offset: null, limit: null }, /absolute HTTP\(S\) URL/],
    [{ url: 'file:///tmp/a.txt', offset: null, limit: null }, /protocol must be http or https/],
    [{ url: 'https://user:pass@example.com/', offset: null, limit: null }, /credentials are not allowed/],
    [{ url: 'http://localhost/', offset: null, limit: null }, /host is not allowed/],
    [{ url: 'http://127.0.0.1/', offset: null, limit: null }, /host is not allowed/],
    [{ url: 'http://169.254.169.254/', offset: null, limit: null }, /host is not allowed/],
    [{ url: 'http://0.0.0.0/', offset: null, limit: null }, /host is not allowed/],
    [{ url: 'http://224.0.0.1/', offset: null, limit: null }, /host is not allowed/],
    [{ url: 'http://[::1]/', offset: null, limit: null }, /host is not allowed/],
    [{ url: 'https://example.com/', offset: -1, limit: null }, /offset must be a non-negative integer/],
    [{ url: 'https://example.com/', offset: null, limit: 0 }, /limit must be a positive integer/],
    [{ url: longUrl, offset: null, limit: null }, /url exceeds 64 bytes/]
  ];

  for (const [args, expected] of cases) {
    const result = await executor.execute(createWebFetchCall(args));

    assert.equal(result.ok, false, JSON.stringify(args));
    assert.match(result.text, expected, JSON.stringify(args));
  }
});

test('web_fetch fetches text, JSON, and HTML with pagination metadata', async () => {
  const fetchFn = createFakeFetch({
    'https://example.com/text': {
      body: 'zero\none\ntwo\nthree\n',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      status: 200,
      statusText: 'OK'
    },
    'https://example.com/data.json': {
      body: '{"ok":true}\n',
      headers: { 'content-type': 'application/json' },
      status: 200
    },
    'https://example.com/page': {
      body: '<html><head><title>A &amp; B</title><script>bad()</script></head><body><h1>Hello&nbsp;World</h1><p>First<br>Second</p></body></html>',
      headers: { 'content-type': 'text/html' },
      status: 200
    }
  });
  const executor = createToolExecutor(createToolRegistry([createWebFetchToolHandler({ fetch: fetchFn })]));
  const textResult = await executor.execute(createWebFetchCall({ url: 'https://example.com/text', offset: 1, limit: 2 }));
  const jsonResult = await executor.execute(createWebFetchCall({ url: 'https://example.com/data.json', offset: null, limit: null }));
  const htmlResult = await executor.execute(createWebFetchCall({ url: 'https://example.com/page', offset: 0, limit: 10 }));

  assert.equal(textResult.callId, 'call_web');
  assert.equal(textResult.toolName, WEB_FETCH_TOOL_NAME);
  assert.equal(textResult.ok, true);
  assert.equal(textResult.details.truncated, false);
  assert.match(textResult.text, /^https:\/\/example\.com\/text/m);
  assert.match(textResult.text, /status: 200 OK/);
  assert.match(textResult.text, /has_more: true/);
  assert.doesNotMatch(textResult.text, /content_type: text\/plain/);
  assert.doesNotMatch(textResult.text, /offset: 1/);
  assert.doesNotMatch(textResult.text, /truncated: false/);
  assert.match(textResult.text, /```\none\ntwo\n```/);
  assert.doesNotMatch(textResult.text, /zero/);
  assert.match(jsonResult.text, /\{"ok":true\}/);
  assert.match(htmlResult.text, /A & B/);
  assert.match(htmlResult.text, /Hello World/);
  assert.match(htmlResult.text, /First\nSecond/);
  assert.doesNotMatch(htmlResult.text, /bad\(\)/);
  assert.equal(fetchFn.calls[0].init.method, 'GET');
  assert.equal(fetchFn.calls[0].init.redirect, 'manual');
});

test('web_fetch handles redirects and rejects unsafe redirect targets', async () => {
  const fetchFn = createFakeFetch({
    'https://example.com/start': {
      body: '',
      headers: { location: '/final' },
      status: 302
    },
    'https://example.com/final': {
      body: 'done',
      headers: { 'content-type': 'text/plain' },
      status: 200
    },
    'https://example.com/unsafe': {
      body: '',
      headers: { location: 'http://127.0.0.1/secret' },
      status: 302
    },
    'https://example.com/loop': {
      body: '',
      headers: { location: '/loop' },
      status: 302
    }
  });
  const executor = createToolExecutor(createToolRegistry([createWebFetchToolHandler({ fetch: fetchFn, maxRedirects: 1 })]));
  const redirectedResult = await executor.execute(createWebFetchCall({ url: 'https://example.com/start', offset: null, limit: null }));
  const unsafeResult = await executor.execute(createWebFetchCall({ url: 'https://example.com/unsafe', offset: null, limit: null }));
  const loopResult = await executor.execute(createWebFetchCall({ url: 'https://example.com/loop', offset: null, limit: null }));

  assert.equal(redirectedResult.ok, true);
  assert.match(redirectedResult.text, /final_url: https:\/\/example\.com\/final/);
  assert.doesNotMatch(redirectedResult.text, /redirected: true/);
  assert.match(redirectedResult.text, /done/);
  assert.equal(unsafeResult.ok, false);
  assert.match(unsafeResult.text, /redirect target rejected/);
  assert.match(unsafeResult.text, /host is not allowed/);
  assert.equal(loopResult.ok, false);
  assert.match(loopResult.text, /redirect limit exceeded \(1\)/);
});

test('web_fetch reports HTTP errors, timeout, body caps, output caps, and unsupported media', async () => {
  const abortError = new Error('aborted');
  abortError.name = 'AbortError';
  const fetchFn = createFakeFetch({
    'https://example.com/missing': {
      body: 'not found',
      headers: { 'content-type': 'text/plain' },
      status: 404,
      statusText: 'Not Found'
    },
    'https://example.com/timeout': abortError,
    'https://example.com/large': {
      body: '1234567890',
      headers: { 'content-type': 'text/plain' },
      status: 200
    },
    'https://example.com/image': {
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      headers: { 'content-type': 'image/png' },
      status: 200
    },
    'https://example.com/verbose': {
      body: 'alpha\nbeta\ngamma\ndelta',
      headers: { 'content-type': 'text/plain' },
      status: 200
    }
  });
  const executor = createToolExecutor(createToolRegistry([createWebFetchToolHandler({
    fetch: fetchFn,
    maxResponseBytes: 5,
    timeoutMs: 10
  })]));
  const missingResult = await executor.execute(createWebFetchCall({ url: 'https://example.com/missing', offset: null, limit: null }));
  const timeoutResult = await executor.execute(createWebFetchCall({ url: 'https://example.com/timeout', offset: null, limit: null }));
  const largeResult = await executor.execute(createWebFetchCall({ url: 'https://example.com/large', offset: null, limit: null }));
  const imageResult = await executor.execute(createWebFetchCall({ url: 'https://example.com/image', offset: null, limit: null }));
  const truncatingExecutor = createToolExecutor(createToolRegistry([createWebFetchToolHandler({
    fetch: fetchFn,
    maxResponseBytes: 100,
    maxTotalOutputBytes: 60
  })]));
  const verboseResult = await truncatingExecutor.execute(createWebFetchCall({ url: 'https://example.com/verbose', offset: null, limit: null }));

  assert.equal(missingResult.ok, false);
  assert.match(missingResult.text, /status: 404 Not Found/);
  assert.match(missingResult.text, /not f/);
  assert.equal(timeoutResult.ok, false);
  assert.equal(timeoutResult.details.timedOut, true);
  assert.match(timeoutResult.text, /request timed out after 10ms/);
  assert.equal(largeResult.ok, true);
  assert.equal(largeResult.details.truncated, true);
  assert.match(largeResult.text, /body_truncated: true/);
  assert.match(largeResult.text, /12345/);
  assert.doesNotMatch(largeResult.text, /123456/);
  assert.equal(imageResult.ok, false);
  assert.match(imageResult.text, /unsupported media type/);
  assert.match(imageResult.text, /content_type: image\/png/);
  assert.doesNotMatch(imageResult.text, /PNG/);
  assert.equal(verboseResult.details.truncated, true);
  assert.match(verboseResult.text, /Output was truncated/);
});

test('web_fetch offloads the complete formatted result and keeps a UTF-8 head preview', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-web-offload-'));
  const toolResultStore = createToolResultStore({cwd: process.cwd(), rootDir});
  const body = `开头\n${'你'.repeat(50)}\n结尾`;
  const fetchFn = createFakeFetch({
    'https://example.com/offload': {
      body,
      headers: {'content-type': 'text/plain'},
      status: 200
    }
  });
  const executor = createToolExecutor(createToolRegistry([createWebFetchToolHandler({
    fetch: fetchFn,
    maxResponseBytes: 1000,
    maxTotalOutputBytes: 70,
    toolResultStore
  })]));
  const result = await executor.execute(createWebFetchCall({url: 'https://example.com/offload'}));
  const markerPath = result.text.match(/\[tool result truncated: ([^\]]+)\]$/)?.[1];
  const artifact = fs.readFileSync(markerPath, 'utf8');

  assert.equal(result.details.truncated, true);
  assert.equal(result.text.startsWith('https://example.com/offload'), true);
  assert.doesNotMatch(result.text, /\uFFFD/);
  assert.doesNotMatch(result.text, /Output was truncated/);
  assert.match(artifact, /^https:\/\/example\.com\/offload\nstatus: 200/);
  assert.match(artifact, /结尾/);
});

test('web_fetch offloading failure falls back to the existing bounded head', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-web-offload-failure-'));
  const blockingFile = path.join(rootDir, 'blocked');
  fs.writeFileSync(blockingFile, 'block', 'utf8');
  const toolResultStore = createToolResultStore({cwd: process.cwd(), rootDir: blockingFile});
  const fetchFn = createFakeFetch({
    'https://example.com/offload-failure': {
      body: 'x'.repeat(200),
      headers: {'content-type': 'text/plain'},
      status: 200
    }
  });
  const executor = createToolExecutor(createToolRegistry([createWebFetchToolHandler({
    fetch: fetchFn,
    maxResponseBytes: 1000,
    maxTotalOutputBytes: 60,
    toolResultStore
  })]));
  const result = await executor.execute(createWebFetchCall({url: 'https://example.com/offload-failure'}));

  assert.equal(result.details.truncated, true);
  assert.match(result.text, /Output was truncated/);
  assert.doesNotMatch(result.text, /\[tool result truncated:/);
});

test('web_fetch reports parent abort as cancellation without timeout', async () => {
  const controller = new AbortController();
  const fetchFn = async (_url, init) => {
    return new Promise((_resolve, reject) => {
      const rejectAbort = () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      };

      if (init.signal.aborted) {
        rejectAbort();
        return;
      }

      init.signal.addEventListener('abort', rejectAbort, { once: true });
    });
  };
  const executor = createToolExecutor(createToolRegistry([createWebFetchToolHandler({
    fetch: fetchFn,
    timeoutMs: 1000
  })]));
  const pending = executor.execute(createWebFetchCall({ url: 'https://example.com/slow', offset: null, limit: null }), {
    abortSignal: controller.signal
  });

  controller.abort();
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.details.timedOut, false);
  assert.match(result.text, /request cancelled/);
});

test('web_search rejects invalid arguments without fetching', async () => {
  let fetchCalls = 0;
  const fetchFn = async () => {
    fetchCalls += 1;
    throw new Error('should not fetch');
  };
  const executor = createToolExecutor(createToolRegistry([createWebSearchToolHandler({ fetch: fetchFn, maxQueryBytes: 16 })]));
  const cases = [
    [{ query: '', count: null, offset: null, market: null, safe_search: null }, /query must be a non-empty string/],
    [{ query: 'x'.repeat(20), count: null, offset: null, market: null, safe_search: null }, /query exceeds 16 bytes/],
    [{ query: 'echo tui', count: 0, offset: null, market: null, safe_search: null }, /count must be a positive integer/],
    [{ query: 'echo tui', count: null, offset: -1, market: null, safe_search: null }, /offset must be a non-negative integer/],
    [{ query: 'echo tui', count: null, offset: null, market: 'english', safe_search: null }, /market must be a locale like en-US/],
    [{ query: 'echo tui', count: null, offset: null, market: null, safe_search: 'unsafe' }, /safe_search must be off, moderate, or strict/]
  ];

  for (const [args, expected] of cases) {
    const result = await executor.execute(createWebSearchCall(args));

    assert.equal(result.ok, false, JSON.stringify(args));
    assert.equal(result.details.timedOut, false);
    assert.equal(result.details.truncated, false);
    assert.match(result.text, expected, JSON.stringify(args));
  }

  assert.equal(fetchCalls, 0);
});

test('web_search fetches Bing HTML and returns filtered natural results', async () => {
  const wrappedUrl = `https://www.bing.com/ck/a?u=a1${Buffer.from('https://wrapped.example.com/article?x=1', 'utf8').toString('base64url')}`;
  const fetchFn = createFakeFetch({
    [createBingSearchFixtureUrl('echo tui', { count: 3, first: 3, market: 'en-US', safeSearch: 'Strict' })]: {
      body: `
        <html><body>
          <ol id="b_results">
            <li class="b_algo"><h2><a href="https://example.com/a#section">Echo &amp; TUI</a></h2><p>First&nbsp;snippet<br>with tags.</p></li>
            <li class="b_algo"><h2><a href="${wrappedUrl}">Wrapped Result</a></h2><p>Wrapped &quot;snippet&quot;.</p></li>
            <li class="b_algo"><h2><a href="https://www.bing.com/search?q=internal">Internal</a></h2><p>Skip me.</p></li>
            <li class="b_algo"><h2><a href="javascript:alert(1)">Bad</a></h2><p>Skip me.</p></li>
            <li class="b_algo"><h2><a href="https://example.com/a">Duplicate</a></h2><p>Skip duplicate.</p></li>
          </ol>
        </body></html>
      `,
      headers: { 'content-type': 'text/html' },
      status: 200
    }
  });
  const executor = createToolExecutor(createToolRegistry([createWebSearchToolHandler({ fetch: fetchFn, maxResults: 4 })]));
  const result = await executor.execute(createWebSearchCall({
    query: ' echo tui ',
    count: 3,
    offset: 2,
    market: 'en-US',
    safe_search: 'Strict'
  }));

  assert.equal(result.callId, 'call_search');
  assert.equal(result.toolName, WEB_SEARCH_TOOL_NAME);
  assert.equal(result.ok, true);
  assert.equal(result.details.timedOut, false);
  assert.equal(result.details.truncated, false);
  assert.doesNotMatch(result.text, /^query: /m);
  assert.doesNotMatch(result.text, /^count: /m);
  assert.doesNotMatch(result.text, /^offset: /m);
  assert.doesNotMatch(result.text, /^market: /m);
  assert.doesNotMatch(result.text, /^safe_search: /m);
  assert.doesNotMatch(result.text, /^has_more: /m);
  assert.match(result.text, /1\. Echo & TUI/);
  assert.match(result.text, /url: https:\/\/example\.com\/a/);
  assert.doesNotMatch(result.text, /relevance_score:/);
  assert.doesNotMatch(result.text, /#section/);
  assert.match(result.text, /snippet: First snippet with tags\./);
  assert.match(result.text, /2\. Wrapped Result/);
  assert.match(result.text, /url: https:\/\/wrapped\.example\.com\/article\?x=1/);
  assert.match(result.text, /snippet: Wrapped "snippet"\./);
  assert.doesNotMatch(result.text, /Internal/);
  assert.doesNotMatch(result.text, /Bad/);
  assert.doesNotMatch(result.text, /Duplicate/);
  assert.equal(fetchFn.calls[0].init.method, 'GET');
  assert.equal(fetchFn.calls[0].init.redirect, 'follow');
  assert.equal(fetchFn.calls[0].url.includes('&ensearch=1&safeSearch=Strict'), true);
  assert.equal(fetchFn.calls[0].init.headers['Accept-Language'], 'en-US,en;q=0.8');
  assert.match(fetchFn.calls[0].init.headers['User-Agent'], /Mozilla\/5\.0/);
  assert.equal('Cookie' in fetchFn.calls[0].init.headers, false);
});

test('web_search preserves multi-term query parameters', async () => {
  const fetchFn = createFakeFetch({
    [createBingSearchFixtureUrl('Echo TUI GitHub')]: {
      body: createBingResultsPage([
        { title: 'Echo TUI GitHub', url: 'https://github.com/example/echo-tui', snippet: 'Echo TUI project on GitHub.' }
      ]),
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    [createBingSearchFixtureUrl('Example Editor 官方文档')]: {
      body: createBingResultsPage([
        { title: 'Example Editor 官方文档', url: 'https://docs.example.com/editor', snippet: 'Example Editor 官网文档。' }
      ]),
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    [createBingSearchFixtureUrl('site:github.com echo tui')]: {
      body: createBingResultsPage([
        { title: 'echo tui github', url: 'https://github.com/example/echo-tui', snippet: 'Repository for echo tui.' }
      ]),
      headers: { 'content-type': 'text/html' },
      status: 200
    }
  });
  const executor = createWebSearchExecutor(fetchFn);

  assert.equal((await executor.execute(createWebSearchCall({ query: 'Echo TUI GitHub' }))).ok, true);
  assert.equal((await executor.execute(createWebSearchCall({ query: 'Example Editor 官方文档' }))).ok, true);
  assert.equal((await executor.execute(createWebSearchCall({ query: 'site:github.com echo tui' }))).ok, true);

  assert.equal(new URL(fetchFn.calls[0].url).searchParams.get('q'), 'Echo TUI GitHub');
  assert.equal(new URL(fetchFn.calls[1].url).searchParams.get('q'), 'Example Editor 官方文档');
  assert.equal(new URL(fetchFn.calls[2].url).searchParams.get('q'), 'site:github.com echo tui');
});

test('web_search tries Bing English search only after localized Latin query quality stays low', async () => {
  const fetchFn = createFakeFetch({
    [createBingSearchFixtureUrl('DeepSeek API streaming official docs', { market: 'zh-CN' })]: {
      body: createBingResultsPage([
        { title: 'DeepSeek | 深度求索', url: 'https://www.deepseek.com/', snippet: 'DeepSeek 官方首页。' }
      ]),
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    [createBingSearchFixtureUrl('DeepSeek API streaming official docs', { englishSearch: true, market: 'zh-CN' })]: {
      body: createBingResultsPage([
        { title: 'Streaming | DeepSeek API Docs', url: 'https://api-docs.deepseek.com/guides/streaming', snippet: 'Official DeepSeek API streaming docs.' }
      ]),
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    [createBingSearchFixtureUrl('Example Editor 官方文档', { market: 'zh-CN' })]: {
      body: createBingResultsPage([
        { title: 'Example Editor 官方文档', url: 'https://docs.example.com/editor', snippet: 'Example Editor 官方文档。' }
      ]),
      headers: { 'content-type': 'text/html' },
      status: 200
    }
  });
  const executor = createWebSearchExecutor(fetchFn);

  const latinResult = await executor.execute(createWebSearchCall({ query: 'DeepSeek API streaming official docs', market: 'zh-CN' }));
  const chineseResult = await executor.execute(createWebSearchCall({ query: 'Example Editor 官方文档', market: 'zh-CN' }));

  assert.equal(latinResult.ok, true);
  assert.equal(chineseResult.ok, true);
  assert.equal(fetchFn.calls[0].url.includes('&mkt=zh-CN&ensearch=1'), false);
  assert.equal(fetchFn.calls[1].url.includes('&mkt=zh-CN&ensearch=1&safeSearch=Moderate'), true);
  assert.equal(fetchFn.calls[2].url.includes('&mkt=zh-CN&ensearch=1'), false);
});

test('web_search marks focused and unfocused result quality deterministically', async () => {
  const fetchFn = createFakeFetch({
    [createBingSearchFixtureUrl('Echo TUI GitHub')]: {
      body: createLowQualityEchoPage(),
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    [createBingSearchFixtureUrl('OpenAI Responses API tools')]: {
      body: createBingResultsPage([
        { title: 'OpenAI Responses API tools guide', url: 'https://platform.openai.com/docs/guides/tools', snippet: 'Use tools with the Responses API.' }
      ]),
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    [createBingSearchFixtureUrl('Example Editor 官方文档')]: {
      body: createBingResultsPage([
        { title: 'Example Editor 官方文档', url: 'https://docs.example.com/editor', snippet: 'Example Editor 官网文档和配置说明。' }
      ]),
      headers: { 'content-type': 'text/html' },
      status: 200
    }
  });
  const executor = createWebSearchExecutor(fetchFn);
  const echoResult = await executor.execute(createWebSearchCall({ query: 'Echo TUI GitHub' }));
  const openAiResult = await executor.execute(createWebSearchCall({ query: 'OpenAI Responses API tools' }));
  const editorResult = await executor.execute(createWebSearchCall({ query: 'Example Editor 官方文档' }));

  assert.equal(echoResult.ok, true);
  assert.match(echoResult.text, /warning: results may be unrelated or incomplete/);
  assert.match(echoResult.text, /missing_query_terms: tui, github/);
  assert.equal(openAiResult.ok, true);
  assert.doesNotMatch(openAiResult.text, /matched_query_terms:/);
  assert.match(openAiResult.text, /OpenAI Responses API tools guide/);
  assert.equal(editorResult.ok, true);
  assert.doesNotMatch(editorResult.text, /matched_query_terms:/);
  assert.match(editorResult.text, /Example Editor 官方文档/);
});

test('web_search retries low-quality and blocked attempts with provider fallback', async () => {
  const focusedPage = createDuckDuckGoResultsPage([
    { title: 'Echo TUI GitHub repository', url: 'https://github.com/example/echo-tui', snippet: 'Echo TUI source code on GitHub.' }
  ]);
  const blockedFocusedPage = createDuckDuckGoResultsPage([
    { title: 'blocked Echo TUI GitHub repository', url: 'https://github.com/example/echo-tui', snippet: 'Blocked retry found Echo TUI source code on GitHub.' }
  ]);
  const fetchFn = createFakeFetch({
    [createBingSearchFixtureUrl('OpenAI Responses API tools')]: {
      body: createBingResultsPage([
        { title: 'OpenAI Responses API tools guide', url: 'https://platform.openai.com/docs/guides/tools', snippet: 'Use tools with the Responses API.' }
      ]),
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    [createBingSearchFixtureUrl('Echo TUI GitHub')]: {
      body: createLowQualityEchoPage(),
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    [createDuckDuckGoSearchFixtureUrl('Echo TUI GitHub')]: {
      body: focusedPage,
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    [createBingSearchFixtureUrl('blocked Echo TUI GitHub')]: {
      body: createBlockedSearchPage(),
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    [createDuckDuckGoSearchFixtureUrl('blocked Echo TUI GitHub')]: {
      body: blockedFocusedPage,
      headers: { 'content-type': 'text/html' },
      status: 200
    }
  });
  const executor = createWebSearchExecutor(fetchFn);
  const focusedResult = await executor.execute(createWebSearchCall({ query: 'OpenAI Responses API tools' }));
  const tokenMissingResult = await executor.execute(createWebSearchCall({ query: 'Echo TUI GitHub' }));
  const blockedThenSuccessResult = await executor.execute(createWebSearchCall({ query: 'blocked Echo TUI GitHub' }));

  assert.equal(focusedResult.ok, true);
  assert.doesNotMatch(focusedResult.text, /attempts:/);
  assert.equal(tokenMissingResult.ok, true);
  assert.doesNotMatch(tokenMissingResult.text, /attempts:/);
  assert.match(tokenMissingResult.text, /1\. Echo TUI GitHub repository/);
  assert.equal(blockedThenSuccessResult.ok, true);
  assert.doesNotMatch(blockedThenSuccessResult.text, /attempts:/);
  assert.equal(fetchFn.calls.length, 5);
});

test('web_search keeps low-scoring strict source results with relevance scores', async () => {
  const fetchFn = createFakeFetch({
    [createBingSearchFixtureUrl('Echo TUI GitHub')]: {
      body: createLowQualityEchoPage(),
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    [createBingSearchFixtureUrl('site:arxiv.org retrieval augmented generation survey pdf')]: {
      body: createBingResultsPage([
        { title: '知乎 - 有问题，就会有答案', url: 'https://www.zhihu.com/', snippet: '中文问答社区。' }
      ]),
      headers: { 'content-type': 'text/html' },
      status: 200
    }
  });
  const executor = createWebSearchExecutor(fetchFn);
  const githubResult = await executor.execute(createWebSearchCall({ query: 'Echo TUI GitHub' }));
  const arxivResult = await executor.execute(createWebSearchCall({ query: 'site:arxiv.org retrieval augmented generation survey pdf' }));

  assert.equal(githubResult.ok, true);
  assert.match(githubResult.text, /Echo - Definition and Meaning/);
  assert.doesNotMatch(githubResult.text, /relevance_score:/);
  assert.equal(arxivResult.ok, true);
  assert.doesNotMatch(arxivResult.text, /returned_results:/);
  assert.match(arxivResult.text, /知乎/);
  assert.doesNotMatch(arxivResult.text, /arxiv\.org\/search/);
  assert.doesNotMatch(arxivResult.text, /Bitcoin Stack Exchange/);
});

test('web_search enforces site host boundaries and rejects split top-k coverage', async () => {
  const fetchFn = createFakeFetch({
    [createBingSearchFixtureUrl('site:github.com echo tui')]: {
      body: createBingResultsPage([
        { title: 'Echo TUI GitHub mirror', url: 'https://evilgithub.com/example/echo-tui', snippet: 'Echo TUI source code on a GitHub-looking host.' }
      ]),
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    [createBingSearchFixtureUrl('alpha beta gamma delta')]: {
      body: createBingResultsPage([
        { title: 'Alpha beta overview', url: 'https://example.com/alpha-beta', snippet: 'Only the first half is covered.' },
        { title: 'Gamma delta overview', url: 'https://example.com/gamma-delta', snippet: 'Only the second half is covered.' }
      ]),
      headers: { 'content-type': 'text/html' },
      status: 200
    }
  });
  const executor = createWebSearchExecutor(fetchFn);
  const hostResult = await executor.execute(createWebSearchCall({ query: 'site:github.com echo tui' }));
  const splitResult = await executor.execute(createWebSearchCall({ query: 'alpha beta gamma delta' }));

  assert.equal(hostResult.ok, true);
  assert.match(hostResult.text, /warning: results may be unrelated or incomplete/);
  assert.match(hostResult.text, /missing_query_terms: github\.com/);
  assert.equal(splitResult.ok, true);
  assert.match(splitResult.text, /missing_query_terms: \(none\)/);
  assert.match(splitResult.text, /warning: results may be unrelated or incomplete/);
});

test('web_search tries fallback after bounded low-quality attempts and returns merged deduped results', async () => {
  const fetchFn = createFakeFetch({
    [createBingSearchFixtureUrl('Echo TUI GitHub', { count: 10 })]: {
      body: createBingResultsPage([
        { title: 'Echo definition', url: 'https://example.com/echo#top', snippet: 'Echo is a reflected sound.' },
        { title: 'Echo devices', url: 'https://example.com/device', snippet: 'Echo smart speaker.' }
      ]),
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    [createDuckDuckGoSearchFixtureUrl('Echo TUI GitHub', { count: 10 })]: {
      body: createDuckDuckGoResultsPage([
        { title: 'Echo duplicate', url: 'https://example.com/echo#later', snippet: 'Echo duplicate.' },
        { title: 'Echo music', url: 'https://example.com/music', snippet: 'Echo songs.' }
      ]),
      headers: { 'content-type': 'text/html' },
      status: 200
    }
  });
  const executor = createWebSearchExecutor(fetchFn);
  const result = await executor.execute(createWebSearchCall({ query: 'Echo TUI GitHub', count: 10 }));

  assert.equal(result.ok, true);
  assert.match(result.text, /warning: results may be unrelated or incomplete/);
  assert.doesNotMatch(result.text, /relevance_score:/);
  assert.equal(fetchFn.calls.length, 2);
});

test('web_search falls back to DuckDuckGo HTML when Bing quality stays low', async () => {
  const fetchFn = createFakeFetch({
    [createBingSearchFixtureUrl('Echo TUI GitHub')]: {
      body: createLowQualityEchoPage(),
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    [createDuckDuckGoSearchFixtureUrl('Echo TUI GitHub')]: {
      body: createDuckDuckGoResultsPage([
        { title: 'Echo TUI GitHub repository', url: 'https://github.com/example/echo-tui', snippet: 'Echo TUI source code on GitHub.' }
      ]),
      headers: { 'content-type': 'text/html' },
      status: 200
    }
  });
  const executor = createWebSearchExecutor(fetchFn);
  const result = await executor.execute(createWebSearchCall({ query: 'Echo TUI GitHub' }));

  assert.equal(result.ok, true);
  assert.doesNotMatch(result.text, /provider:/);
  assert.doesNotMatch(result.text, /attempts:/);
  assert.match(result.text, /1\. Echo TUI GitHub repository/);
  assert.match(result.text, /url: https:\/\/github\.com\/example\/echo-tui/);
  assert.doesNotMatch(result.text, /relevance_score:/);
});

test('web_search reports blocked pages, no results, HTTP errors, timeout, body caps, and output caps', async () => {
  const abortError = new Error('aborted');
  abortError.name = 'AbortError';
  const fetchFn = createFakeFetch({
    'https://www.bing.com/search?q=blocked&count=5&first=1&safeSearch=Moderate': {
      body: '<html><body>captcha required</body></html>',
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    'https://www.bing.com/search?q=none&count=5&first=1&safeSearch=Moderate': {
      body: '<html><body><div class="b_no">There are no results</div></body></html>',
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    'https://www.bing.com/search?q=weird&count=5&first=1&safeSearch=Moderate': {
      body: '<html><body><main>changed layout</main></body></html>',
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    'https://www.bing.com/search?q=missing&count=5&first=1&safeSearch=Moderate': {
      body: 'missing',
      headers: { 'content-type': 'text/html' },
      status: 503,
      statusText: 'Unavailable'
    },
    'https://www.bing.com/search?q=timeout&count=5&first=1&safeSearch=Moderate': abortError,
    'https://www.bing.com/search?q=large&count=5&first=1&safeSearch=Moderate': {
      body: '<li class="b_algo"><h2><a href="https://example.com/large">Large</a></h2><p>abcdefghijklmnopqrstuvwxyz</p></li>',
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    'https://www.bing.com/search?q=verbose&count=5&first=1&safeSearch=Moderate': {
      body: '<li class="b_algo"><h2><a href="https://example.com/verbose">Verbose</a></h2><p>abcdefghijklmnopqrstuvwxyz</p></li>',
      headers: { 'content-type': 'text/html' },
      status: 200
    }
  });
  const executor = createToolExecutor(createToolRegistry([createWebSearchToolHandler({
    fetch: fetchFn,
    maxResponseBytes: 70,
    timeoutMs: 10
  })]));
  const blockedResult = await executor.execute(createWebSearchCall({ query: 'blocked', count: null, offset: null, market: null, safe_search: null }));
  const noneResult = await executor.execute(createWebSearchCall({ query: 'none', count: null, offset: null, market: null, safe_search: null }));
  const weirdResult = await executor.execute(createWebSearchCall({ query: 'weird', count: null, offset: null, market: null, safe_search: null }));
  const missingResult = await executor.execute(createWebSearchCall({ query: 'missing', count: null, offset: null, market: null, safe_search: null }));
  const timeoutResult = await executor.execute(createWebSearchCall({ query: 'timeout', count: null, offset: null, market: null, safe_search: null }));
  const largeResult = await executor.execute(createWebSearchCall({ query: 'large', count: null, offset: null, market: null, safe_search: null }));
  const truncatingExecutor = createToolExecutor(createToolRegistry([createWebSearchToolHandler({
    fetch: fetchFn,
    maxResponseBytes: 1000,
    maxTotalOutputBytes: 60
  })]));
  const verboseResult = await truncatingExecutor.execute(createWebSearchCall({ query: 'verbose', count: null, offset: null, market: null, safe_search: null }));

  assert.equal(blockedResult.ok, false);
  assert.match(blockedResult.text, /blocked or requires verification/);
  assert.equal(noneResult.ok, true);
  assert.equal(noneResult.details.truncated, false);
  assert.match(noneResult.text, /no search results/);
  assert.equal(weirdResult.ok, false);
  assert.match(weirdResult.text, /did not contain parseable natural results/);
  assert.equal(missingResult.ok, false);
  assert.match(missingResult.text, /HTTP 503 Unavailable/);
  assert.equal(timeoutResult.ok, false);
  assert.equal(timeoutResult.details.timedOut, true);
  assert.match(timeoutResult.text, /request timed out after 10ms/);
  assert.equal(largeResult.ok, false);
  assert.equal(largeResult.details.truncated, true);
  assert.match(largeResult.text, /did not contain parseable natural results/);
  assert.equal(verboseResult.ok, true);
  assert.equal(verboseResult.details.truncated, true);
  assert.match(verboseResult.text, /Output was truncated/);
});

test('web_search reports parent abort as cancellation without timeout', async () => {
  const controller = new AbortController();
  const fetchFn = async (_url, init) => {
    return new Promise((_resolve, reject) => {
      const rejectAbort = () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      };

      if (init.signal.aborted) {
        rejectAbort();
        return;
      }

      init.signal.addEventListener('abort', rejectAbort, { once: true });
    });
  };
  const executor = createToolExecutor(createToolRegistry([createWebSearchToolHandler({
    fetch: fetchFn,
    timeoutMs: 1000
  })]));
  const pending = executor.execute(createWebSearchCall({ query: 'slow', count: null, offset: null, market: null, safe_search: null }), {
    abortSignal: controller.signal
  });

  controller.abort();
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.details.timedOut, false);
  assert.match(result.text, /search request cancelled/);
});

test('web_search stops fallback attempts after parent abort even when fetch ignores its signal', async () => {
  const controller = new AbortController();
  let fetchCalls = 0;
  const fetchFn = async () => {
    fetchCalls += 1;
    controller.abort();
    return new Response('', { status: 503 });
  };
  const executor = createWebSearchExecutor(fetchFn);

  const result = await executor.execute(createWebSearchCall({
    query: 'DeepSeek API streaming official docs',
    market: 'zh-CN'
  }), { abortSignal: controller.signal });

  assert.equal(result.ok, false);
  assert.equal(result.details.timedOut, false);
  assert.match(result.text, /search request cancelled/);
  assert.equal(fetchCalls, 1);
});

test('web_search recognizes DuckDuckGo duck challenge as blocked page', async () => {
  const fetchFn = createFakeFetch({
    [createBingSearchFixtureUrl('duckduckgo challenge')]: {
      body: '<html><body><main>changed layout</main></body></html>',
      headers: { 'content-type': 'text/html' },
      status: 200
    },
    [createDuckDuckGoSearchFixtureUrl('duckduckgo challenge')]: {
      body: createDuckDuckGoChallengePage(),
      headers: { 'content-type': 'text/html' },
      status: 202
    }
  });
  const executor = createWebSearchExecutor(fetchFn);
  const result = await executor.execute(createWebSearchCall({ query: 'duckduckgo challenge' }));

  assert.equal(result.ok, false);
  assert.match(result.text, /blocked or requires verification/);
  assert.doesNotMatch(result.text, /fallback page did not contain parseable natural results/);
});

test('glob finds sorted file paths with default cwd and records ripgrep arguments', async () => {
  const cwd = createTempWorkspace();
  const rgPath = createFakeRipgrep(cwd, `
const fs = require('node:fs');
fs.writeFileSync('glob-args.json', JSON.stringify(process.argv.slice(2)), 'utf8');
process.stdout.write(['b.ts', 'a.ts'].join('\\0') + '\\0');
process.exit(0);
`);
  const executor = createToolExecutor(createToolRegistry([createGlobToolHandler({ cwd, rgPath })]));
  const result = await executor.execute(createGlobCall({ pattern: '*.ts' }));
  const args = JSON.parse(fs.readFileSync(path.join(cwd, 'glob-args.json'), 'utf8'));

  assert.equal(result.callId, 'call_glob');
  assert.equal(result.toolName, GLOB_TOOL_NAME);
  assert.equal(result.ok, true);
  assert.equal(result.details.exitCode, 0);
  assert.equal(result.details.truncated, false);
  assert.deepEqual(result.details.display, {kind: 'glob', paths: ['b.ts', 'a.ts']});
  assert.deepEqual(args, ['--files', '--hidden', '--sort', 'path', '--null', '--glob', '*.ts', '--glob', '!.git', '--glob', '!.git/**', '--', '.']);
  assert.doesNotMatch(result.text, /pattern: \*\.ts/);
  assert.doesNotMatch(result.text, /returned_paths:/);
  assert.doesNotMatch(result.text, /has_more: false/);
  assert.match(result.text, /b\.ts/);
  assert.match(result.text, /a\.ts/);
});

test('glob limits search roots, discovers hidden files, and treats no matches as success', async () => {
  const cwd = createTempWorkspace();
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.mkdirSync(path.join(cwd, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src', 'a.ts'), '', 'utf8');
  fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'ci.yml'), '', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createGlobToolHandler({ cwd })]));

  const scopedResult = await executor.execute(createGlobCall({ pattern: '**/*.ts', paths: ['src'] }));
  assert.equal(scopedResult.ok, true);
  assert.doesNotMatch(scopedResult.text, /paths: src/);
  assert.match(scopedResult.text, /src\/a\.ts/);

  const hiddenResult = await executor.execute(createGlobCall({ pattern: '.github/**/*.yml', paths: null }));
  assert.equal(hiddenResult.ok, true);
  assert.match(hiddenResult.text, /\.github\/workflows\/ci\.yml/);

  const missingResult = await executor.execute(createGlobCall({ pattern: '*.missing', paths: null }));
  assert.equal(missingResult.ok, true);
  assert.equal(missingResult.details.exitCode, 1);
  assert.equal(missingResult.details.truncated, false);
  assert.deepEqual(missingResult.details.display, {kind: 'glob', paths: []});
  assert.match(missingResult.text, /no files matched/);
});

test('glob rejects invalid arguments and unsafe paths', async () => {
  const cwd = createTempWorkspace();
  const executor = createToolExecutor(createToolRegistry([createGlobToolHandler({ cwd })]));

  assert.match((await executor.execute(createGlobCall({ pattern: '', paths: null }))).text, /pattern must be a non-empty string/);
  assert.match((await executor.execute(createGlobCall({ pattern: 'bad\0pattern', paths: null }))).text, /pattern must not contain NUL/);
  assert.match((await executor.execute(createGlobCall({ pattern: '.git/**', paths: null }))).text, /\.git paths are not allowed/);
  assert.match((await executor.execute(createGlobCall({ pattern: '*.ts', paths: 'src' }))).text, /paths must be an array/);
  assert.match((await executor.execute(createGlobCall({ pattern: '*.ts', paths: [] }))).text, /paths must not be empty/);
  assert.match((await executor.execute(createGlobCall({ pattern: '*.ts', paths: [''] }))).text, /paths\[0\] must be a non-empty string/);
  assert.match((await executor.execute(createGlobCall({ pattern: '*.ts', paths: ['bad\0path'] }))).text, /path must not contain NUL/);
  assert.match((await executor.execute(createGlobCall({ pattern: '*.ts', paths: ['.git/config'] }))).text, /\.git paths are not allowed/);
});

test('glob filters .git output paths and reports ripgrep failures', async () => {
  const cwd = createTempWorkspace();
  const filterRgPath = createFakeRipgrep(cwd, `
process.stdout.write(['.git/config', 'src/ok.ts'].join('\\0') + '\\0');
process.exit(0);
`);
  const filterExecutor = createToolExecutor(createToolRegistry([createGlobToolHandler({ cwd, rgPath: filterRgPath })]));
  const filterResult = await filterExecutor.execute(createGlobCall({ pattern: '**/*', paths: null }));

  assert.equal(filterResult.ok, true);
  assert.match(filterResult.text, /src\/ok\.ts/);
  assert.doesNotMatch(filterResult.text, /\.git\/config/);

  const errorRgPath = createFakeRipgrep(cwd, `
console.error('file listing failed');
process.exit(2);
`);
  const errorExecutor = createToolExecutor(createToolRegistry([createGlobToolHandler({ cwd, rgPath: errorRgPath })]));
  const errorResult = await errorExecutor.execute(createGlobCall({ pattern: '**/*', paths: null }));

  assert.equal(errorResult.ok, false);
  assert.equal(errorResult.details.exitCode, 2);
  assert.equal(errorResult.details.display, undefined);
  assert.match(errorResult.text, /file listing failed/);

  const missingExecutor = createToolExecutor(createToolRegistry([createGlobToolHandler({
    cwd,
    rgPath: path.join(cwd, 'missing-rg')
  })]));
  const missingResult = await missingExecutor.execute(createGlobCall({ pattern: '**/*', paths: null }));

  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.details.exitCode, null);
  assert.equal(missingResult.details.display, undefined);
  assert.match(missingResult.text, /ripgrep executable not found/);
});

test('glob caps returned paths with DEFAULT_MAX_PATHS', async () => {
  const cwd = createTempWorkspace();
  const rgPath = createFakeRipgrep(cwd, `
process.stdout.write(['one.ts', 'two.ts', 'three.ts'].join('\\0') + '\\0');
process.exit(0);
`);
  const executor = createToolExecutor(createToolRegistry([createGlobToolHandler({ cwd, rgPath, maxPaths: 2 })]));
  const result = await executor.execute(createGlobCall({ pattern: '*.ts', paths: null }));

  assert.equal(DEFAULT_MAX_PATHS > 2, true);
  assert.equal(result.ok, true);
  assert.equal(result.details.truncated, true);
  assert.deepEqual(result.details.display, {kind: 'glob', paths: ['one.ts', 'two.ts']});
  assert.match(result.text, /has_more: true/);
  assert.match(result.text, /More than 2 paths found/);
  assert.match(result.text, /one\.ts/);
  assert.match(result.text, /two\.ts/);
  assert.doesNotMatch(result.text, /three\.ts/);
});

test('grep runs fixed-string searches with paths, glob, and case options', async () => {
  const cwd = createTempWorkspace();
  const rgPath = createFakeRipgrep(cwd, `
const fs = require('node:fs');
fs.writeFileSync('rg-args.json', JSON.stringify(process.argv.slice(2)), 'utf8');
console.log(JSON.stringify({
  type: 'match',
  data: {
    path: { text: 'src/tool.ts' },
    lines: { text: 'const needle = true;\\n' },
    line_number: 7,
    submatches: [{ start: 6, end: 12, match: { text: 'needle' } }]
  }
}));
process.exit(0);
`);
  const executor = createToolExecutor(createToolRegistry([createGrepToolHandler({ cwd, rgPath })]));
  const result = await executor.execute(createGrepCall({
    pattern: 'needle',
    paths: ['src', 'test'],
    glob: '*.ts',
    literal: null,
    case_sensitive: false
  }));
  const args = JSON.parse(fs.readFileSync(path.join(cwd, 'rg-args.json'), 'utf8'));

  assert.equal(result.callId, 'call_grep');
  assert.equal(result.toolName, GREP_TOOL_NAME);
  assert.equal(result.ok, true);
  assert.equal(result.details.exitCode, 0);
  assert.equal(result.details.truncated, false);
  assert.deepEqual(result.details.display, {
    kind: 'grep',
    matches: [{path: 'src/tool.ts', line: 7, column: 7, text: 'const needle = true;'}]
  });
  assert.deepEqual(args, ['--json', '--line-number', '--column', '--fixed-strings', '--ignore-case', '--glob', '*.ts', '--', 'needle', 'src', 'test']);
  assert.doesNotMatch(result.text, /pattern: needle/);
  assert.doesNotMatch(result.text, /returned_matches:/);
  assert.match(result.text, /src\/tool\.ts:7:7: const needle = true;/);
});

test('grep supports regex searches and reports no matches as success', async () => {
  const cwd = createTempWorkspace();
  const regexRgPath = createFakeRipgrep(cwd, `
const fs = require('node:fs');
fs.writeFileSync('regex-args.json', JSON.stringify(process.argv.slice(2)), 'utf8');
console.log(JSON.stringify({
  type: 'match',
  data: {
    path: { text: 'src/a.ts' },
    lines: { text: 'alpha42\\n' },
    line_number: 3,
    submatches: [{ start: 0, end: 7, match: { text: 'alpha42' } }]
  }
}));
process.exit(0);
`);
  const regexExecutor = createToolExecutor(createToolRegistry([createGrepToolHandler({ cwd, rgPath: regexRgPath })]));
  const regexResult = await regexExecutor.execute(createGrepCall({
    pattern: 'alpha[0-9]+',
    paths: null,
    glob: null,
    literal: false,
    case_sensitive: true
  }));
  const regexArgs = JSON.parse(fs.readFileSync(path.join(cwd, 'regex-args.json'), 'utf8'));

  assert.equal(regexResult.ok, true);
  assert.deepEqual(regexResult.details.display, {
    kind: 'grep',
    matches: [{path: 'src/a.ts', line: 3, column: 1, text: 'alpha42'}]
  });
  assert.deepEqual(regexArgs, ['--json', '--line-number', '--column', '--case-sensitive', '--', 'alpha[0-9]+', '.']);
  assert.doesNotMatch(regexResult.text, /literal: false/);
  assert.doesNotMatch(regexResult.text, /case_sensitive: true/);
  assert.match(regexResult.text, /alpha42/);

  const noMatchRgPath = createFakeRipgrep(cwd, `process.exit(1);`);
  const noMatchExecutor = createToolExecutor(createToolRegistry([createGrepToolHandler({ cwd, rgPath: noMatchRgPath })]));
  const noMatchResult = await noMatchExecutor.execute(createGrepCall({
    pattern: 'missing',
    paths: null,
    glob: null,
    literal: true,
    case_sensitive: null
  }));

  assert.equal(noMatchResult.ok, true);
  assert.equal(noMatchResult.details.exitCode, 1);
  assert.equal(noMatchResult.details.truncated, false);
  assert.deepEqual(noMatchResult.details.display, {kind: 'grep', matches: []});
  assert.match(noMatchResult.text, /no matches found/);
});

test('grep rejects invalid arguments and unsafe paths', async () => {
  const cwd = createTempWorkspace();
  const executor = createToolExecutor(createToolRegistry([createGrepToolHandler({ cwd })]));

  assert.match((await executor.execute(createGrepCall({ pattern: '', paths: null, glob: null, literal: null, case_sensitive: null }))).text, /pattern must be a non-empty string/);
  assert.match((await executor.execute(createGrepCall({ pattern: 'x', paths: 'src', glob: null, literal: null, case_sensitive: null }))).text, /paths must be an array/);
  assert.match((await executor.execute(createGrepCall({ pattern: 'x', paths: [], glob: null, literal: null, case_sensitive: null }))).text, /paths must not be empty/);
  assert.match((await executor.execute(createGrepCall({ pattern: 'x', paths: [''], glob: null, literal: null, case_sensitive: null }))).text, /paths\[0\] must be a non-empty string/);
  assert.match((await executor.execute(createGrepCall({ pattern: 'x', paths: ['bad\0path'], glob: null, literal: null, case_sensitive: null }))).text, /path must not contain NUL/);
  assert.match((await executor.execute(createGrepCall({ pattern: 'x', paths: ['.git/config'], glob: null, literal: null, case_sensitive: null }))).text, /\.git paths are not allowed/);
  assert.match((await executor.execute(createGrepCall({ pattern: 'x', paths: null, glob: '', literal: null, case_sensitive: null }))).text, /glob must be a non-empty string or null/);
  assert.match((await executor.execute(createGrepCall({ pattern: 'x', paths: null, glob: null, literal: 'yes', case_sensitive: null }))).text, /literal must be a boolean or null/);
  assert.match((await executor.execute(createGrepCall({ pattern: 'x', paths: null, glob: null, literal: null, case_sensitive: 'yes' }))).text, /case_sensitive must be a boolean or null/);
});

test('grep reports ripgrep errors and missing executable failures', async () => {
  const cwd = createTempWorkspace();
  const errorRgPath = createFakeRipgrep(cwd, `
console.error('regex parse error');
process.exit(2);
`);
  const errorExecutor = createToolExecutor(createToolRegistry([createGrepToolHandler({ cwd, rgPath: errorRgPath })]));
  const errorResult = await errorExecutor.execute(createGrepCall({
    pattern: '[',
    paths: null,
    glob: null,
    literal: false,
    case_sensitive: null
  }));

  assert.equal(errorResult.ok, false);
  assert.equal(errorResult.details.exitCode, 2);
  assert.equal(errorResult.details.display, undefined);
  assert.match(errorResult.text, /regex parse error/);

  const missingExecutor = createToolExecutor(createToolRegistry([createGrepToolHandler({
    cwd,
    rgPath: path.join(cwd, 'missing-rg')
  })]));
  const missingResult = await missingExecutor.execute(createGrepCall({
    pattern: 'x',
    paths: null,
    glob: null,
    literal: null,
    case_sensitive: null
  }));

  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.details.exitCode, null);
  assert.equal(missingResult.details.display, undefined);
  assert.match(missingResult.text, /ripgrep executable not found/);
});

test('grep caps returned matches with DEFAULT_MAX_MATCHES', async () => {
  const cwd = createTempWorkspace();
  const rgPath = createFakeRipgrep(cwd, `
for (let index = 0; index < 3; index += 1) {
  console.log(JSON.stringify({
    type: 'match',
    data: {
      path: { text: 'src/many.ts' },
      lines: { text: 'hit-' + index + '\\n' },
      line_number: index + 1,
      submatches: [{ start: 0, end: 3, match: { text: 'hit' } }]
    }
  }));
}
process.exit(0);
`);
  const executor = createToolExecutor(createToolRegistry([createGrepToolHandler({ cwd, rgPath, maxMatches: 2 })]));
  const result = await executor.execute(createGrepCall({
    pattern: 'hit',
    paths: null,
    glob: null,
    literal: null,
    case_sensitive: null
  }));

  assert.equal(DEFAULT_MAX_MATCHES > 2, true);
  assert.equal(result.ok, true);
  assert.equal(result.details.truncated, true);
  assert.deepEqual(result.details.display, {
    kind: 'grep',
    matches: [
      {path: 'src/many.ts', line: 1, column: 1, text: 'hit-0'},
      {path: 'src/many.ts', line: 2, column: 1, text: 'hit-1'}
    ]
  });
  assert.match(result.text, /has_more: true/);
  assert.match(result.text, /More than 2 matches found/);
  assert.match(result.text, /hit-0/);
  assert.match(result.text, /hit-1/);
  assert.doesNotMatch(result.text, /hit-2/);
});

test('apply_patch updates existing files with multiple hunks', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'src.txt'), 'alpha\nbeta\ngamma\ndelta\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    '--- a/src.txt',
    '+++ b/src.txt',
    '@@ -1,4 +1,4 @@',
    ' alpha',
    '-beta',
    '+BETA',
    ' gamma',
    '@@ -2,3 +2,3 @@',
    ' BETA',
    '-gamma',
    '+GAMMA',
    ' delta',
    ''
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.match(result.text, /Applied patch/);
  assert.match(result.text, /src\.txt \(updated\)/);
  assert.equal(readWorkspaceFile(cwd, 'src.txt'), 'alpha\nBETA\nGAMMA\ndelta\n');
});

test('apply_patch records change snapshots after successful simulation', async () => {
  const cwd = createTempWorkspace();
  const target = path.join(cwd, 'src.txt');
  const created = path.join(cwd, 'created.txt');
  fs.writeFileSync(target, 'alpha\nbeta\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const change = createRecordingChangeRecorder();
  const patch = [
    '--- a/src.txt',
    '+++ b/src.txt',
    '@@ -1,2 +1,2 @@',
    ' alpha',
    '-beta',
    '+BETA',
    '--- /dev/null',
    '+++ b/created.txt',
    '@@ -0,0 +1 @@',
    '+created',
    ''
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch), {changeRecorder: change.recorder});

  assert.equal(result.ok, true);
  assert.deepEqual(change.calls.before, [target, created]);
  assert.deepEqual(change.calls.after, [target, created]);
  assert.deepEqual(change.calls.invalidations, []);

  const failed = createRecordingChangeRecorder();
  const failedResult = await executor.execute(createPatchCall([
    '--- a/src.txt',
    '+++ b/src.txt',
    '@@ -1,2 +1,2 @@',
    ' missing',
    '-beta',
    '+BETA',
    ''
  ].join('\n')), {changeRecorder: failed.recorder});

  assert.equal(failedResult.ok, false);
  assert.deepEqual(failed.calls.before, []);
  assert.deepEqual(failed.calls.after, []);
});

test('apply_patch marks change entries as written one file at a time', async () => {
  const cwd = createTempWorkspace();
  const target = path.join(cwd, 'src.txt');
  const blockedChild = path.join(cwd, 'blocked', 'created.txt');
  fs.writeFileSync(target, 'alpha\nbeta\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'blocked'), 'not a directory\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const change = createRecordingChangeRecorder();
  const patch = [
    '--- a/src.txt',
    '+++ b/src.txt',
    '@@ -1,2 +1,2 @@',
    ' alpha',
    '-beta',
    '+BETA',
    '--- /dev/null',
    '+++ b/blocked/created.txt',
    '@@ -0,0 +1 @@',
    '+created',
    ''
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch), {changeRecorder: change.recorder});

  assert.equal(result.ok, false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'alpha\nBETA\n');
  assert.deepEqual(change.calls.before, [target, blockedChild]);
  assert.deepEqual(change.calls.after, [target]);
  assert.deepEqual(change.calls.invalidations, []);
});

test('apply_patch updates existing files when diff --git omits file headers', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'src.txt'), 'alpha\nbeta\ngamma\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    'diff --git a/src.txt b/src.txt',
    'index 1111111..2222222 100644',
    '@@ -1,3 +1,3 @@',
    ' alpha',
    '-beta',
    '+BETA',
    ' gamma',
    ''
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'src.txt'), 'alpha\nBETA\ngamma\n');
});

test('apply_patch updates symlink targets while delete still rejects symlinks', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'real.txt'), 'alpha\nbeta\n', 'utf8');
  fs.symlinkSync(path.join(cwd, 'real.txt'), path.join(cwd, 'link.txt'));
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const updatePatch = [
    '--- a/link.txt',
    '+++ b/link.txt',
    '@@ -1,2 +1,2 @@',
    ' alpha',
    '-beta',
    '+BETA',
    ''
  ].join('\n');

  const update = await executor.execute(createPatchCall(updatePatch));

  assert.equal(update.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'real.txt'), 'alpha\nBETA\n');
  assert.equal(fs.lstatSync(path.join(cwd, 'link.txt')).isSymbolicLink(), true);

  const deletion = await executor.execute(createPatchCall('*** Begin Patch\n*** Delete File: link.txt\n*** End Patch'));

  assert.equal(deletion.ok, false);
  assert.match(deletion.text, /symlink/);
  assert.equal(fs.lstatSync(path.join(cwd, 'link.txt')).isSymbolicLink(), true);
});

test('apply_patch supports mixed standard and headerless file patches', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'one.txt'), 'one\ntwo\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'two.txt'), 'red\nblue\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    'diff --git a/one.txt b/one.txt',
    '@@ -1,2 +1,2 @@',
    ' one',
    '-two',
    '+TWO',
    '--- a/two.txt',
    '+++ b/two.txt',
    '@@ -1,2 +1,2 @@',
    ' red',
    '-blue',
    '+BLUE',
    ''
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'one.txt'), 'one\nTWO\n');
  assert.equal(readWorkspaceFile(cwd, 'two.txt'), 'red\nBLUE\n');
});

test('apply_patch adds files and creates parent directories', async () => {
  const cwd = createTempWorkspace();
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    'diff --git a/nested/new.txt b/nested/new.txt',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/nested/new.txt',
    '@@ -0,0 +1,2 @@',
    '+hello',
    '+world',
    ''
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'nested/new.txt'), 'hello\nworld\n');
});

test('apply_patch adds files from Begin Patch format', async () => {
  const cwd = createTempWorkspace();
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    '*** Begin Patch',
    '  *** Add File: hello_world.txt',
    '  +hello world',
    '*** End Patch'
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'hello_world.txt'), 'hello world\n');
});

test('apply_patch updates files from Begin Patch format', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'src.txt'), 'alpha\nbeta\ngamma\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    '*** Begin Patch',
    '*** Update File: src.txt',
    '@@',
    ' alpha',
    '-beta',
    '+BETA',
    ' gamma',
    '*** End Patch'
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'src.txt'), 'alpha\nBETA\ngamma\n');
});

test('apply_patch accepts fully indented Begin Patch format', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'src.txt'), 'alpha\nbeta\ngamma\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    '  *** Begin Patch',
    '  *** Update File: src.txt',
    '  @@',
    '   alpha',
    '  -beta',
    '  +BETA',
    '   gamma',
    '  *** End Patch'
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'src.txt'), 'alpha\nBETA\ngamma\n');
});

test('apply_patch preserves Begin Patch operator column for plus and minus content', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'markers.txt'), [
    '- bullet context',
    '+ plus context',
    '@@ literal context',
    '*** literal directive context',
    '-old remove line',
    '+old plus line',
    'tail',
    ''
  ].join('\n'), 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    '*** Begin Patch',
    '*** Update File: markers.txt',
    '@@',
    ' - bullet context',
    ' + plus context',
    ' @@ literal context',
    ' *** literal directive context',
    '--old remove line',
    '+-new dash line',
    '-+old plus line',
    '++new plus line',
    ' tail',
    '*** End Patch'
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'markers.txt'), [
    '- bullet context',
    '+ plus context',
    '@@ literal context',
    '*** literal directive context',
    '-new dash line',
    '+new plus line',
    'tail',
    ''
  ].join('\n'));
});

test('apply_patch supports Begin Patch context-only chunks as sequential anchors', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'command-host.test.js'), [
    "const {createCommandHost} = require('../../src/app/command/command-host');",
    '',
    "test('CommandHost theme facade lists selected builtin theme and applies selection', () => {",
    '  withTemporaryThemeConfig(() => {',
    '    assert.equal(true, true);',
    '  });',
    '});',
    '',
    "test('CommandHost theme facade keeps current theme when selection cannot be saved', () => {",
    "  withTemporaryThemeConfig('{broken', () => {",
    '    assert.equal(false, false);',
    '  });',
    '});',
    ''
  ].join('\n'), 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    '*** Begin Patch',
    '*** Update File: command-host.test.js',
    '@@',
    "-const {createCommandHost} = require('../../src/app/command/command-host');",
    "+const {createCommandHost, createCopyableRecords} = require('../../src/app/command/command-host');",
    '@@',
    " test('CommandHost theme facade keeps current theme when selection cannot be saved', () => {",
    '@@',
    '   });',
    ' });',
    '+',
    "+test('createCopyableRecords only returns user and assistant original text', () => {",
    "+  assert.deepEqual(createCopyableRecords([]), []);",
    '+});',
    '*** End Patch'
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'command-host.test.js'), [
    "const {createCommandHost, createCopyableRecords} = require('../../src/app/command/command-host');",
    '',
    "test('CommandHost theme facade lists selected builtin theme and applies selection', () => {",
    '  withTemporaryThemeConfig(() => {',
    '    assert.equal(true, true);',
    '  });',
    '});',
    '',
    "test('CommandHost theme facade keeps current theme when selection cannot be saved', () => {",
    "  withTemporaryThemeConfig('{broken', () => {",
    '    assert.equal(false, false);',
    '  });',
    '});',
    '',
    "test('createCopyableRecords only returns user and assistant original text', () => {",
    '  assert.deepEqual(createCopyableRecords([]), []);',
    '});',
    ''
  ].join('\n'));
  assert.deepEqual(
    result.details.display.files[0].lines.filter((line) => line.kind !== 'context'),
    [
      {kind: 'removed', text: "const {createCommandHost} = require('../../src/app/command/command-host');", postLine: null},
      {kind: 'added', text: "const {createCommandHost, createCopyableRecords} = require('../../src/app/command/command-host');", postLine: 1},
      {kind: 'added', text: '', postLine: 14},
      {kind: 'added', text: "test('createCopyableRecords only returns user and assistant original text', () => {", postLine: 15},
      {kind: 'added', text: '  assert.deepEqual(createCopyableRecords([]), []);', postLine: 16},
      {kind: 'added', text: '});', postLine: 17}
    ]
  );
});

test('apply_patch supports Begin Patch inline context anchors', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'src.txt'), 'alpha\nanchor\nomega\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    '*** Begin Patch',
    '*** Update File: src.txt',
    '@@ anchor',
    '+inserted',
    '*** End Patch'
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'src.txt'), 'alpha\nanchor\ninserted\nomega\n');
});

test('apply_patch rejects unsafe Begin Patch insertions and missing anchors', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'src.txt'), 'alpha\nanchor\nomega\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'ambiguous.txt'), 'anchor\nother\nanchor\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));

  const pureInsertResult = await executor.execute(createPatchCall([
    '*** Begin Patch',
    '*** Update File: src.txt',
    '@@',
    '+inserted',
    '*** End Patch'
  ].join('\n')));

  assert.equal(pureInsertResult.ok, false);
  assert.match(pureInsertResult.text, /no context or removed lines/);
  assert.equal(readWorkspaceFile(cwd, 'src.txt'), 'alpha\nanchor\nomega\n');

  const contextOnlyResult = await executor.execute(createPatchCall([
    '*** Begin Patch',
    '*** Update File: src.txt',
    '@@',
    ' anchor',
    '*** End Patch'
  ].join('\n')));

  assert.equal(contextOnlyResult.ok, false);
  assert.match(contextOnlyResult.text, /has no changed hunks/);
  assert.equal(readWorkspaceFile(cwd, 'src.txt'), 'alpha\nanchor\nomega\n');

  const missingAnchorResult = await executor.execute(createPatchCall([
    '*** Begin Patch',
    '*** Update File: src.txt',
    '@@ missing',
    '+inserted',
    '*** End Patch'
  ].join('\n')));

  assert.equal(missingAnchorResult.ok, false);
  assert.match(missingAnchorResult.text, /matched 0 locations/);
  assert.equal(readWorkspaceFile(cwd, 'src.txt'), 'alpha\nanchor\nomega\n');

  const ambiguousAnchorResult = await executor.execute(createPatchCall([
    '*** Begin Patch',
    '*** Update File: ambiguous.txt',
    '@@ anchor',
    '+inserted',
    '*** End Patch'
  ].join('\n')));

  assert.equal(ambiguousAnchorResult.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'ambiguous.txt'), 'anchor\ninserted\nother\nanchor\n');
});

test('apply_patch applies Begin Patch repeated chunks using first match after cursor', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'repeat.txt'), [
    'start',
    'same',
    'old',
    'end',
    'middle',
    'same',
    'old',
    'end',
    ''
  ].join('\n'), 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    '*** Begin Patch',
    '*** Update File: repeat.txt',
    '@@',
    ' same',
    '-old',
    '+new-one',
    ' end',
    '@@',
    ' same',
    '-old',
    '+new-two',
    ' end',
    '*** End Patch'
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'repeat.txt'), [
    'start',
    'same',
    'new-one',
    'end',
    'middle',
    'same',
    'new-two',
    'end',
    ''
  ].join('\n'));
});

test('apply_patch advances Begin Patch cursor after repeated context-only chunks', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'context.txt'), [
    'section',
    'marker',
    'gap',
    'section',
    'marker',
    'tail',
    ''
  ].join('\n'), 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    '*** Begin Patch',
    '*** Update File: context.txt',
    '@@',
    ' section',
    ' marker',
    '@@',
    ' section',
    '-marker',
    '+MARKER',
    '*** End Patch'
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'context.txt'), [
    'section',
    'marker',
    'gap',
    'section',
    'MARKER',
    'tail',
    ''
  ].join('\n'));
});

test('apply_patch deletes files from Begin Patch and restores through change history', async () => {
  const cwd = createTempWorkspace();
  const target = path.join(cwd, 'old.txt');
  fs.writeFileSync(target, 'alpha\nbeta\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const history = new ChangeHistoryContext();
  const patch = [
    '*** Begin Patch',
    '*** Delete File: old.txt',
    '*** End Patch'
  ].join('\n');

  history.beginCheckpoint({cwd, transcriptStartIndex: 0});
  const result = await executor.execute(createPatchCall(patch), {changeRecorder: history.createRecorder()});
  history.finalizeCheckpoint();

  assert.equal(result.ok, true);
  assert.equal(result.text, 'Applied patch.\nChanged files:\n- old.txt (deleted)');
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(result.details.display, {
    kind: 'apply_patch',
    files: [{
      path: 'old.txt',
      kind: 'deleted',
      lines: [
        {kind: 'removed', text: 'alpha', postLine: null},
        {kind: 'removed', text: 'beta', postLine: null}
      ]
    }]
  });
  assert.deepEqual(history.last.files.map((entry) => ({path: path.basename(entry.path), state: entry.state})), [
    {path: 'old.txt', state: 'updated'}
  ]);
  assert.deepEqual(history.getSummary(), {
    status: 'ready',
    checkpointId: history.last.id,
    fileCount: 1,
    restoreFileCount: 1,
    deleteFileCount: 0
  });

  const undo = history.executeUndo();

  assert.equal(undo.ok, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'alpha\nbeta\n');
});

test('apply_patch deletes files from unified diff with content verification', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'remove.txt'), 'alpha\nbeta\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    'diff --git a/remove.txt b/remove.txt',
    'deleted file mode 100644',
    'index 1111111..0000000',
    '--- a/remove.txt',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-alpha',
    '-beta',
    ''
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.match(result.text, /remove\.txt \(deleted\)/);
  assert.equal(fs.existsSync(path.join(cwd, 'remove.txt')), false);
  assert.deepEqual(result.details.display.files[0], {
    path: 'remove.txt',
    kind: 'deleted',
    lines: [
      {kind: 'removed', text: 'alpha', postLine: null},
      {kind: 'removed', text: 'beta', postLine: null}
    ]
  });
});

test('apply_patch rejects unsafe delete targets without writing other changes', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'victim.txt'), 'keep\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'changed.txt'), 'actual\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'partial.txt'), 'actual\nleftover\n', 'utf8');
  fs.mkdirSync(path.join(cwd, 'dir-target'));
  fs.writeFileSync(path.join(cwd, 'link-target.txt'), 'target\n', 'utf8');
  fs.symlinkSync(path.join(cwd, 'link-target.txt'), path.join(cwd, 'link.txt'));
  fs.writeFileSync(path.join(cwd, 'binary.txt'), Buffer.from([65, 0, 66]));
  fs.writeFileSync(path.join(cwd, 'large.txt'), '12345', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({cwd})]));
  const smallExecutor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({cwd, maxFileBytes: 4})]));

  const staleDelete = await executor.execute(createPatchCall([
    '--- a/changed.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-expected',
    ''
  ].join('\n')));
  assert.equal(staleDelete.ok, false);
  assert.match(staleDelete.text, /matched 0 locations/);
  assert.equal(readWorkspaceFile(cwd, 'changed.txt'), 'actual\n');

  const partialDelete = await executor.execute(createPatchCall([
    '--- a/partial.txt',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-actual',
    ''
  ].join('\n')));
  assert.equal(partialDelete.ok, false);
  assert.match(partialDelete.text, /does not remove the entire file/);
  assert.equal(readWorkspaceFile(cwd, 'partial.txt'), 'actual\nleftover\n');

  const additiveDelete = await executor.execute(createPatchCall([
    '--- a/changed.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-actual',
    '+leftover',
    ''
  ].join('\n')));
  assert.equal(additiveDelete.ok, false);
  assert.match(additiveDelete.text, /must only contain removed lines/);
  assert.equal(readWorkspaceFile(cwd, 'changed.txt'), 'actual\n');

  const missingDelete = await executor.execute(createPatchCall('*** Begin Patch\n*** Delete File: missing.txt\n*** End Patch'));
  assert.equal(missingDelete.ok, false);
  assert.match(missingDelete.text, /does not exist/);

  const gitDelete = await executor.execute(createPatchCall('*** Begin Patch\n*** Delete File: .git/config\n*** End Patch'));
  assert.equal(gitDelete.ok, false);
  assert.match(gitDelete.text, /\.git paths are not allowed/);

  const nulDelete = await executor.execute(createPatchCall('*** Begin Patch\n*** Delete File: bad\0path.txt\n*** End Patch'));
  assert.equal(nulDelete.ok, false);
  assert.match(nulDelete.text, /must not contain NUL/);

  const directoryDelete = await executor.execute(createPatchCall('*** Begin Patch\n*** Delete File: dir-target\n*** End Patch'));
  assert.equal(directoryDelete.ok, false);
  assert.match(directoryDelete.text, /not a file/);
  assert.equal(fs.existsSync(path.join(cwd, 'dir-target')), true);

  const symlinkDelete = await executor.execute(createPatchCall('*** Begin Patch\n*** Delete File: link.txt\n*** End Patch'));
  assert.equal(symlinkDelete.ok, false);
  assert.match(symlinkDelete.text, /symlink/);
  assert.equal(fs.lstatSync(path.join(cwd, 'link.txt')).isSymbolicLink(), true);

  const binaryDelete = await executor.execute(createPatchCall('*** Begin Patch\n*** Delete File: binary.txt\n*** End Patch'));
  assert.equal(binaryDelete.ok, false);
  assert.match(binaryDelete.text, /binary/);
  assert.equal(fs.existsSync(path.join(cwd, 'binary.txt')), true);

  const largeDelete = await smallExecutor.execute(createPatchCall('*** Begin Patch\n*** Delete File: large.txt\n*** End Patch'));
  assert.equal(largeDelete.ok, false);
  assert.match(largeDelete.text, /exceeds 4 bytes/);
  assert.equal(fs.existsSync(path.join(cwd, 'large.txt')), true);

  const allOrNothing = await executor.execute(createPatchCall([
    '*** Begin Patch',
    '*** Delete File: victim.txt',
    '*** Add File: changed.txt',
    '+new',
    '*** End Patch'
  ].join('\n')));

  assert.equal(allOrNothing.ok, false);
  assert.match(allOrNothing.text, /already exists/);
  assert.equal(readWorkspaceFile(cwd, 'victim.txt'), 'keep\n');
  assert.equal(readWorkspaceFile(cwd, 'changed.txt'), 'actual\n');
});

test('apply_patch applies multi-file patches all at once', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'one.txt'), 'one\ntwo\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    '--- a/one.txt',
    '+++ b/one.txt',
    '@@ -1,2 +1,2 @@',
    ' one',
    '-two',
    '+TWO',
    '--- /dev/null',
    '+++ b/two.txt',
    '@@ -0,0 +1 @@',
    '+created',
    ''
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'one.txt'), 'one\nTWO\n');
  assert.equal(readWorkspaceFile(cwd, 'two.txt'), 'created\n');
});

test('apply_patch allows absolute and workspace-escaping paths', async () => {
  const cwd = createTempWorkspace();
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-tui-outside-'));
  const absoluteTarget = path.join(outsideDir, 'absolute.txt');
  const escapingTarget = path.join(cwd, '..', `${path.basename(cwd)}-sibling.txt`);
  const patch = [
    '--- /dev/null',
    `+++ ${absoluteTarget}`,
    '@@ -0,0 +1 @@',
    '+absolute',
    '--- /dev/null',
    `+++ b/../${path.basename(escapingTarget)}`,
    '@@ -0,0 +1 @@',
    '+escaped',
    ''
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(absoluteTarget, 'utf8'), 'absolute\n');
  assert.equal(fs.readFileSync(escapingTarget, 'utf8'), 'escaped\n');
});

test('apply_patch still rejects NUL and .git paths', async () => {
  const cwd = createTempWorkspace();
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const cases = ['.git/config', 'nested/.git/config', 'bad\u0000path.txt'];

  for (const filePath of cases) {
    const patch = [
      '--- /dev/null',
      `+++ b/${filePath}`,
      '@@ -0,0 +1 @@',
      '+content',
      ''
    ].join('\n');
    const result = await executor.execute(createPatchCall(patch));

    assert.equal(result.ok, false, filePath);
    assert.match(result.text, /Patch failed/);
  }
});

test('apply_patch replaces the same file through repeated Begin Patch operations', async () => {
  const cwd = createTempWorkspace();
  const target = path.join(cwd, 'replace.txt');
  fs.writeFileSync(target, 'old\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    '*** Begin Patch',
    '*** Delete File: replace.txt',
    '*** Add File: replace.txt',
    '+new',
    '+value',
    '*** End Patch'
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.equal(result.text, 'Applied patch.\nChanged files:\n- replace.txt (updated)');
  assert.equal(fs.readFileSync(target, 'utf8'), 'new\nvalue\n');
  assert.deepEqual(result.details.display.files, [
    {
      path: 'replace.txt',
      kind: 'deleted',
      lines: [{kind: 'removed', text: 'old', postLine: null}]
    },
    {
      path: 'replace.txt',
      kind: 'added',
      lines: [
        {kind: 'added', text: 'new', postLine: 1},
        {kind: 'added', text: 'value', postLine: 2}
      ]
    }
  ]);
});

test('apply_patch replaces the same file through repeated unified diff operations', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'replace.txt'), 'old\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    '--- a/replace.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-old',
    '--- /dev/null',
    '+++ b/replace.txt',
    '@@ -0,0 +1 @@',
    '+new',
    ''
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.equal(result.text, 'Applied patch.\nChanged files:\n- replace.txt (updated)');
  assert.equal(readWorkspaceFile(cwd, 'replace.txt'), 'new\n');
  assert.deepEqual(result.details.display.files.map((file) => file.kind), ['deleted', 'added']);
});

test('apply_patch sequences repeated updates across relative and absolute paths', async () => {
  const cwd = createTempWorkspace();
  const target = path.join(cwd, 'same.txt');
  const created = path.join(cwd, 'created.txt');
  fs.writeFileSync(target, 'alpha\nbeta\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    '--- a/same.txt',
    '+++ b/same.txt',
    '@@ -1,2 +1,2 @@',
    '-alpha',
    '+ALPHA',
    ' beta',
    `--- ${target}`,
    `+++ ${target}`,
    '@@ -1,2 +1,2 @@',
    ' ALPHA',
    '-beta',
    '+BETA',
    '--- /dev/null',
    '+++ b/created.txt',
    '@@ -0,0 +1 @@',
    '+first',
    `--- ${created}`,
    `+++ ${created}`,
    '@@ -1 +1 @@',
    '-first',
    '+second',
    ''
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'same.txt'), 'ALPHA\nBETA\n');
  assert.equal(readWorkspaceFile(cwd, 'created.txt'), 'second\n');
  assert.equal((result.text.match(/same\.txt \(updated\)/g) || []).length, 1);
  assert.equal((result.text.match(/created\.txt \(added\)/g) || []).length, 1);
  assert.equal(result.details.display.files.length, 4);
});

test('apply_patch rejects invalid repeated state transitions without writing virtual changes', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'existing.txt'), 'old\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const missingAfterDelete = [
    '*** Begin Patch',
    '*** Add File: untouched.txt',
    '+created',
    '*** Delete File: existing.txt',
    '*** Update File: existing.txt',
    '@@',
    '-old',
    '+changed',
    '*** End Patch'
  ].join('\n');

  const missingResult = await executor.execute(createPatchCall(missingAfterDelete));

  assert.equal(missingResult.ok, false);
  assert.match(missingResult.text, /target file does not exist/);
  assert.equal(readWorkspaceFile(cwd, 'existing.txt'), 'old\n');
  assert.equal(fs.existsSync(path.join(cwd, 'untouched.txt')), false);

  const staleSecondUpdate = [
    '--- a/existing.txt',
    '+++ b/existing.txt',
    '@@ -1 +1 @@',
    '-old',
    '+middle',
    '--- a/existing.txt',
    '+++ b/existing.txt',
    '@@ -1 +1 @@',
    '-missing',
    '+final',
    ''
  ].join('\n');
  const staleResult = await executor.execute(createPatchCall(staleSecondUpdate));

  assert.equal(staleResult.ok, false);
  assert.match(staleResult.text, /matched 0 locations/);
  assert.equal(readWorkspaceFile(cwd, 'existing.txt'), 'old\n');
});

test('apply_patch records one snapshot for replacement and undo restores original content', async () => {
  const cwd = createTempWorkspace();
  const target = path.join(cwd, 'replace.txt');
  fs.writeFileSync(target, 'before\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const history = new ChangeHistoryContext();
  const patch = [
    '*** Begin Patch',
    '*** Delete File: replace.txt',
    '*** Add File: replace.txt',
    '+after',
    '*** End Patch'
  ].join('\n');

  history.beginCheckpoint({cwd, transcriptStartIndex: 0});
  const result = await executor.execute(createPatchCall(patch), {changeRecorder: history.createRecorder()});
  history.finalizeCheckpoint();

  assert.equal(result.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'replace.txt'), 'after\n');
  assert.deepEqual(history.last.files.map((entry) => ({path: entry.path, state: entry.state})), [
    {path: target, state: 'updated'}
  ]);
  assert.equal(history.executeUndo().ok, true);
  assert.equal(readWorkspaceFile(cwd, 'replace.txt'), 'before\n');
});

test('apply_patch skips writes and change history for add then delete', async () => {
  const cwd = createTempWorkspace();
  const target = path.join(cwd, 'temporary.txt');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const change = createRecordingChangeRecorder();
  const patch = [
    '*** Begin Patch',
    '*** Add File: temporary.txt',
    '+temporary',
    '*** Delete File: temporary.txt',
    '*** End Patch'
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch), {changeRecorder: change.recorder});

  assert.equal(result.ok, true);
  assert.equal(result.text, 'Applied patch.\nChanged files:\n- none');
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(change.calls.before, []);
  assert.deepEqual(change.calls.after, []);
});

test('apply_patch rejects hunk mismatches and ambiguous hunks', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'missing.txt'), 'actual\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'ambiguous.txt'), 'same\nkeep\nsame\nkeep\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));

  const missingResult = await executor.execute(createPatchCall([
    '--- a/missing.txt',
    '+++ b/missing.txt',
    '@@ -1 +1 @@',
    '-expected',
    '+changed',
    ''
  ].join('\n')));

  assert.equal(missingResult.ok, false);
  assert.match(missingResult.text, /matched 0 locations/);
  assert.equal(readWorkspaceFile(cwd, 'missing.txt'), 'actual\n');

  const ambiguousResult = await executor.execute(createPatchCall([
    '--- a/ambiguous.txt',
    '+++ b/ambiguous.txt',
    '@@ -1,2 +1,2 @@',
    ' same',
    '-keep',
    '+changed',
    ''
  ].join('\n')));

  assert.equal(ambiguousResult.ok, false);
  assert.match(ambiguousResult.text, /matched multiple locations/);
  assert.equal(readWorkspaceFile(cwd, 'ambiguous.txt'), 'same\nkeep\nsame\nkeep\n');
});

test('apply_patch rejects invalid input, missing targets, and existing add targets', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'exists.txt'), 'exists\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));

  const nonStringResult = await executor.execute({
    callId: 'call_patch',
    toolName: APPLY_PATCH_TOOL_NAME,
    argumentsText: JSON.stringify({ patch: 123 })
  });
  assert.equal(nonStringResult.ok, false);
  assert.match(nonStringResult.text, /patch must be a string/);

  const invalidResult = await executor.execute(createPatchCall('not a diff'));
  assert.equal(invalidResult.ok, false);
  assert.match(invalidResult.text, /expected file header/);

  const missingTargetResult = await executor.execute(createPatchCall([
    '--- a/missing.txt',
    '+++ b/missing.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    ''
  ].join('\n')));
  assert.equal(missingTargetResult.ok, false);
  assert.match(missingTargetResult.text, /target file does not exist/);

  const existingAddResult = await executor.execute(createPatchCall([
    '--- /dev/null',
    '+++ b/exists.txt',
    '@@ -0,0 +1 @@',
    '+new',
    ''
  ].join('\n')));
  assert.equal(existingAddResult.ok, false);
  assert.match(existingAddResult.text, /already exists/);
  assert.equal(readWorkspaceFile(cwd, 'exists.txt'), 'exists\n');
});

test('apply_patch rejects unsupported patch types', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'file.txt'), 'old\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const cases = [
    ['rename', ['diff --git a/file.txt b/renamed.txt', 'rename from file.txt', 'rename to renamed.txt', '']],
    ['mode', ['old mode 100644', 'new mode 100755', '--- a/file.txt', '+++ b/file.txt', '@@ -1 +1 @@', '-old', '+new', '']],
    ['binary', ['GIT binary patch', 'literal 0', '']],
    ['symlink', ['diff --git a/link b/link', 'new file mode 120000', '--- /dev/null', '+++ b/link', '@@ -0,0 +1 @@', '+target', '']],
    ['deleted symlink', ['diff --git a/link b/link', 'deleted file mode 120000', '--- a/link', '+++ /dev/null', '@@ -1 +0,0 @@', '-target', '']]
  ];

  for (const [name, lines] of cases) {
    const result = await executor.execute(createPatchCall(lines.join('\n')));

    assert.equal(result.ok, false, name);
    assert.match(result.text, /not supported/, name);
  }
});

test('apply_patch does not treat ordinary content ending with 120000 as symlink metadata', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'file.txt'), 'value 100000\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -1 +1 @@',
    '-value 100000',
    '+value 120000',
    ''
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'file.txt'), 'value 120000\n');
});

test('apply_patch does not write any files when one operation fails', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'existing.txt'), 'original\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const patch = [
    '--- /dev/null',
    '+++ b/new.txt',
    '@@ -0,0 +1 @@',
    '+created',
    '--- a/existing.txt',
    '+++ b/existing.txt',
    '@@ -1 +1 @@',
    '-missing',
    '+changed',
    ''
  ].join('\n');

  const result = await executor.execute(createPatchCall(patch));

  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(path.join(cwd, 'new.txt')), false);
  assert.equal(readWorkspaceFile(cwd, 'existing.txt'), 'original\n');
});

test('apply_patch returns display metadata for successful and failed parsed patches', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'src.txt'), 'alpha\nbeta\ngamma\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'missing.txt'), 'actual\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));

  const updateResult = await executor.execute(createPatchCall([
    '--- a/src.txt',
    '+++ b/src.txt',
    '@@ -1,3 +1,3 @@',
    ' alpha',
    '-beta',
    '+BETA',
    ' gamma',
    ''
  ].join('\n')));

  assert.equal(updateResult.ok, true);
  assert.equal(updateResult.text, 'Applied patch.\nChanged files:\n- src.txt (updated)');
  assert.deepEqual(updateResult.details.display, {
    kind: 'apply_patch',
    files: [{
      path: 'src.txt',
      kind: 'updated',
      lines: [
        {kind: 'context', text: 'alpha', postLine: 1},
        {kind: 'removed', text: 'beta', postLine: null},
        {kind: 'added', text: 'BETA', postLine: 2},
        {kind: 'context', text: 'gamma', postLine: 3}
      ]
    }]
  });

  const addResult = await executor.execute(createPatchCall([
    '*** Begin Patch',
    '*** Add File: hello.txt',
    '+hello',
    '+world',
    '*** End Patch'
  ].join('\n')));

  assert.equal(addResult.ok, true);
  assert.equal(addResult.text, 'Applied patch.\nChanged files:\n- hello.txt (added)');
  assert.deepEqual(addResult.details.display, {
    kind: 'apply_patch',
    files: [{
      path: 'hello.txt',
      kind: 'added',
      lines: [
        {kind: 'added', text: 'hello', postLine: 1},
        {kind: 'added', text: 'world', postLine: 2}
      ]
    }]
  });

  const failedResult = await executor.execute(createPatchCall([
    '--- a/missing.txt',
    '+++ b/missing.txt',
    '@@ -1 +1 @@',
    '-expected',
    '+changed',
    ''
  ].join('\n')));

  assert.equal(failedResult.ok, false);
  assert.match(failedResult.text, /matched 0 locations/);
  assert.equal(failedResult.details.display, undefined);
  assert.equal(readWorkspaceFile(cwd, 'missing.txt'), 'actual\n');
});

test('apply_patch display metadata returns complete post-image lines across hunks', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'src.txt'), [
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    ''
  ].join('\n'), 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const result = await executor.execute(createPatchCall([
    '--- a/src.txt',
    '+++ b/src.txt',
    '@@ -5 +5,2 @@',
    '-five',
    '+FIVE',
    '+five-and-half',
    '@@ -9 +10,0 @@',
    '-nine',
    ''
  ].join('\n')));

  assert.equal(result.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'src.txt'), [
    'one',
    'two',
    'three',
    'four',
    'FIVE',
    'five-and-half',
    'six',
    'seven',
    'eight',
    'ten',
    ''
  ].join('\n'));
  assert.deepEqual(
    result.details.display.files[0].lines.filter((line) => line.kind !== 'context'),
    [
      {kind: 'removed', text: 'five', postLine: null},
      {kind: 'added', text: 'FIVE', postLine: 5},
      {kind: 'added', text: 'five-and-half', postLine: 6},
      {kind: 'removed', text: 'nine', postLine: null}
    ]
  );
  assert.deepEqual(
    result.details.display.files[0].lines.filter((line) => line.kind !== 'removed').map((line) => line.postLine),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  );
  assert.equal(result.details.display.files[0].lines.find((line) => line.postLine === 10).text, 'ten');
});

test('apply_patch display metadata clears added status when a later hunk deletes that line', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'src.txt'), 'A\nC\n', 'utf8');
  const executor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({ cwd })]));
  const result = await executor.execute(createPatchCall([
    '--- a/src.txt',
    '+++ b/src.txt',
    '@@ -1 +1 @@',
    '-A',
    '+B',
    '@@ -1 +0,0 @@',
    '-B',
    ''
  ].join('\n')));

  assert.equal(result.ok, true);
  assert.equal(readWorkspaceFile(cwd, 'src.txt'), 'C\n');
  assert.deepEqual(result.details.display.files[0].lines, [
    {kind: 'removed', text: 'A', postLine: null},
    {kind: 'removed', text: 'B', postLine: null},
    {kind: 'context', text: 'C', postLine: 1}
  ]);
});

test('apply_patch enforces patch, file, changed file, and hunk limits', async () => {
  const cwd = createTempWorkspace();
  fs.writeFileSync(path.join(cwd, 'large.txt'), '123456\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'small.txt'), 'old\n', 'utf8');
  const handler = createApplyPatchToolHandler({
    cwd,
    maxPatchBytes: 20,
    maxFileBytes: 4,
    maxChangedFiles: 1,
    maxHunks: 1
  });
  const executor = createToolExecutor(createToolRegistry([handler]));

  const tooLargePatch = await executor.execute(createPatchCall('--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1 @@\n+x\n'));
  assert.equal(tooLargePatch.ok, false);
  assert.match(tooLargePatch.text, /patch exceeds/);

  const roomyExecutor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({
    cwd,
    maxPatchBytes: 1000,
    maxFileBytes: 4,
    maxChangedFiles: 1,
    maxHunks: 10
  })]));
  const tooLargeFile = await roomyExecutor.execute(createPatchCall([
    '--- a/large.txt',
    '+++ b/large.txt',
    '@@ -1 +1 @@',
    '-123456',
    '+changed',
    ''
  ].join('\n')));
  assert.equal(tooLargeFile.ok, false);
  assert.match(tooLargeFile.text, /target file exceeds/);

  const tooManyFiles = await roomyExecutor.execute(createPatchCall([
    '--- /dev/null',
    '+++ b/a.txt',
    '@@ -0,0 +1 @@',
    '+a',
    '--- /dev/null',
    '+++ b/b.txt',
    '@@ -0,0 +1 @@',
    '+b',
    ''
  ].join('\n')));
  assert.equal(tooManyFiles.ok, false);
  assert.match(tooManyFiles.text, /more than 1 files/);

  const hunkLimitExecutor = createToolExecutor(createToolRegistry([createApplyPatchToolHandler({
    cwd,
    maxPatchBytes: 1000,
    maxFileBytes: 1000,
    maxChangedFiles: 2,
    maxHunks: 1
  })]));
  const tooManyHunks = await hunkLimitExecutor.execute(createPatchCall([
    '--- a/small.txt',
    '+++ b/small.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    '@@ -1 +1 @@',
    '-new',
    '+newer',
    ''
  ].join('\n')));
  assert.equal(tooManyHunks.ok, false);
  assert.match(tooManyHunks.text, /exceeds 1 hunks/);
});
