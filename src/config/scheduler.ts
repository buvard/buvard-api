import cron, { type ScheduledTask } from 'node-cron';
import { logger } from './logger.js';
import { purgeExpiredAccounts } from '../services/account.service.js';

// Scheduler interne — taches periodiques de maintenance. Une seule instance
// doit l'executer (OK en mono-instance ; si scale horizontal, externaliser via
// un lock distribue ou un cron externe ciblant un endpoint admin).

let tasks: ScheduledTask[] = [];

// Anonymisation des comptes dont la periode de grace est ecoulee. Chaque nuit
// a 03:00 (Europe/Paris). Idempotent : reprend les comptes manques si un run
// a saute.
const PURGE_SCHEDULE = '0 3 * * *';

export function startScheduler(): void {
  const purgeTask = cron.schedule(
    PURGE_SCHEDULE,
    () => {
      void purgeExpiredAccounts().catch((err) => {
        logger.error({ err }, 'purge comptes : erreur non geree');
      });
    },
    { timezone: 'Europe/Paris' },
  );
  tasks.push(purgeTask);
  logger.info({ schedule: PURGE_SCHEDULE }, 'scheduler demarre (purge comptes)');
}

export function stopScheduler(): void {
  for (const task of tasks) void task.stop();
  tasks = [];
}
