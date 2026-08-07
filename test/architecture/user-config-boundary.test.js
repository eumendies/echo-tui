const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SOURCE_ROOT = path.resolve(__dirname, '../..');
const ROOT = fs.existsSync(path.join(SOURCE_ROOT, 'package.json'))
  ? SOURCE_ROOT
  : path.resolve(__dirname, '../../..');
const PRODUCTION_DIRS = ['src/app', 'src/agent', 'src/commands'];
const FORBIDDEN = /\b(?:readAppSettings|readLlmConfig(?:ForProfile)?|readLlmModelConfigInfo|readMcpConfig|readLifecycleHookConfig|JsonConfigFile)\b/u;
const USER_CONFIG_PARSER_FILES = [
  'src/config/app-settings-config.ts',
  'src/config/llm-config.ts',
  'src/config/llm-config-editor.ts',
  'src/config/mcp-config.ts',
  'src/hooks/config.ts'
];

function listTypeScriptFiles(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory()
      ? listTypeScriptFiles(target)
      : entry.isFile() && entry.name.endsWith('.ts') ? [target] : [];
  });
}

test('app, agent, and command production modules do not bypass UserConfigContext', () => {
  const violations = PRODUCTION_DIRS.flatMap((directory) => listTypeScriptFiles(path.join(ROOT, directory)))
    .flatMap((filePath) => FORBIDDEN.test(fs.readFileSync(filePath, 'utf8'))
      ? [path.relative(ROOT, filePath)]
      : []);

  assert.deepEqual(violations, []);
});

test('app and command composition consumers never create a second UserConfigContext', () => {
  const consumerPaths = [
    path.join(ROOT, 'src/app/state/app-context.ts'),
    ...listTypeScriptFiles(path.join(ROOT, 'src/app/command'))
  ];
  const violations = consumerPaths
    .filter((filePath) => /new UserConfigContext\s*\(/u.test(fs.readFileSync(filePath, 'utf8')))
    .map((filePath) => path.relative(ROOT, filePath));

  assert.deepEqual(violations, []);
});

test('only TUI and headless composition roots create UserConfigContext', () => {
  const allowed = new Set(['src/app/main.ts', 'src/cli/one-shot.ts']);
  const violations = listTypeScriptFiles(path.join(ROOT, 'src'))
    .filter((filePath) => /new UserConfigContext\s*\(/u.test(fs.readFileSync(filePath, 'utf8')))
    .map((filePath) => path.relative(ROOT, filePath))
    .filter((filePath) => !allowed.has(filePath));

  assert.deepEqual(violations, []);
});

test('user config domain parsers do not perform config file I/O', () => {
  const violations = USER_CONFIG_PARSER_FILES.filter((filePath) => /(?:JsonConfigFile|readOptionalUserConfig|watchUserConfig)/u.test(
    fs.readFileSync(path.join(ROOT, filePath), 'utf8')
  ));

  assert.deepEqual(violations, []);
});
