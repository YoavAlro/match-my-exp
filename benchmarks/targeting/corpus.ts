import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BenchmarkCorpusSchema } from './schemas';

const corpusPath = resolve('benchmarks/targeting/corpus.json');

export const readCorpusSource = () => readFile(corpusPath, 'utf8');

export const loadCorpus = async () =>
  BenchmarkCorpusSchema.parse(JSON.parse(await readCorpusSource()));
