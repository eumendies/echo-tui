const {spawnSync} = require('node:child_process');

/** 用有限寿命子进程检测信号权限；即使沙箱拒绝 kill，也不会遗留无限等待。 */
function canSignalChildProcesses() {
  const probe = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const {spawn} = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 250)'], {stdio: 'ignore'});
    child.on('error', () => {
      process.exitCode = 1;
    });
    child.once('spawn', () => child.kill('SIGTERM'));
    child.once('close', (_code, signal) => {
      process.exitCode = signal === 'SIGTERM' ? 0 : 1;
    });
  `
    ],
    {stdio: 'ignore'}
  );
  return probe.status === 0;
}

module.exports = {canSignalChildProcesses};
