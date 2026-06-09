// Helpers de pagination offset/limit, partages par les services qui paginent
// (tastings, likes, mentions, follows, blocks, reports).

// Nombre de documents a sauter pour atteindre la page demandee (1-indexed).
export function pageSkip(page: number, limit: number): number {
  return (page - 1) * limit;
}

// Vrai s'il reste des pages apres la page courante.
export function hasMorePages(page: number, limit: number, total: number): boolean {
  return page * limit < total;
}
