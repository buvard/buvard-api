import { clerkClient } from '@clerk/express';
import { AppError } from '../utils/AppError.js';
import { UserModel, type UserDoc } from '../models/User.js';
import type { UpdateMeInput } from '../zod/user.zod.js';

// Genere un username unique a partir d'une base proposee par Clerk
async function ensureUniqueUsername(base: string): Promise<string> {
  const normalized =
    base
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, '')
      .slice(0, 28) || 'user';

  let candidate = normalized;
  let suffix = 0;
  while (await UserModel.exists({ username: candidate })) {
    suffix += 1;
    candidate = `${normalized}${suffix}`.slice(0, 32);
    if (suffix > 9999) {
      candidate = `${normalized.slice(0, 22)}${Date.now().toString(36)}`.slice(0, 32);
      break;
    }
  }
  return candidate;
}

interface ClerkUpsertPayload {
  clerkId: string;
  username: string | null;
  emailPrefix: string | null;
  fullName: string | null;
  imageUrl: string | null;
}

export async function findOrCreateUserFromClerk(clerkId: string): Promise<UserDoc> {
  const existing = await UserModel.findOne({ clerkId });
  if (existing) return existing;

  const clerkUser = await clerkClient.users.getUser(clerkId);
  const primaryEmail = clerkUser.emailAddresses[0]?.emailAddress ?? null;
  const baseUsername =
    clerkUser.username ??
    (primaryEmail ? primaryEmail.split('@')[0] ?? null : null) ??
    `user_${clerkId.slice(-6)}`;
  const username = await ensureUniqueUsername(baseUsername);
  const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || null;

  return UserModel.create({
    clerkId,
    username,
    displayName: fullName ?? username,
    avatarUrl: clerkUser.imageUrl || undefined,
  });
}

export async function upsertUserFromWebhook(payload: ClerkUpsertPayload): Promise<UserDoc> {
  const existing = await UserModel.findOne({ clerkId: payload.clerkId });
  if (existing) {
    if (payload.fullName) existing.displayName = payload.fullName;
    if (payload.imageUrl) existing.avatarUrl = payload.imageUrl;
    await existing.save();
    return existing;
  }
  const baseUsername =
    payload.username ?? payload.emailPrefix ?? `user_${payload.clerkId.slice(-6)}`;
  const username = await ensureUniqueUsername(baseUsername);
  return UserModel.create({
    clerkId: payload.clerkId,
    username,
    displayName: payload.fullName ?? username,
    avatarUrl: payload.imageUrl ?? undefined,
  });
}

export async function softDeleteUserByClerkId(clerkId: string): Promise<void> {
  await UserModel.updateOne({ clerkId }, { $set: { deletedAt: new Date() } });
}

export async function getUserByUsername(username: string): Promise<UserDoc> {
  const user = await UserModel.findOne({ username, deletedAt: null });
  if (!user) throw AppError.notFound('Utilisateur introuvable');
  return user;
}

export async function updateMe(user: UserDoc, input: UpdateMeInput): Promise<UserDoc> {
  if (input.username && input.username !== user.username) {
    const taken = await UserModel.exists({ username: input.username });
    if (taken) throw AppError.conflict('Username deja pris');
    user.username = input.username;
  }
  if (input.displayName !== undefined) user.displayName = input.displayName;
  if (input.bio !== undefined) user.bio = input.bio;
  if (input.avatarUrl !== undefined) user.avatarUrl = input.avatarUrl;
  await user.save();
  return user;
}
