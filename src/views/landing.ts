import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { APP_VERSION } from '../config/version.js';
import { formatUptime } from '../utils/format.js';

const here: string = dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR: string = join(here, '..', '..', 'public');
// Template charge une fois au boot, on substitue les valeurs dynamiques au render
const TEMPLATE = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf-8');

export function renderLanding(): string {
  return TEMPLATE.replaceAll('{{VERSION}}', APP_VERSION)
    .replaceAll('{{ENV}}', env.NODE_ENV)
    .replaceAll('{{UPTIME}}', formatUptime(process.uptime()))
    .replaceAll('{{TIME}}', new Date().toISOString());
}
