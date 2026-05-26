import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// En dev (src/config/version.ts) et en build (dist/config/version.js), package.json est deux niveaux au-dessus
const pkg = JSON.parse(
  readFileSync(join(here, '..', '..', 'package.json'), 'utf-8'),
) as { version: string };

export const APP_VERSION: string = pkg.version;
