import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';
import {
  acceptPrivacy,
  acceptTerms,
  blockUser,
  completeOnboarding,
  followUser,
  getMyStats,
  getPrefs,
  getUserByUsername,
  listBlocks,
  listFollowers,
  listFollowing,
  removeAvatar,
  removeCover,
  searchUsers,
  setAvatar,
  setCover,
  softDeleteMe,
  unblockUser,
  unfollowUser,
  updateMe,
  updatePrefs,
} from '../services/user.service.js';
import { listMentionsForUser } from '../services/mentions.service.js';
import type {
  ListFollowsQuery,
  MentionsQuery,
  SearchUsersQuery,
  UpdateMeInput,
  UpdatePrefsInput,
} from '../zod/user.zod.js';

export async function getMe(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  res.json({ user: req.user.toJSON() });
}

export async function patchMe(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const updated = await updateMe(req.user, req.body as UpdateMeInput);
  res.json({ user: updated.toJSON() });
}

export async function deleteMe(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  await softDeleteMe(req.user);
  res.status(204).end();
}

export function getMyPrefs(req: Request, res: Response): void {
  if (!req.user) throw AppError.unauthorized();
  res.json({ prefs: getPrefs(req.user) });
}

export async function patchMyPrefs(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const prefs = await updatePrefs(req.user, req.body as UpdatePrefsInput);
  res.json({ prefs });
}

export async function getStats(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const stats = await getMyStats(req.user);
  res.json({ stats });
}

export async function getPublicProfile(req: Request, res: Response): Promise<void> {
  const { username } = req.params as { username: string };
  const user = await getUserByUsername(username);
  // Respect du flag privacy.profilePublic — 404 plutot que 403 pour ne pas leak l'existence
  if (user.prefs?.privacy?.profilePublic === false) {
    throw AppError.notFound('Utilisateur introuvable');
  }
  res.json({
    user: {
      id: String(user._id),
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      coverUrl: user.coverUrl,
      bio: user.bio,
      // Masque la location si le flag showLocation est off
      location: user.prefs?.privacy?.showLocation === false ? undefined : user.location,
      favoriteCategories: user.favoriteCategories,
      verified: user.verified,
      role: user.role,
      stats: {
        tastingsCount: user.stats?.tastingsCount ?? 0,
        followersCount: user.stats?.followersCount ?? 0,
        followingCount: user.stats?.followingCount ?? 0,
      },
      gamification: {
        level: user.gamification?.level ?? 1,
        xp: user.gamification?.xp ?? 0,
      },
      joinDate: user.createdAt,
    },
  });
}

// --- Onboarding & legal ---

export async function postCompleteOnboarding(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const user = await completeOnboarding(req.user);
  res.json({ onboardingCompletedAt: user.onboardingCompletedAt });
}

export async function postAcceptTerms(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const user = await acceptTerms(req.user);
  res.json({ acceptedTermsAt: user.acceptedTermsAt });
}

export async function postAcceptPrivacy(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const user = await acceptPrivacy(req.user);
  res.json({ acceptedPrivacyAt: user.acceptedPrivacyAt });
}

// --- Follow ---

export async function postFollow(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { username } = req.params as { username: string };
  await followUser(req.user, username);
  res.status(204).end();
}

export async function deleteFollow(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { username } = req.params as { username: string };
  await unfollowUser(req.user, username);
  res.status(204).end();
}

export async function getFollowers(req: Request, res: Response): Promise<void> {
  const { username } = req.params as { username: string };
  const result = await listFollowers(username, req.query as unknown as ListFollowsQuery);
  res.json(result);
}

export async function getFollowing(req: Request, res: Response): Promise<void> {
  const { username } = req.params as { username: string };
  const result = await listFollowing(username, req.query as unknown as ListFollowsQuery);
  res.json(result);
}

// --- Block ---

export async function postBlock(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { username } = req.params as { username: string };
  await blockUser(req.user, username);
  res.status(204).end();
}

export async function deleteBlock(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { username } = req.params as { username: string };
  await unblockUser(req.user, username);
  res.status(204).end();
}

export async function getMyBlocks(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const result = await listBlocks(req.user, req.query as unknown as ListFollowsQuery);
  res.json(result);
}

// --- Avatar & Cover ---

export async function postAvatar(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  if (!req.file) throw AppError.badRequest('Fichier requis (field "file")');
  const updated = await setAvatar(req.user, req.file.buffer);
  res.json({ avatarUrl: updated.avatarUrl });
}

export async function deleteAvatar(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  await removeAvatar(req.user);
  res.status(204).end();
}

export async function postCover(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  if (!req.file) throw AppError.badRequest('Fichier requis (field "file")');
  const updated = await setCover(req.user, req.file.buffer);
  res.json({ coverUrl: updated.coverUrl });
}

export async function deleteCover(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  await removeCover(req.user);
  res.status(204).end();
}

// --- Mentions & search ---

export async function getMyMentions(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { page, limit } = req.query as unknown as MentionsQuery;
  const result = await listMentionsForUser(req.user._id, page, limit);
  res.json(result);
}

export async function getSearchUsers(req: Request, res: Response): Promise<void> {
  const { q, limit } = req.query as unknown as SearchUsersQuery;
  const data = await searchUsers(q, limit, req.user ?? null);
  res.json({ data });
}
