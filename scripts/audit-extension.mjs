import { readFile, readdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const output = resolve('.output/chrome-mv3');
const files = [];

const collect = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(path);
    } else {
      files.push(path);
    }
  }
};

await collect(output);
const textFiles = files.filter((file) =>
  ['.js', '.json', '.html', '.css'].includes(extname(file)),
);
const contents = await Promise.all(
  textFiles.map(async (file) => ({ file, text: await readFile(file, 'utf8') })),
);
const forbidden = [
  { name: 'eval', pattern: /\beval\s*\(/ },
  { name: 'Function constructor', pattern: /new\s+Function\s*\(/ },
  { name: 'remote script tag', pattern: /<script[^>]+src=["']https?:/i },
  { name: 'remote dynamic import', pattern: /import\s*\(\s*["']https?:/ },
  { name: 'OpenAI-like secret', pattern: /sk-[A-Za-z0-9_-]{16,}/ },
  { name: 'Google API secret', pattern: /AIza[A-Za-z0-9_-]{20,}/ },
  {
    name: 'authorization bearer value',
    pattern: /Bearer\s+[A-Za-z0-9_-]{20,}/,
  },
];

for (const { file, text } of contents) {
  for (const rule of forbidden) {
    if (rule.pattern.test(text)) {
      throw new Error(`${rule.name} found in ${file}`);
    }
  }
}

const manifest = JSON.parse(
  await readFile(resolve(output, 'manifest.json'), 'utf8'),
);
const requiredPermissions = [...(manifest.permissions ?? [])].toSorted();
const expectedPermissions = ['activeTab', 'scripting', 'sidePanel', 'storage'];
if (
  JSON.stringify(requiredPermissions) !== JSON.stringify(expectedPermissions)
) {
  throw new Error('Unexpected required extension permissions');
}
if ((manifest.host_permissions ?? []).length !== 0) {
  throw new Error('Required host permissions must remain empty');
}
if (
  JSON.stringify(manifest.optional_host_permissions ?? []) !==
  JSON.stringify(['https://*/*'])
) {
  throw new Error('Unexpected optional host permissions');
}
process.stdout.write(
  `Extension security audit passed for ${files.length} files\n`,
);
