import {bootstrapEchoUserSetup} from './user-setup-bootstrap';

/**
 * 安装期尽力初始化用户 setup；失败不阻断安装，首次运行 fallback 会再次补齐。
 */
function runPostinstallUserSetup(): void {
  try {
    bootstrapEchoUserSetup();
  } catch {
    // 安装期可能没有 home 写权限或跳过 dist 产物；启动前 fallback 负责最终一致性。
  }
}

runPostinstallUserSetup();

export {runPostinstallUserSetup};
