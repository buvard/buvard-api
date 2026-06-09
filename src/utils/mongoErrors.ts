// Detecte une erreur de cle dupliquee MongoDB (code 11000) — leve lors d'une
// violation d'index unique. Sert a rendre les insertions idempotentes (follow,
// like, block, report, creation user concurrente...).
export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 11000;
}
