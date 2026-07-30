const fs = require('node:fs');
const path = require('node:path');

const sourceRoot = path.join(process.cwd(), 'src', 'skills', 'builtin');
const targetRoot = path.join(process.cwd(), 'dist', 'src', 'skills', 'builtin');

copyAssets(sourceRoot, targetRoot);

function copyAssets(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  fs.mkdirSync(targetDir, {recursive: true});

  for (const entry of fs.readdirSync(sourceDir, {withFileTypes: true})) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyAssets(sourcePath, targetPath);
    } else if (entry.isFile() && (entry.name === 'SKILL.md' || sourcePath.includes(`${path.sep}reference${path.sep}`))) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}
