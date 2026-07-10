const fs = require('node:fs');
const path = require('node:path');

/**
 * 递归收集编译产物中的测试文件，让 `node --test dist/test` 可以通过目录入口运行。
 *
 * @param {string} directory
 * @returns {string[]}
 */
function collectTestFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectTestFiles(entryPath);
      }

      return entry.isFile() && entry.name.endsWith('.test.js') ? [entryPath] : [];
    })
    .sort();
}

for (const testFile of collectTestFiles(__dirname)) {
  require(testFile);
}
