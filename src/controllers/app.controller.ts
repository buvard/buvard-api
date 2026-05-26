import type { Request, Response } from 'express';
import { getLatestUpdateForClient } from '../services/release.service.js';
import type { LatestUpdateQuery } from '../zod/release.zod.js';

// Endpoint public consomme par Capgo Live Updates au boot de l'app native.
// Renvoie 204 si l'app est deja a jour, 200 + payload sinon.
export async function getLatestUpdate(req: Request, res: Response): Promise<void> {
  const { platform, currentVersion } = req.query as unknown as LatestUpdateQuery;
  const update = await getLatestUpdateForClient(platform, currentVersion);
  if (!update) {
    res.status(204).end();
    return;
  }
  res.json(update);
}
