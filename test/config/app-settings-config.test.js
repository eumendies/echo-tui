const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_APP_SETTINGS,
  validateAppSettingsDraft
} = require('../../src/config/app-settings-config');
const {UserConfigContext} = require('../../src/config/user-config-context');

function withContext(options, read) {
  const context = new UserConfigContext(options);
  try {
    return read(context);
  } finally {
    context.close();
  }
}

function readAppSettings(options = {}) {
  return withContext(options, (context) => context.capture().getAppSettings());
}

function readAppSettingsDraft(options = {}) {
  return withContext(options, (context) => context.capture().getAppSettingsDraft());
}

function saveAppSettingsDraft(draft, options = {}) {
  return withContext(options, (context) => context.saveAppSettingsDraft(draft));
}

test('readAppSettings reads valid fields and falls back invalid fields independently', () => {
  const valid = readAppSettings({
    readFile() {
      return JSON.stringify({
        compaction: {thresholdRatio: 0.65},
        instructions: {fileName: 'CLAUDE.md'},
        skills: {catalogContextRatio: 0.05},
        tools: {approval: {mode: 'auto', modelProfileId: 'reviewer'}, fileEdit: {mode: 'edit_file'}, readFiles: {autoCompressImages: false}},
        ui: {defaultInteractionMode: 'plan', slashSuggestionMaxVisible: 12, showReasoningSummary: false}
      });
    }
  });
  const partial = readAppSettings({
    readFile() {
      return JSON.stringify({
        compaction: {thresholdRatio: Number.NaN},
        skills: {catalogContextRatio: 0.5},
        tools: {approval: {mode: 'unexpected'}},
        ui: {defaultInteractionMode: 'invalid', slashSuggestionMaxVisible: 30, showReasoningSummary: false}
      });
    }
  });

  assert.deepEqual(valid, {
    agentInstructionFileName: 'CLAUDE.md',
    autoCompressImages: false,
    compactionThresholdRatio: 0.65,
    defaultInteractionMode: 'plan',
    fileEditMode: 'edit_file',
    skillCatalogContextRatio: 0.05,
    slashSuggestionMaxVisible: 12,
    showReasoningSummary: false,
    toolApprovalMode: 'auto',
    toolApprovalModelProfileId: 'reviewer'
  });
  assert.deepEqual(partial, {
    ...DEFAULT_APP_SETTINGS,
    showReasoningSummary: false
  });
});

test('readAppSettings uses defaults for missing and malformed optional config', () => {
  assert.deepEqual(readAppSettings({readFile() { throw Object.assign(new Error('missing'), {code: 'ENOENT'}); }}), DEFAULT_APP_SETTINGS);
  assert.deepEqual(readAppSettings({readFile() { return '{broken'; }}), DEFAULT_APP_SETTINGS);
  assert.deepEqual(readAppSettings({readFile() { return JSON.stringify({compaction: {thresholdRatio: 0.49}, ui: {slashSuggestionMaxVisible: 0}}); }}), DEFAULT_APP_SETTINGS);
  assert.deepEqual(readAppSettings({readFile() { return JSON.stringify({compaction: {thresholdRatio: 0.95}, skills: {catalogContextRatio: 0.1}, ui: {slashSuggestionMaxVisible: 20}}); }}), {
    agentInstructionFileName: 'AGENTS.md',
    autoCompressImages: true,
    compactionThresholdRatio: 0.95,
    defaultInteractionMode: 'normal',
    fileEditMode: 'apply_patch',
    skillCatalogContextRatio: 0.1,
    slashSuggestionMaxVisible: 20,
    showReasoningSummary: true,
    toolApprovalMode: 'manual'
  });
});

test('readAppSettingsDraft allows missing files but reports malformed files', () => {
  assert.deepEqual(readAppSettingsDraft({readFile() { throw Object.assign(new Error('missing'), {code: 'ENOENT'}); }}), DEFAULT_APP_SETTINGS);
  assert.throws(() => readAppSettingsDraft({readFile() { return '{broken'; }}), /配置文件不是有效 JSON/);
});

test('saveAppSettingsDraft patches owned fields and writes atomically', () => {
  const writes = [];
  const renames = [];
  const mkdirs = [];

  saveAppSettingsDraft({
    agentInstructionFileName: 'CLAUDE.md',
    autoCompressImages: false,
    compactionThresholdRatio: 0.7,
    defaultInteractionMode: 'plan',
    fileEditMode: 'edit_file',
    skillCatalogContextRatio: 0.04,
    slashSuggestionMaxVisible: 5,
    showReasoningSummary: false,
    toolApprovalMode: 'manual'
  }, {
    configPath: '/tmp/echo/config.json',
    createTempPath: (targetPath) => `${targetPath}.tmp-test`,
    mkdir(dirPath, options) {
      mkdirs.push([dirPath, options]);
    },
    readFile() {
      return JSON.stringify({
        llm: {selectedModel: 'fast'},
        tools: {bash: {timeoutMs: 1000}, other: {kept: true}, readFiles: {other: 'kept'}},
        mcp: {enabled: true},
        hooks: {assistant_turn_end: ['echo done']},
        unknown: {kept: true},
        compaction: {keepCount: 20},
        instructions: {other: 'kept'},
        skills: {other: 'kept'},
        ui: {other: 'kept'}
      });
    },
    writeFile(filePath, data) {
      writes.push([filePath, data]);
    },
    rename(oldPath, newPath) {
      renames.push([oldPath, newPath]);
    }
  });

  const saved = JSON.parse(writes[0][1]);
  assert.deepEqual(mkdirs, [['/tmp/echo', {recursive: true}]]);
  assert.equal(writes[0][0], '/tmp/echo/config.json.tmp-test');
  assert.deepEqual(renames, [['/tmp/echo/config.json.tmp-test', '/tmp/echo/config.json']]);
  assert.equal(saved.compaction.thresholdRatio, 0.7);
  assert.equal(saved.compaction.keepCount, 20);
  assert.deepEqual(saved.instructions, {other: 'kept', fileName: 'CLAUDE.md'});
  assert.deepEqual(saved.skills, {other: 'kept', catalogContextRatio: 0.04});
  assert.deepEqual(saved.ui, {other: 'kept', defaultInteractionMode: 'plan', slashSuggestionMaxVisible: 5, showReasoningSummary: false});
  assert.equal(saved.llm.selectedModel, 'fast');
  assert.equal(saved.tools.bash.timeoutMs, 1000);
  assert.equal(saved.tools.fileEdit.mode, 'edit_file');
  assert.deepEqual(saved.tools.readFiles, {other: 'kept', autoCompressImages: false});
  assert.deepEqual(saved.tools.other, {kept: true});
  assert.equal(saved.mcp.enabled, true);
  assert.deepEqual(saved.hooks.assistant_turn_end, ['echo done']);
  assert.deepEqual(saved.unknown, {kept: true});
});

test('saveAppSettingsDraft creates missing config and rejects invalid drafts before writing', () => {
  const writes = [];
  const options = {
    configPath: '/tmp/echo/config.json',
    mkdir() {},
    readFile() {
      throw Object.assign(new Error('missing'), {code: 'ENOENT'});
    },
    writeFile(_path, data) {
      writes.push(JSON.parse(data));
    },
    rename() {}
  };

  saveAppSettingsDraft(DEFAULT_APP_SETTINGS, options);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], {
    compaction: {thresholdRatio: 0.8},
    instructions: {fileName: 'AGENTS.md'},
    skills: {catalogContextRatio: 0.02},
    ui: {defaultInteractionMode: 'normal', slashSuggestionMaxVisible: 8, showReasoningSummary: true},
    tools: {approval: {mode: 'manual'}, fileEdit: {mode: 'apply_patch'}, readFiles: {autoCompressImages: true}}
  });
  assert.deepEqual(validateAppSettingsDraft({...DEFAULT_APP_SETTINGS, compactionThresholdRatio: 0.49}), {ok: false, error: '自动压缩阈值必须在 50% 到 95% 之间'});
  assert.deepEqual(validateAppSettingsDraft({...DEFAULT_APP_SETTINGS, skillCatalogContextRatio: 0.11}), {ok: false, error: '技能列表上下文占比上限必须在 1% 到 10% 之间'});
  assert.deepEqual(validateAppSettingsDraft({...DEFAULT_APP_SETTINGS, defaultInteractionMode: 'shell'}), {ok: false, error: '默认启动模式必须是普通或规划'});
  assert.deepEqual(validateAppSettingsDraft({...DEFAULT_APP_SETTINGS, slashSuggestionMaxVisible: 21}), {ok: false, error: 'Slash suggestion 显示数量必须在 1 到 20 之间'});
  assert.deepEqual(validateAppSettingsDraft({...DEFAULT_APP_SETTINGS, agentInstructionFileName: 'OTHER.md'}), {ok: false, error: '项目指令文件必须是 AGENTS.md 或 CLAUDE.md'});
  assert.deepEqual(validateAppSettingsDraft({...DEFAULT_APP_SETTINGS, fileEditMode: 'other'}), {ok: false, error: '文件编辑工具必须是 apply_patch 或 edit_file'});
  assert.deepEqual(validateAppSettingsDraft({...DEFAULT_APP_SETTINGS, autoCompressImages: 'yes'}), {ok: false, error: '超限图片自动压缩设置必须是布尔值'});
  assert.deepEqual(validateAppSettingsDraft({...DEFAULT_APP_SETTINGS, toolApprovalMode: 'invalid'}), {ok: false, error: '工具审批模式必须是 manual 或 auto'});
  assert.throws(() => saveAppSettingsDraft({...DEFAULT_APP_SETTINGS, slashSuggestionMaxVisible: 0}, {
    writeFile() {
      throw new Error('should not write');
    }
  }), /1 到 20/);
});

test('auto approval settings require an existing model profile and preserve approval siblings', () => {
  const writes = [];
  const base = {
    llm: {
      providers: {openai: {preset: 'openai-responses-api', apiKey: 'key'}},
      models: [{id: 'reviewer', provider: 'openai', model: 'gpt-review'}]
    },
    tools: {approval: {mode: 'manual', modelProfileId: 'old', kept: true}}
  };
  const options = {
    configPath: '/tmp/echo/config.json',
    mkdir() {},
    readFile() { return JSON.stringify(base); },
    writeFile(_path, data) { writes.push(JSON.parse(data)); },
    rename() {}
  };

  saveAppSettingsDraft({...DEFAULT_APP_SETTINGS, toolApprovalMode: 'auto', toolApprovalModelProfileId: 'reviewer'}, options);
  assert.deepEqual(writes[0].tools.approval, {mode: 'auto', modelProfileId: 'reviewer', kept: true});
  assert.throws(() => saveAppSettingsDraft({...DEFAULT_APP_SETTINGS, toolApprovalMode: 'auto', toolApprovalModelProfileId: 'deleted'}, options), /已保存的有效模型 profile/);

  saveAppSettingsDraft({...DEFAULT_APP_SETTINGS, toolApprovalModelProfileId: 'deleted'}, options);
  assert.equal(writes[1].tools.approval.modelProfileId, 'deleted');
});
