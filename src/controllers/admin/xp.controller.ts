import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { AppError } from '../../utils/AppError.js';
import { adjustXp, setXp } from '../../services/user.service.js';
import type { AdminAdjustXpInput, AdminSetXpInput } from '../../zod/user.zod.js';

// POST /v1/admin/users/:id/xp { delta }
// Ajoute (delta > 0) ou retire (delta < 0) un nombre d'XP. Clamp a 0.
// Retourne le snapshot post-update.
export async function postAdminAdjustXp(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const { delta } = req.body as AdminAdjustXpInput;
  const result = await adjustXp(new Types.ObjectId(id), delta);
  res.json({ userId: id, ...result });
}

// PUT /v1/admin/users/:id/xp { xp }
// Force la valeur absolue d'XP du user. Utile pour reset / set explicit.
export async function putAdminSetXp(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const { xp } = req.body as AdminSetXpInput;
  const result = await setXp(new Types.ObjectId(id), xp);
  res.json({ userId: id, ...result });
}

// DELETE /v1/admin/users/:id/xp
// Raccourci : reset l'XP a 0 (donc level 1 + grade curious). Equivaut a
// PUT /xp { xp: 0 } mais plus explicite cote semantique HTTP.
export async function deleteAdminResetXp(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const result = await setXp(new Types.ObjectId(id), 0);
  res.json({ userId: id, ...result });
}

// Defense legere : si l'admin tape un id qui n'est pas un ObjectId valide,
// on rejette en 400 (le zod userIdParamSchema couvre deja ca mais une second
// defense ne mange pas de pain).
export function assertValidUserId(id: string): void {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('id invalide');
}
