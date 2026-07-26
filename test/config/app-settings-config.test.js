const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_APP_SETTINGS,
  readAppSettings,
  readAppSettingsDraft,
  saveAppSettingsDraft,
  validateAppSettingsDraft
} = require('../../src/config/app-settings-config');

test('readAppSettings reads valid fields and falls back invalid fields independently', () => {
  const valid = readAppSettings({
    readFile() {
      return JSON.stringify({
        compaction: {thresholdRatio: 0.65},
        skills: {catalogContextRatio: 0.05},
        ui: {slashSuggestionMaxVisible: 12, showReasoningSummary: false}
      });
    }
  });
  const partial = readAppSettings({
    readFile() {
      return JSON.stringify({
        compaction: {thresholdRatio: Number.NaN},
        skills: {catalogContextRatio: 0.5},
        ui: {slashSuggestionMaxVisible: 30, showReasoningSummary: false}
      });
    }
  });

  assert.deepEqual(valid, {
    compactionThresholdRatio: 0.65,
    skillCatalogContextRatio: 0.05,
    slashSuggestionMaxVisible: 12,
    showReasoningSummary: false
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
    compactionThresholdRatio: 0.95,
    skillCatalogContextRatio: 0.1,
    slashSuggestionMaxVisible: 20,
    showReasoningSummary: true
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
    compactionThresholdRatio: 0.7,
    skillCatalogContextRatio: 0.04,
    slashSuggestionMaxVisible: 5,
    showReasoningSummary: false
  }, {
    configPath: '/tmp/echo/config.json',
    createTempPath: (targetPath) => `${targetPath}.tmp-test`,
    mkdir(dirPath, options) {
      mkdirs.push([dirPath, options]);
    },
    readFile() {
      return JSON.stringify({
        llm: {selectedModel: 'fast'},
        tools: {bash: {timeoutMs: 1000}},
        mcp: {enabled: true},
        hooks: {assistant_turn_end: ['echo done']},
        unknown: {kept: true},
        compaction: {keepCount: 20},
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
  assert.deepEqual(saved.skills, {other: 'kept', catalogContextRatio: 0.04});
  assert.deepEqual(saved.ui, {other: 'kept', slashSuggestionMaxVisible: 5, showReasoningSummary: false});
  assert.equal(saved.llm.selectedModel, 'fast');
  assert.equal(saved.tools.bash.timeoutMs, 1000);
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
    skills: {catalogContextRatio: 0.02},
    ui: {slashSuggestionMaxVisible: 8, showReasoningSummary: true}
  });
  assert.deepEqual(validateAppSettingsDraft({...DEFAULT_APP_SETTINGS, compactionThresholdRatio: 0.49}), {ok: false, error: '自动压缩阈值必须在 50% 到 95% 之间'});
  assert.deepEqual(validateAppSettingsDraft({...DEFAULT_APP_SETTINGS, skillCatalogContextRatio: 0.11}), {ok: false, error: '技能列表上下文占比上限必须在 1% 到 10% 之间'});
  assert.deepEqual(validateAppSettingsDraft({...DEFAULT_APP_SETTINGS, slashSuggestionMaxVisible: 21}), {ok: false, error: 'Slash suggestion 显示数量必须在 1 到 20 之间'});
  assert.throws(() => saveAppSettingsDraft({...DEFAULT_APP_SETTINGS, slashSuggestionMaxVisible: 0}, {
    writeFile() {
      throw new Error('should not write');
    }
  }), /1 到 20/);
});
