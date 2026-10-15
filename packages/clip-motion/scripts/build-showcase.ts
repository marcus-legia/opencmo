// Embeds fixtures/showcase.scene.jsx into fixtures/showcase.job.json (a test keeps them equal).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const job = JSON.parse(readFileSync(join(fixtures, 'showcase.job.json'), 'utf8'));
job.code = readFileSync(join(fixtures, 'showcase.scene.jsx'), 'utf8');
writeFileSync(join(fixtures, 'showcase.job.json'), `${JSON.stringify(job, null, 2)}\n`);
