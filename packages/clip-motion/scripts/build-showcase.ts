// Embeds fixtures/<name>.scene.jsx into fixtures/<name>.job.json for the showcase and vaccine fixtures
// (a test keeps them equal).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
for (const name of ['showcase', 'vaccine']) {
	const file = join(fixtures, `${name}.job.json`);
	const job = JSON.parse(readFileSync(file, 'utf8'));
	job.code = readFileSync(join(fixtures, `${name}.scene.jsx`), 'utf8');
	writeFileSync(file, `${JSON.stringify(job, null, 2)}\n`);
}
