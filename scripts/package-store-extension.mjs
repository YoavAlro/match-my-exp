import { execFile } from 'node:child_process';
import { readdir, rm, stat, utimes } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import packageJson from '../package.json' with { type: 'json' };

const executeFile = promisify(execFile);
const extensionDirectory = resolve('.output/chrome-mv3');
const outputPath = resolve(
  `.output/match-my-exp-${packageJson.version}-chrome-store.zip`,
);
const fixedTime = new Date('2000-01-01T00:00:00.000Z');

const filesUnder = async (directory, prefix = '') => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.toSorted((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(absolutePath, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
};

if (!(await stat(extensionDirectory)).isDirectory()) {
  throw new Error('Production extension build is missing');
}
const files = await filesUnder(extensionDirectory);
if (files.length === 0) {
  throw new Error('Production extension build is empty');
}
await Promise.all(
  files.map((file) =>
    utimes(resolve(extensionDirectory, file), fixedTime, fixedTime),
  ),
);
await rm(outputPath, { force: true });
await executeFile('zip', ['-X', '-q', outputPath, ...files], {
  cwd: extensionDirectory,
  env: { ...process.env, TZ: 'UTC' },
});

process.stdout.write(`${outputPath}\n`);
