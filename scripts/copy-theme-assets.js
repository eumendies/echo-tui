const fs = require('node:fs');
const path = require('node:path');

const sourceDir = path.join(process.cwd(), 'src', 'config', 'themes');
const targetDir = path.join(process.cwd(), 'dist', 'src', 'config', 'themes');

fs.mkdirSync(targetDir, {recursive: true});

for (const entry of fs.readdirSync(sourceDir)) {
  if (entry.endsWith('.json')) {
    fs.copyFileSync(path.join(sourceDir, entry), path.join(targetDir, entry));
  }
}
