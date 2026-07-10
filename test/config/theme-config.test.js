const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  DEFAULT_TUI_THEME,
  createTuiTheme,
  getBuiltinThemeConfigPath,
  listBuiltinThemes,
  readBuiltinTheme,
  getDefaultThemeConfigPath,
  readTuiTheme,
  readTuiThemeBaseId,
  selectBuiltinTheme
} = require('../../src/config/theme-config');
const {readLlmConfig} = require('../../src/config/llm-config');

test('readTuiTheme returns default theme when theme file is missing or invalid', () => {
  const missing = readTuiTheme({
    configPath: '/missing/theme.json',
    readFile() {
      throw new Error('missing');
    }
  });
  const invalid = readTuiTheme({
    readFile() {
      return '{not json';
    }
  });

  assert.deepEqual(missing, DEFAULT_TUI_THEME);
  assert.deepEqual(invalid, DEFAULT_TUI_THEME);
});

test('createTuiTheme merges valid render theme overrides and ignores invalid tokens', () => {
  const theme = createTuiTheme({
    blocks: {
      colors: {
        assistantPrefix: '#070809'
      }
    },
    footer: {
      focusBar: '┃',
      colors: {
        accent: '#010203',
        accentStrong: [4, 5, 6],
        selectionBackground: {ansi256: 99},
        codeForeground: {ansi256: 117},
        danger: 'not-a-color',
        muted: [999, 0, 0],
        unknown: '#ffffff'
      }
    },
    markdown: {
      styles: {
        link: {foreground: '#0a0b0c', bold: true}
      }
    },
    syntax: {
      keyword: {foreground: '#0d0e0f', bold: true},
      string: {foreground: {sgr: 32}}
    }
  });

  assert.deepEqual(theme.blocks.colors.assistantPrefix, {kind: 'rgb', value: [7, 8, 9]});
  assert.deepEqual(theme.footer.colors.accent, {kind: 'rgb', value: [1, 2, 3]});
  assert.deepEqual(theme.footer.colors.accentStrong, {kind: 'rgb', value: [4, 5, 6]});
  assert.deepEqual(theme.footer.colors.selectionBackground, {kind: 'ansi256', ansi256: 99});
  assert.deepEqual(theme.footer.colors.codeForeground, {kind: 'ansi256', ansi256: 117});
  assert.deepEqual(theme.footer.colors.danger, DEFAULT_TUI_THEME.footer.colors.danger);
  assert.deepEqual(theme.footer.colors.muted, DEFAULT_TUI_THEME.footer.colors.muted);
  assert.deepEqual(theme.markdown.styles.link, {foreground: {kind: 'rgb', value: [10, 11, 12]}, bold: true});
  assert.deepEqual(theme.syntax.keyword, {foreground: {kind: 'rgb', value: [13, 14, 15]}, bold: true});
  assert.deepEqual(theme.syntax.string, DEFAULT_TUI_THEME.syntax.string);
  assert.equal(theme.footer.focusBar, '┃');
});

test('builtin themes are listed and code default stays aligned with bundled JSON', () => {
  const themes = listBuiltinThemes();
  const ids = themes.map((theme) => theme.id);
  const defaultTheme = readBuiltinTheme('default', {
    readFile() {
      throw new Error('default theme should not be read from disk');
    }
  });
  const amberTheme = readBuiltinTheme('amber');
  const defaultThemePath = getBuiltinThemeConfigPath('default');
  const bundledDefaultTheme = createTuiTheme(JSON.parse(fs.readFileSync(defaultThemePath, 'utf8')));

  assert.deepEqual(ids, ['acid-lime', 'amber', 'aurora', 'crimson', 'default', 'default-light', 'desert', 'evergreen', 'frost', 'graphite', 'ink-wash', 'lagoon', 'lavender', 'macaron', 'monochrome', 'paper-dark', 'paper-light', 'plum-gold', 'porcelain', 'rose-dusk', 'solarized-light', 'spring-mist', 'sunbeam', 'violet']);
  assert.ok(themes.every((theme) => theme.label.length > 0));
  assert.deepEqual(defaultTheme, DEFAULT_TUI_THEME);
  assert.deepEqual(bundledDefaultTheme, DEFAULT_TUI_THEME);
  assert.equal(DEFAULT_TUI_THEME.footer.colors.diffText.kind, 'ansi256');
  assert.equal(DEFAULT_TUI_THEME.blocks.colors.assistantPrefix.kind, 'rgb');
  assert.equal(DEFAULT_TUI_THEME.syntax.keyword.bold, true);
  assert.equal(amberTheme.footer.colors.accent.kind, 'rgb');
  assert.equal(readBuiltinTheme('../default'), null);
  assert.equal(getBuiltinThemeConfigPath('../default'), null);
});

test('listBuiltinThemes keeps default metadata when theme directory cannot be read', () => {
  const themes = listBuiltinThemes({
    readDir() {
      throw new Error('missing dir');
    }
  });

  assert.deepEqual(themes.map((theme) => theme.id), ['default']);
  assert.equal(themes[0].label, 'Echo Default');
});

test('readTuiTheme uses selected builtin base and preserves user overrides', () => {
  const configPath = '/tmp/echo/theme.json';
  const amberPath = getBuiltinThemeConfigPath('amber');
  const theme = readTuiTheme({
    configPath,
    readFile(filePath) {
      if (filePath === configPath) {
        return JSON.stringify({
          theme: 'amber',
          footer: {
            colors: {
              accent: '#010203'
            }
          },
          syntax: {
            string: '#040506'
          }
        });
      }

      return fs.readFileSync(filePath, 'utf8');
    }
  });
  const amberTheme = readBuiltinTheme('amber');

  assert.deepEqual(theme.footer.colors.accent, {kind: 'rgb', value: [1, 2, 3]});
  assert.deepEqual(theme.syntax.string, {foreground: {kind: 'rgb', value: [4, 5, 6]}});
  assert.deepEqual(theme.footer.colors.accentStrong, amberTheme.footer.colors.accentStrong);
  assert.deepEqual(theme.blocks.colors.assistantPrefix, amberTheme.blocks.colors.assistantPrefix);
  assert.equal(readTuiThemeBaseId({
    configPath,
    readFile(filePath) {
      if (filePath === configPath) {
        return JSON.stringify({theme: 'amber'});
      }

      return fs.readFileSync(filePath, 'utf8');
    }
  }), 'amber');
  assert.equal(amberPath.endsWith('amber.json'), true);
});

test('readTuiTheme falls back to default base for invalid selected builtin theme', () => {
  const configPath = '/tmp/echo/theme.json';
  const theme = readTuiTheme({
    configPath,
    readFile(filePath) {
      if (filePath === configPath) {
        return JSON.stringify({
          theme: 'not-found',
          footer: {
            colors: {
              accent: '#070809'
            }
          }
        });
      }

      throw new Error('missing builtin theme');
    }
  });

  assert.deepEqual(theme.footer.colors.accent, {kind: 'rgb', value: [7, 8, 9]});
  assert.deepEqual(theme.footer.colors.accentStrong, DEFAULT_TUI_THEME.footer.colors.accentStrong);
  assert.equal(readTuiThemeBaseId({
    configPath,
    readFile(filePath) {
      if (filePath === configPath) {
        return JSON.stringify({theme: 'not-found'});
      }

      throw new Error('missing builtin theme');
    }
  }), 'default');
});

test('selectBuiltinTheme patches only root theme and writes atomically', () => {
  const configPath = '/tmp/echo/theme.json';
  const writes = [];
  const renames = [];
  const mkdirs = [];

  const result = selectBuiltinTheme('amber', {
    configPath,
    createTempPath: (targetPath) => `${targetPath}.tmp-test`,
    mkdir(dirPath, options) {
      mkdirs.push([dirPath, options]);
    },
    readFile(filePath) {
      if (filePath === configPath) {
        return JSON.stringify({
          theme: 'default',
          footer: {
            colors: {
              accent: '#010203'
            }
          },
          markdown: {
            styles: {
              link: '#040506'
            }
          }
        });
      }

      return fs.readFileSync(filePath, 'utf8');
    },
    writeFile(filePath, data) {
      writes.push([filePath, data]);
    },
    rename(oldPath, newPath) {
      renames.push([oldPath, newPath]);
    }
  });
  const saved = JSON.parse(writes[0][1]);

  assert.deepEqual(result, {ok: true});
  assert.deepEqual(mkdirs, [['/tmp/echo', {recursive: true}]]);
  assert.equal(writes[0][0], '/tmp/echo/theme.json.tmp-test');
  assert.deepEqual(renames, [['/tmp/echo/theme.json.tmp-test', '/tmp/echo/theme.json']]);
  assert.equal(saved.theme, 'amber');
  assert.deepEqual(saved.footer.colors.accent, '#010203');
  assert.deepEqual(saved.markdown.styles.link, '#040506');
});

test('selectBuiltinTheme creates theme file when missing and refuses unsafe input', () => {
  const writes = [];
  const created = selectBuiltinTheme('default', {
    configPath: '/tmp/echo/theme.json',
    createTempPath: (targetPath) => `${targetPath}.tmp-test`,
    mkdir() {},
    readFile(filePath) {
      if (filePath === '/tmp/echo/theme.json') {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }

      return fs.readFileSync(filePath, 'utf8');
    },
    writeFile(filePath, data) {
      writes.push([filePath, data]);
    },
    rename() {}
  });
  const invalidJson = selectBuiltinTheme('default', {
    readFile(filePath) {
      if (filePath.endsWith('theme.json')) {
        return '{broken';
      }

      return fs.readFileSync(filePath, 'utf8');
    },
    writeFile() {
      throw new Error('should not write');
    }
  });
  const nonObject = selectBuiltinTheme('default', {
    readFile(filePath) {
      if (filePath.endsWith('theme.json')) {
        return '[]';
      }

      return fs.readFileSync(filePath, 'utf8');
    },
    writeFile() {
      throw new Error('should not write');
    }
  });
  const unknown = selectBuiltinTheme('missing-theme', {
    writeFile() {
      throw new Error('should not write');
    }
  });

  assert.deepEqual(created, {ok: true});
  assert.deepEqual(JSON.parse(writes[0][1]), {theme: 'default'});
  assert.equal(invalidJson.ok, false);
  assert.match(invalidJson.error, /无法读取/);
  assert.equal(nonObject.ok, false);
  assert.match(nonObject.error, /JSON object/);
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /未知 theme/);
});

test('theme config is separate from LLM config semantics', () => {
  const llm = readLlmConfig({
    readFile(filePath) {
      assert.notEqual(filePath, getDefaultThemeConfigPath());
      return JSON.stringify({
        llm: {
          providers: {
            fake: {preset: 'fake-agent'}
          },
          models: [
            {id: 'fast', provider: 'fake', model: 'echo-fake-agent'}
          ],
          selectedModel: 'fast'
        }
      });
    }
  });
  const theme = readTuiTheme({
    readFile() {
      return '{broken theme';
    }
  });

  assert.equal(llm.model, 'echo-fake-agent');
  assert.deepEqual(theme, DEFAULT_TUI_THEME);
});
