const { readFileSync } = require('node:fs');
const { basename, resolve } = require('node:path');
const { parse } = require('dotenv');

const root = resolve(__dirname, '../..');

module.exports = {
  apps: [
    {
      name: basename(root),
      script: resolve(__dirname, 'main.js'),
      cwd: __dirname,
      interpreter: process.execPath,
      exec_mode: 'fork',
      instances: 1,
      kill_timeout: 45000,
      restart_delay: 5000,
      env: parse(readFileSync(resolve(root, 'shared/.env'))),
    },
  ],
};
