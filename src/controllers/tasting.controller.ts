import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';
import { getUserByUsername } from '../services/user.service.js';
import {
  createTasting,
  deleteTasting,
  getTastingForViewer,
  listMyTastings,
  listPublicTastingsForUser,
  updateTasting,
} from '../services/tasting.service.js';
import type {
  CreateTastingInput,
  ListTastingsQuery,
  UpdateTastingInput,
} from '../zod/tasting.zod.js';

function serialize(t: { toJSON: () => unknown }): unknown {
  return t.toJSON();
}

export async function postTasting(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const tasting = await createTasting(req.user, req.body as CreateTastingInput);
  res.status(201).json({ tasting: serialize(tasting) });
}

export async function listMine(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const result = await listMyTastings(req.user, req.query as unknown as ListTastingsQuery);
  res.json({ ...result, data: result.data.map(serialize) });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const tasting = await getTastingForViewer(id, req.user ?? null);
  res.json({ tasting: serialize(tasting) });
}

export async function patchOne(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { id } = req.params as { id: string };
  const tasting = await updateTasting(req.user, id, req.body as UpdateTastingInput);
  res.json({ tasting: serialize(tasting) });
}

export async function deleteOne(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { id } = req.params as { id: string };
  await deleteTasting(req.user, id);
  res.status(204).end();
}

export async function listForPublicProfile(req: Request, res: Response): Promise<void> {
  const { username } = req.params as { username: string };
  const user = await getUserByUsername(username);
  const result = await listPublicTastingsForUser(
    user._id,
    req.query as unknown as ListTastingsQuery,
  );
  res.json({ ...result, data: result.data.map(serialize) });
}
