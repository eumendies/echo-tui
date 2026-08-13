const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const {
  BUILTIN_SUBAGENT_DEFINITIONS,
  GENERAL_SUBAGENT_TOOL_CEILING,
  READONLY_SUBAGENT_TOOL_CEILING
} = require('../../src/agent/subagent/definition');
const {
  MAX_CUSTOM_SUBAGENT_BODY_BYTES,
  MAX_CUSTOM_SUBAGENT_DESCRIPTION_CODE_POINTS,
  MAX_CUSTOM_SUBAGENT_FILE_BYTES,
  parseCustomSubagentManifest
} = require('../../src/agent/subagent/manifest');
const {
  formatSubagentDisplayName,
  formatSubagentRawName,
  formatSubagentTerminalIdentity,
  isBuiltinSubagentName,
  isValidSubagentName
} = require('../../src/agent/subagent/name');
const {MAX_CUSTOM_SUBAGENTS, loadSubagentCatalog} = require('../../src/agent/subagent/catalog');

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-custom-subagents-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  fs.mkdirSync(home, {recursive: true});
  fs.mkdirSync(path.join(project, '.git'), {recursive: true});
  return {home, project, root};
}

function createManifest(overrides = {}) {
  const description = overrides.description || 'Review a bounded area with concrete evidence.';
  const capability = overrides.capability || 'readonly';
  const tools = overrides.tools || ['read_files', 'glob', 'grep'];
  const mcpLine = Object.hasOwn(overrides, 'mcp') ? `mcp: ${String(overrides.mcp)}\n` : '';
  const body = overrides.body || '# Role\n\nReturn concise findings.';
  return [
    '---',
    `description: ${description}`,
    `capability: ${capability}`,
    'tools:',
    ...tools.map((tool) => `  - ${tool}`),
    mcpLine.trimEnd(),
    '---',
    '',
    body
  ].filter((line, index) => line !== '' || index > 0).join('\n');
}

function writeAgent(base, name, content = createManifest()) {
  const agentsDir = path.join(base, '.echo', 'agents');
  fs.mkdirSync(agentsDir, {recursive: true});
  const filePath = path.join(agentsDir, `${name}.md`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

test('subagent names enforce the stable grammar and format untrusted identities safely', () => {
  assert.equal(isValidSubagentName('a'), true);
  assert.equal(isValidSubagentName(`a${'0'.repeat(63)}`), true);
  for (const invalid of ['', '-agent', '_agent', 'Agent', 'agent.md', `a${'0'.repeat(64)}`, 'safe\u001b[31m']) {
    assert.equal(isValidSubagentName(invalid), false, invalid);
  }

  assert.equal(isBuiltinSubagentName('explorer'), true);
  assert.equal(isBuiltinSubagentName('worker'), true);
  assert.equal(isBuiltinSubagentName('reviewer'), false);
  assert.equal(formatSubagentDisplayName('security_review-agent'), 'Security review agent');
  assert.equal(formatSubagentDisplayName('bad\nname'), 'Subagent');
  assert.equal(formatSubagentRawName('security_review-agent'), 'security_review-agent');
  assert.equal(formatSubagentRawName('bad\u001b[31m'), 'Subagent');
  assert.equal(formatSubagentTerminalIdentity('explorer', 'completed'), 'Explorer · returned report');
  assert.equal(formatSubagentTerminalIdentity('worker', 'completed'), 'Worker · completed task');
  assert.equal(formatSubagentTerminalIdentity('security-reviewer', 'failed'), 'Security reviewer · failed');
});

test('manifest parser accepts only the documented bounded subset', () => {
  const raw = [
    '---',
    'description: "Review auth risks"',
    'capability: general',
    'tools:',
    '  - read_files',
    '  - file_edit',
    'mcp: true',
    '---',
    '',
    '# Reviewer',
    '',
    'Check authentication.'
  ].join('\r\n');
  const parsed = parseCustomSubagentManifest(raw);

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.manifest, {
    capability: 'general',
    description: 'Review auth risks',
    instructions: '# Reviewer\n\nCheck authentication.',
    mcp: true,
    tools: ['read_files', 'file_edit']
  });
});

test('manifest parser rejects missing, duplicate, unknown, typed, templated, and unsupported structures', () => {
  const invalidCases = [
    ['missing_field', '---\ndescription: x\ncapability: readonly\n---\nbody'],
    ['unknown_field', '---\ndescription: x\ncapability: readonly\ntools:\n  - grep\nmodel: secret\n---\nbody'],
    ['duplicate_field', '---\ndescription: x\ndescription: y\ncapability: readonly\ntools:\n  - grep\n---\nbody'],
    ['duplicate_tool', '---\ndescription: x\ncapability: readonly\ntools:\n  - grep\n  - grep\n---\nbody'],
    ['unsupported_structure', '---\ndescription: x\ncapability: readonly\ntools: [grep]\n---\nbody'],
    ['unsupported_structure', '---\ndescription: ${SECRET}\ncapability: readonly\ntools:\n  - grep\n---\nbody'],
    ['invalid_mcp', '---\ndescription: x\ncapability: general\ntools:\n  - grep\nmcp: "true"\n---\nbody'],
    ['missing_body', '---\ndescription: x\ncapability: readonly\ntools:\n  - grep\n---\n  \n'],
    ['control_character', '---\ndescription: x\u001b\ncapability: readonly\ntools:\n  - grep\n---\nbody']
  ];

  for (const [code, raw] of invalidCases) {
    const parsed = parseCustomSubagentManifest(raw);
    assert.equal(parsed.ok, false, raw);
    assert.equal(parsed.error.code, code, raw);
    assert.doesNotMatch(parsed.error.message, /SECRET|body/u);
  }
});

test('manifest parser enforces file, body, and description budgets without truncation', () => {
  const longDescription = '😀'.repeat(MAX_CUSTOM_SUBAGENT_DESCRIPTION_CODE_POINTS + 1);
  const cases = [
    ['description_too_long', createManifest({description: longDescription})],
    ['body_too_large', createManifest({body: 'x'.repeat(MAX_CUSTOM_SUBAGENT_BODY_BYTES + 1)})],
    ['file_too_large', `${createManifest()}${'x'.repeat(MAX_CUSTOM_SUBAGENT_FILE_BYTES)}`]
  ];

  for (const [code, raw] of cases) {
    const parsed = parseCustomSubagentManifest(raw);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, code);
  }
});

test('definition exports preserve built-ins and expose readonly general ceilings and custom prompt composition', () => {
  const builtins = BUILTIN_SUBAGENT_DEFINITIONS;
  assert.deepEqual(builtins.map(({name}) => name), ['explorer', 'worker']);
  assert.deepEqual(builtins.map(({executionPolicy}) => executionPolicy), ['readonly_investigation', 'general_purpose']);
  assert.equal(Array.isArray(builtins[0].localToolNames), true);
  assert.equal(builtins[0].localToolNames.includes('run_subagent'), false);
  assert.equal(builtins[1].localToolNames.includes('apply_patch'), true);
  assert.equal(READONLY_SUBAGENT_TOOL_CEILING.includes('file_edit'), false);
  assert.equal(GENERAL_SUBAGENT_TOOL_CEILING.includes('file_edit'), true);
  assert.equal(Object.isFrozen(builtins), true);
  assert.equal(Object.isFrozen(builtins[0].localToolNames), true);
});

test('catalog discovers both scopes in deterministic order', () => {
  const workspace = createWorkspace();
  try {
    const userPath = writeAgent(workspace.home, 'doc-writer');
    const projectPath = writeAgent(workspace.project, 'security-reviewer');
    const nestedCwd = path.join(workspace.project, 'packages', 'app');
    fs.mkdirSync(nestedCwd, {recursive: true});

    const catalog = loadSubagentCatalog({cwd: nestedCwd, homedir: workspace.home});
    assert.deepEqual(catalog.listDescriptors().map(({name}) => name), [
      'explorer',
      'worker',
      'doc-writer',
      'security-reviewer'
    ]);
    assert.equal(catalog.get('doc-writer').name, 'doc-writer');
    assert.equal(catalog.get('security-reviewer').name, 'security-reviewer');
    assert.deepEqual(catalog.diagnostics, []);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('project candidates override user candidates and invalid high-priority files hide valid lower definitions', () => {
  const workspace = createWorkspace();
  try {
    writeAgent(workspace.home, 'reviewer', createManifest({description: 'user definition'}));
    const projectPath = writeAgent(workspace.project, 'reviewer', createManifest({description: 'project definition'}));
    let catalog = loadSubagentCatalog({cwd: workspace.project, homedir: workspace.home});
    assert.equal(catalog.get('reviewer').description, 'project definition');
    assert.equal(catalog.get('reviewer').description, 'project definition');

    fs.writeFileSync(projectPath, '---\ndescription: broken\n---\nbody', 'utf8');
    catalog = loadSubagentCatalog({cwd: workspace.project, homedir: workspace.home});
    assert.equal(catalog.get('reviewer'), undefined);
    assert.equal(catalog.diagnostics.some((diagnostic) => diagnostic.sourcePath === projectPath && diagnostic.code === 'missing_field'), true);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('catalog reserves built-ins, ignores unrelated entries, and reports unsafe filenames without reading content', () => {
  const workspace = createWorkspace();
  try {
    const agentsDir = path.join(workspace.project, '.echo', 'agents');
    fs.mkdirSync(path.join(agentsDir, 'nested.md'), {recursive: true});
    fs.writeFileSync(path.join(agentsDir, 'notes.txt'), createManifest(), 'utf8');
    const explorerPath = writeAgent(workspace.project, 'explorer', createManifest({capability: 'general', tools: ['file_edit'], mcp: true}));
    const invalidPath = path.join(agentsDir, 'Bad.md');
    fs.writeFileSync(invalidPath, 'SECRET BODY', 'utf8');

    const catalog = loadSubagentCatalog({cwd: workspace.project, homedir: workspace.home});
    assert.equal(catalog.get('explorer'), BUILTIN_SUBAGENT_DEFINITIONS[0]);
    assert.equal(catalog.get('nested'), undefined);
    assert.equal(catalog.get('notes'), undefined);
    assert.deepEqual(catalog.diagnostics.map(({code, sourcePath}) => [code, sourcePath]), [
      ['invalid_name', path.resolve(invalidPath)],
      ['reserved_name', path.resolve(explorerPath)]
    ]);
    assert.equal(catalog.diagnostics.some(({message}) => message.includes('SECRET')), false);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('catalog maps capability ceilings, file_edit alias, MCP policy, and appended custom instructions', () => {
  const workspace = createWorkspace();
  try {
    writeAgent(workspace.project, 'readonly-ok', createManifest({tools: ['read_files', 'grep'], body: 'Readonly role.'}));
    writeAgent(workspace.project, 'general-ok', createManifest({capability: 'general', tools: ['file_edit', 'create_todos'], mcp: true, body: 'General role.'}));
    writeAgent(workspace.project, 'readonly-write', createManifest({tools: ['file_edit']}));
    writeAgent(workspace.project, 'readonly-mcp', createManifest({mcp: true}));
    writeAgent(workspace.project, 'general-unknown', createManifest({capability: 'general', tools: ['run_subagent']}));

    const catalog = loadSubagentCatalog({cwd: workspace.project, homedir: workspace.home});
    const readonly = catalog.get('readonly-ok');
    const general = catalog.get('general-ok');
    assert.deepEqual(readonly.localToolNames, ['read_files', 'grep']);
    assert.equal(readonly.includeMcpTools, false);
    assert.match(readonly.prompt, /Readonly Custom Subagent[\s\S]+Custom Agent Instructions: readonly-ok[\s\S]+Readonly role\./u);
    assert.deepEqual(general.localToolNames, ['apply_patch', 'edit_file', 'create_todos']);
    assert.equal(general.includeMcpTools, true);
    assert.equal(general.executionPolicy, 'general_purpose');
    assert.equal(catalog.get('readonly-write'), undefined);
    assert.equal(catalog.get('readonly-mcp'), undefined);
    assert.equal(catalog.get('general-unknown'), undefined);
    assert.deepEqual(catalog.diagnostics.map(({code}) => code), ['tool_not_allowed', 'mcp_not_allowed', 'tool_not_allowed']);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('catalog tolerates missing and unreadable optional directories with bounded diagnostics', () => {
  const workspace = createWorkspace();
  try {
    const projectAgents = path.join(workspace.project, '.echo', 'agents');
    const catalog = loadSubagentCatalog({
      cwd: workspace.project,
      homedir: workspace.home,
      readDir(dirPath) {
        if (dirPath === projectAgents) {
          const error = new Error('permission denied with secret details');
          error.code = 'EACCES';
          throw error;
        }
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
    });
    assert.deepEqual(catalog.listDescriptors().map(({name}) => name), ['explorer', 'worker']);
    assert.equal(catalog.diagnostics.length, 1);
    assert.equal(catalog.diagnostics[0].code, 'directory_unreadable');
    assert.equal(catalog.diagnostics[0].sourcePath, projectAgents);
    assert.ok(Array.from(catalog.diagnostics[0].message).length <= 500);
    assert.doesNotMatch(catalog.diagnostics[0].message, /secret/u);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('catalog limits custom definitions deterministically and keeps executable definitions immutable', () => {
  const workspace = createWorkspace();
  try {
    for (let index = 0; index < MAX_CUSTOM_SUBAGENTS + 2; index += 1) {
      writeAgent(workspace.project, `agent-${String(index).padStart(2, '0')}`);
    }
    const catalog = loadSubagentCatalog({cwd: workspace.project, homedir: workspace.home});
    const names = catalog.listDescriptors().map(({name}) => name);
    assert.equal(names.length, MAX_CUSTOM_SUBAGENTS + 2);
    assert.equal(names.includes('agent-31'), true);
    assert.equal(names.includes('agent-32'), false);
    assert.equal(catalog.diagnostics.filter(({code}) => code === 'custom_limit_exceeded').length, 2);
    assert.equal(Object.isFrozen(catalog), true);
    assert.equal(Object.isFrozen(catalog.diagnostics), true);
    assert.equal(Object.isFrozen(catalog.listDescriptors()), true);
    assert.equal(Object.isFrozen(catalog.get('agent-00')), true);
    assert.equal(Object.isFrozen(catalog.get('agent-00').localToolNames), true);
    assert.throws(() => catalog.get('agent-00').localToolNames.push('run_subagent'), TypeError);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('separate catalog loads reflect file changes while an existing catalog remains frozen', () => {
  const workspace = createWorkspace();
  try {
    const filePath = writeAgent(workspace.project, 'reviewer', createManifest({description: 'first version'}));
    const first = loadSubagentCatalog({cwd: workspace.project, homedir: workspace.home});
    fs.writeFileSync(filePath, createManifest({description: 'second version'}), 'utf8');
    const second = loadSubagentCatalog({cwd: workspace.project, homedir: workspace.home});
    assert.equal(first.get('reviewer').description, 'first version');
    assert.equal(second.get('reviewer').description, 'second version');
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});
