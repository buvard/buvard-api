// Formate une duree en secondes en `Xj Xh Ym Zs` (jours omis si 0)
export function formatUptime(seconds: number): string {
  const total = Math.floor(seconds);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return d > 0 ? `${d}j ${h}h ${m}m ${s}s` : `${h}h ${m}m ${s}s`;
}

// Formate un timestamp (ms epoch) en date/heure lisible, fuseau Europe/Paris : `27/05/2026 14:34:34`
export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(ms);
}
