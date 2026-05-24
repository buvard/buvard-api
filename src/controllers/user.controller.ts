import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';
import { getUserByUsername, updateMe } from '../services/user.service.js';
import type { UpdateMeInput } from '../zod/user.zod.js';

export async function getMe(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  res.json({ user: req.user.toJSON() });
}

export async function patchMe(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const updated = await updateMe(req.user, req.body as UpdateMeInput);
  res.json({ user: updated.toJSON() });
}

export async function getPublicProfile(req: Request, res: Response): Promise<void> {
  const { username } = req.params as { username: string };
  const user = await getUserByUsername(username);
  res.json({
    user: {
      id: String(user._id),
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
    },
  });
}
