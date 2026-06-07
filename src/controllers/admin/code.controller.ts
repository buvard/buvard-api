import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError.js';
import { createCode, deleteCode, listCodes } from '../../services/code.service.js';
import type { CreateCodeInput } from '../../zod/user.zod.js';

// POST /v1/admin/codes { code?, type, maxUses, expiresAt }
// Cree un code de redemption. Si `code` non fourni, le back genere un slug
// type "POCHTRON-2026-XYZ".
export async function postAdminCreateCode(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { code, type, maxUses, expiresAt } = req.body as CreateCodeInput;
  const created = await createCode({
    code,
    type,
    maxUses,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    createdBy: req.user._id,
  });
  res.status(201).json({ code: created.toJSON() });
}

// GET /v1/admin/codes — liste les 200 derniers codes (DESC createdAt).
export async function getAdminListCodes(_req: Request, res: Response): Promise<void> {
  const codes = await listCodes();
  res.json({ data: codes.map((c) => c.toJSON()) });
}

// DELETE /v1/admin/codes/:id — supprime un code (n'invalide pas les flags
// users qui l'ont deja redeem — c'est volontaire, le bonus reste acquis).
export async function deleteAdminCode(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  await deleteCode(id);
  res.status(204).end();
}
