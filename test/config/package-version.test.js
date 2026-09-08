const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {readPackageVersion} = require('../../src/config/package-version');

// 与架构守卫测试一致：测试可能从源码树或 dist 树运行，需要向上定位真正的仓库根目录。
// 注意不能以模块形式 require package.json，否则 tsc 会把该 JSON 镜像发射到 dist/，
// 破坏架构测试对运行根目录的探测。
const SOURCE_ROOT = path.resolve(__dirname, '../..');
const ROOT = fs.existsSync(path.join(SOURCE_ROOT, 'package.json'))
  ? SOURCE_ROOT
  : path.resolve(__dirname, '../../..');

test('readPackageVersion returns the package.json version', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  assert.equal(readPackageVersion(), packageJson.version);
});
