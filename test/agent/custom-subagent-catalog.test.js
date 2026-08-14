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
  parseCustomSubagentManifest,
  serializeCustomSubagentManifest
} = require('../../src/agent/subagent/manifest');
const {parseAgentsSettings} = require('../../src/agent/subagent/settings');
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
  const modelLine = Object.hasOwn(overrides, 'model') ? `model: ${overrides.model}\n` : '';
  const effortLine = Object.hasOwn(overrides, 'effort') ? `effort: ${overrides.effort}\n` : '';
  const body = overrides.body || '# Role\n\nReturn concise findings.';
  return [
    '---',
    `description: ${description}`,
    `capability: ${capability}`,
    modelLine.trimEnd(),
    effortLine.trimEnd(),
    'tools:',
    ...tools.map((tool) => `  - ${tool}`),
    mcpLine.trimEnd(),
    '---',
    '',
    body
  ].filter((line, index) => line !== '' || index > 0).join('\n');
}

function createConfigSnapshot(modelProfileIds = ['parent']) {
  return {
    getLlmModelConfigInfo() {
      return {
        kind: 'profiles',
        selectedModelId: modelProfileIds[0],
        models: modelProfileIds.map((id) => ({id, provider: 'fake', model: `model-${id}`}))
      };
    }
  };
}

function writeAgent(base, name, content = createManifest()) {
  const agentsDir = path.join(base, '.echo', 'agents');
  fs.mkdirSync(agentsDir, {recursive: true});
  const filePath = path.join(agentsDir, `${name}.md`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function writeAgentsSettings(base, value) {
  const echoDir = path.join(base, '.echo');
  fs.mkdirSync(echoDir, {recursive: true});
  const filePath = path.join(echoDir, 'agents.settings.json');
  fs.writeFileSync(filePath, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
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
    effort: 'inherit',
    instructions: '# Reviewer\n\nCheck authentication.',
    mcp: true,
    tools: ['read_files', 'file_edit']
  });
});

test('manifest parser rejects missing, duplicate, unknown, typed, templated, and unsupported structures', () => {
  const invalidCases = [
    ['missing_field', '---\ndescription: x\ncapability: readonly\n---\nbody'],
    ['unknown_field', '---\ndescription: x\ncapability: readonly\ntools:\n  - grep\nprovider: secret\n---\nbody'],
    ['duplicate_field', '---\ndescription: x\ndescription: y\ncapability: readonly\ntools:\n  - grep\n---\nbody'],
    ['duplicate_tool', '---\ndescription: x\ncapability: readonly\ntools:\n  - grep\n  - grep\n---\nbody'],
    ['unsupported_structure', '---\ndescription: x\ncapability: readonly\ntools: [grep]\n---\nbody'],
    ['unsupported_structure', '---\ndescription: ${SECRET}\ncapability: readonly\ntools:\n  - grep\n---\nbody'],
    ['invalid_mcp', '---\ndescription: x\ncapability: general\ntools:\n  - grep\nmcp: "true"\n---\nbody'],
    ['empty_field', '---\ndescription: x\ncapability: readonly\nmodel: \ntools:\n  - grep\n---\nbody'],
    ['invalid_effort', '---\ndescription: x\ncapability: readonly\neffort: extreme\ntools:\n  - grep\n---\nbody'],
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

test('manifest parser and canonical serializer round-trip model, effort, and Markdown instructions', () => {
  const parsed = parseCustomSubagentManifest(createManifest({
    capability: 'general',
    model: 'review-model',
    effort: 'xhigh',
    tools: ['read_files', 'file_edit'],
    mcp: true,
    body: '# Role\n\n- keep this list\n- and spacing'
  }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.manifest.modelProfileId, 'review-model');
  assert.equal(parsed.manifest.effort, 'xhigh');

  const serialized = serializeCustomSubagentManifest(parsed.manifest);
  assert.equal(serialized, [
    '---',
    'description: Review a bounded area with concrete evidence.',
    'capability: general',
    'model: review-model',
    'effort: xhigh',
    'tools:',
    '  - read_files',
    '  - file_edit',
    'mcp: true',
    '---',
    '',
    '# Role',
    '',
    '- keep this list',
    '- and spacing',
    ''
  ].join('\n'));
  assert.deepEqual(parseCustomSubagentManifest(serialized), parsed);
});

test('agents settings parser is versioned and rejects unknown or malformed override fields', () => {
  const valid = parseAgentsSettings(JSON.stringify({
    schemaVersion: 1,
    overrides: {
      explorer: {modelProfileId: 'fast', effort: 'default'},
      worker: {effort: 'max'}
    }
  }));
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.settings, {
    schemaVersion: 1,
    overrides: {
      explorer: {modelProfileId: 'fast', effort: 'default'},
      worker: {effort: 'max'}
    }
  });

  for (const [code, value] of [
    ['unsupported_settings_version', {schemaVersion: 2, overrides: {}}],
    ['unknown_settings_field', {schemaVersion: 1, overrides: {}, secret: true}],
    ['invalid_settings_overrides', {schemaVersion: 1, overrides: {other: {}}}],
    ['invalid_builtin_override', {schemaVersion: 1, overrides: {worker: {tools: ['apply_patch']}}}],
    ['invalid_override_model', {schemaVersion: 1, overrides: {worker: {modelProfileId: ''}}}],
    ['invalid_override_model', {schemaVersion: 1, overrides: {worker: {modelProfileId: 'unsafe\u001b[31m'}}}],
    ['invalid_override_effort', {schemaVersion: 1, overrides: {worker: {effort: 'extreme'}}}]
  ]) {
    const parsedSettings = parseAgentsSettings(JSON.stringify(value));
    assert.equal(parsedSettings.ok, false);
    assert.equal(parsedSettings.error.code, code);
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

test('catalog strictly validates custom model profiles against the supplied snapshot', () => {
  const workspace = createWorkspace();
  try {
    writeAgent(workspace.project, 'valid-model', createManifest({model: 'reviewer', effort: 'default'}));
    const invalidPath = writeAgent(workspace.project, 'stale-model', createManifest({model: 'deleted', effort: 'high'}));
    const catalog = loadSubagentCatalog({
      configSnapshot: createConfigSnapshot(['parent', 'reviewer']),
      cwd: workspace.project,
      homedir: workspace.home
    });

    assert.equal(catalog.get('valid-model').modelProfileId, 'reviewer');
    assert.equal(catalog.get('valid-model').effortPolicy, 'default');
    assert.equal(catalog.get('stale-model'), undefined);
    const diagnostic = catalog.diagnostics.find(({sourcePath}) => sourcePath === invalidPath);
    assert.equal(diagnostic.code, 'model_profile_not_found');
    assert.match(diagnostic.message, /deleted/u);
    assert.doesNotMatch(diagnostic.message, /provider|apiKey|header/u);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('built-in settings use whole-entry project precedence and preserve every safety field', () => {
  const workspace = createWorkspace();
  try {
    writeAgentsSettings(workspace.home, {
      schemaVersion: 1,
      overrides: {
        explorer: {modelProfileId: 'user-model', effort: 'low'},
        worker: {modelProfileId: 'user-model', effort: 'high'}
      }
    });
    writeAgentsSettings(workspace.project, {
      schemaVersion: 1,
      overrides: {worker: {effort: 'default'}}
    });
    const catalog = loadSubagentCatalog({
      configSnapshot: createConfigSnapshot(['parent', 'user-model']),
      cwd: workspace.project,
      homedir: workspace.home
    });
    const explorer = catalog.get('explorer');
    const worker = catalog.get('worker');

    assert.equal(explorer.modelProfileId, 'user-model');
    assert.equal(explorer.effortPolicy, 'low');
    assert.equal(worker.modelProfileId, undefined);
    assert.equal(worker.effortPolicy, 'default');
    for (const [effective, original] of [[explorer, BUILTIN_SUBAGENT_DEFINITIONS[0]], [worker, BUILTIN_SUBAGENT_DEFINITIONS[1]]]) {
      assert.equal(effective.prompt, original.prompt);
      assert.equal(effective.description, original.description);
      assert.equal(effective.executionPolicy, original.executionPolicy);
      assert.equal(effective.includeMcpTools, original.includeMcpTools);
      assert.equal(effective.localToolNames, original.localToolNames);
    }
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('invalid higher-priority built-in settings fail closed without user fallback', () => {
  const workspace = createWorkspace();
  try {
    writeAgentsSettings(workspace.home, {
      schemaVersion: 1,
      overrides: {explorer: {modelProfileId: 'user-model', effort: 'max'}}
    });
    const projectPath = writeAgentsSettings(workspace.project, '{broken');
    let catalog = loadSubagentCatalog({
      configSnapshot: createConfigSnapshot(['parent', 'user-model']),
      cwd: workspace.project,
      homedir: workspace.home
    });
    assert.equal(catalog.get('explorer'), BUILTIN_SUBAGENT_DEFINITIONS[0]);
    assert.equal(catalog.diagnostics.some(({code, sourcePath}) => code === 'invalid_settings_json' && sourcePath === projectPath), true);

    writeAgentsSettings(workspace.project, {
      schemaVersion: 1,
      overrides: {explorer: {modelProfileId: 'deleted', effort: 'high'}}
    });
    catalog = loadSubagentCatalog({
      configSnapshot: createConfigSnapshot(['parent', 'user-model']),
      cwd: workspace.project,
      homedir: workspace.home
    });
    const explorer = catalog.get('explorer');
    assert.equal(explorer.modelProfileId, undefined);
    assert.equal(explorer.effortPolicy, 'inherit');
    assert.equal(catalog.diagnostics.some(({code}) => code === 'builtin_model_profile_not_found'), true);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('runtime settings loading rejects symbolic links like the management store', () => {
  const workspace = createWorkspace();
  try {
    const outside = path.join(workspace.root, 'outside-settings.json');
    fs.writeFileSync(outside, JSON.stringify({schemaVersion: 1, overrides: {explorer: {effort: 'high'}}}), 'utf8');
    const projectEcho = path.join(workspace.project, '.echo');
    fs.mkdirSync(projectEcho, {recursive: true});
    const settingsPath = path.join(projectEcho, 'agents.settings.json');
    fs.symlinkSync(outside, settingsPath);

    const catalog = loadSubagentCatalog({
      configSnapshot: createConfigSnapshot(['parent']),
      cwd: workspace.project,
      homedir: workspace.home
    });
    assert.equal(catalog.get('explorer'), BUILTIN_SUBAGENT_DEFINITIONS[0]);
    assert.equal(catalog.diagnostics.some(({code, sourcePath}) => code === 'symbolic_link' && sourcePath === settingsPath), true);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('runtime custom Agent discovery rejects symbolic links in the managed directory chain', () => {
  const workspace = createWorkspace();
  try {
    const outsideAgents = path.join(workspace.root, 'outside-agents');
    writeAgent(workspace.root, 'outside-only', createManifest());
    fs.renameSync(path.join(workspace.root, '.echo', 'agents'), outsideAgents);
    const projectEcho = path.join(workspace.project, '.echo');
    fs.mkdirSync(projectEcho, {recursive: true});
    const projectAgents = path.join(projectEcho, 'agents');
    fs.symlinkSync(outsideAgents, projectAgents);

    const catalog = loadSubagentCatalog({cwd: workspace.project, homedir: workspace.home});
    assert.equal(catalog.get('outside-only'), undefined);
    assert.equal(catalog.diagnostics.some(({code, sourcePath}) => code === 'unsafe_directory' && sourcePath === projectAgents), true);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('catalog tolerates missing and unreadable optional directories with bounded diagnostics', () => {
  const workspace = createWorkspace();
  try {
    const projectAgents = path.join(workspace.project, '.echo', 'agents');
    fs.mkdirSync(projectAgents, {recursive: true});
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
