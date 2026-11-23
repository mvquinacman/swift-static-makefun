import { readFileSync, writeFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');
const { run } = await import('./solve.js');

const input = process.argv[2] ?? '/input/cases.json';
const output = process.argv[3] ?? '/output/answers.json';
const cases = JSON.parse(readFileSync(input, 'utf8'));
writeFileSync(output, JSON.stringify(cases.map(({ input }) => run(input))));
