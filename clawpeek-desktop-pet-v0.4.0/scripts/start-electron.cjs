const path = require('path');
const { spawn } = require('child_process');

const electronBinary = require('electron');
const projectRoot = path.resolve(__dirname, '..');
const env = { ...process.env };

// Some shells export ELECTRON_RUN_AS_NODE globally, which breaks GUI startup.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [projectRoot, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});

child.on('error', (error) => {
  console.error('Failed to launch Electron:', error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
