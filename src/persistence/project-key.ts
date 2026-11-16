import crypto from 'node:crypto';

/**
 * 计算 cwd 对应的稳定项目 key。
 *
 * transcript、usage 与受管 worker 工作区必须共用同一份实现：任何一处改变规则都会让
 * 同一项目被拆成多个分区，重建索引和成果定位都会失效。
 */
function createProjectKey(cwd: string): string {
  return crypto.createHash('sha1').update(String(cwd)).digest('hex');
}

export {createProjectKey};
