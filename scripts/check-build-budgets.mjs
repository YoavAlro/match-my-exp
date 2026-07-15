import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('.output/chrome-mv3');
const limits = {
  'background.js': 150 * 1024,
  'content-scripts/content.js': 100 * 1024,
};

for (const [file, limit] of Object.entries(limits)) {
  const size = (await stat(resolve(output, file))).size;
  if (size > limit) {
    throw new Error(`${file} exceeds ${limit} bytes`);
  }
}

const chunks = await readdir(resolve(output, 'chunks'));
const sidepanel = chunks.find((file) => file.startsWith('sidepanel-'));
if (sidepanel === undefined) {
  throw new Error('Side-panel bundle is missing');
}
if ((await stat(resolve(output, 'chunks', sidepanel))).size > 400 * 1024) {
  throw new Error('Side-panel JavaScript exceeds 400 KiB');
}

const directorySize = async (directory) => {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    total += entry.isDirectory()
      ? await directorySize(path)
      : (await stat(path)).size;
  }
  return total;
};

const total = await directorySize(output);
if (total > 750 * 1024) {
  throw new Error('Extension package exceeds 750 KiB');
}
process.stdout.write(`Build budgets passed: ${total} bytes total\n`);
