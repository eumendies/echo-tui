#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {validateSettings, buildPlan, runEvaluation} = require('./eval-local-code-mode/harness');

async function main(argv) {
  const help = `Usage:
  node scripts/eval-local-code-mode.js --dry-run [--settings FILE]
  node scripts/eval-local-code-mode.js --self-test [--out DIR]
  node scripts/eval-local-code-mode.js --settings FILE --allow-real-model --out NEW_DIR

No model calls without --allow-real-model. --self-test uses deterministic scripted
providers and the real compiled agent/tool loop (not model performance evidence).
Build dist separately; this entry never builds and is outside default npm test.
See docs/local-code-mode.md for settings, budget and detection limits.`;
  if (argv.includes('--help')) {
    return console.log(help);
  }
  const allowed = new Set(['--dry-run', '--self-test', '--allow-real-model', '--settings', '--out']);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!allowed.has(key) || Object.hasOwn(values, key)) {
      throw Error(`Unknown/duplicate option: ${key}`);
    }
    values[key] = ['--settings', '--out'].includes(key) ? argv[++index] : true;
    if (typeof values[key] !== 'boolean' && (!values[key] || values[key].startsWith('--'))) {
      throw Error(`Missing value: ${key}`);
    }
  }
  if (!values['--dry-run'] && !values['--self-test'] && !values['--settings']) {
    throw Error(help);
  }
  if (values['--self-test'] && (values['--settings'] || values['--allow-real-model'])) {
    throw Error('--self-test cannot use real settings/opt-in');
  }
  const input = values['--settings']
    ? JSON.parse(fs.readFileSync(values['--settings'], 'utf8'))
    : {
        mode: 'scripted',
        repeats: 1,
        groups: ['native', 'optional', 'forced']
      };
  // 配置文件不能替用户授权真实请求；只认命令行的单次显式 opt-in。
  const settings = validateSettings({
    ...input,
    allowRealModel: Boolean(values['--allow-real-model'] || values['--dry-run']),
    ...(values['--out']
      ? {
          outputDir: path.resolve(values['--out'])
        }
      : {})
  });
  if (values['--dry-run']) {
    return console.log(JSON.stringify(buildPlan(settings), null, 2));
  }
  if (settings.mode === 'real' && !values['--out']) {
    throw Error('Real evaluation requires --out NEW_DIR to preserve raw evidence');
  }
  if (settings.outputDir && fs.existsSync(settings.outputDir)) {
    throw Error('Output directory must not already exist');
  }
  const report = await runEvaluation(settings);
  console.log(
    JSON.stringify(
      {
        summary: report.summary,
        releaseBlocked: report.releaseBlocked,
        outputDir: settings.outputDir || null
      },
      null,
      2
    )
  );
  if (report.releaseBlocked || report.cases.some((row) => row.failure || !row.verdict.success)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  main
};
