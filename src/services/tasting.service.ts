import type { Types } from 'mongoose';
import sharp from 'sharp';
import { AppError } from '../utils/AppError.js';
import { TastingModel, type TastingDoc } from '../models/Tasting.js';
import type { UserDoc } from '../models/User.js';
import { decrementTastingStats, incrementTastingStats } from './user.service.js';
import { deleteObject, extractKeyFromPublicUrl, uploadBuffer } from './storage.service.js';
import { clearMentions, syncMentions } from './mentions.service.js';
import type { CreateTastingInput, ListTastingsQuery, UpdateTastingInput } from '../zod/tasting.zod.js';

export interface PaginatedTastings {
  data: TastingDoc[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

function isOwner(tasting: TastingDoc, user: UserDoc): boolean {
  return tasting.userId.toString() === user._id.toString();
}

export async function createTasting(user: UserDoc, input: CreateTastingInput): Promise<TastingDoc> {
  const tasting = await TastingModel.create({ ...input, userId: user._id });
  await incrementTastingStats(user._id, tasting.type);
  if (tasting.notes) {
    await syncMentions({
      sourceType: 'tasting_notes',
      sourceId: tasting._id,
      mentionerId: user._id,
      text: tasting.notes,
    });
  }
  return tasting;
}

export async function listMyTastings(user: UserDoc, query: ListTastingsQuery): Promise<PaginatedTastings> {
  const filter: Record<string, unknown> = { userId: user._id, deletedAt: null };
  if (query.type) filter.type = query.type;

  const [data, total] = await Promise.all([
    TastingModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit),
    TastingModel.countDocuments(filter),
  ]);

  return {
    data,
    page: query.page,
    limit: query.limit,
    total,
    hasMore: query.page * query.limit < total,
  };
}

export async function listPublicTastingsForUser(userId: Types.ObjectId, query: ListTastingsQuery): Promise<PaginatedTastings> {
  const filter: Record<string, unknown> = {
    userId,
    visibility: 'public',
    deletedAt: null,
  };
  if (query.type) filter.type = query.type;

  const [data, total] = await Promise.all([
    TastingModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit),
    TastingModel.countDocuments(filter),
  ]);

  return {
    data,
    page: query.page,
    limit: query.limit,
    total,
    hasMore: query.page * query.limit < total,
  };
}

export async function getTastingForViewer(id: string, viewer: UserDoc | null): Promise<TastingDoc> {
  const tasting = await TastingModel.findOne({ _id: id, deletedAt: null });
  if (!tasting) throw AppError.notFound('Tasting introuvable');

  if (tasting.visibility === 'public') return tasting;
  if (viewer && isOwner(tasting, viewer)) return tasting;
  throw AppError.forbidden();
}

export async function updateTasting(user: UserDoc, id: string, input: UpdateTastingInput): Promise<TastingDoc> {
  const tasting = await TastingModel.findOne({ _id: id, deletedAt: null });
  if (!tasting) throw AppError.notFound('Tasting introuvable');
  if (!isOwner(tasting, user)) throw AppError.forbidden();

  const previousType = tasting.type;
  const notesChanged = input.notes !== undefined && input.notes !== tasting.notes;
  Object.assign(tasting, input);
  await tasting.save();

  // Si le type a change, on rebalance les compteurs par categorie
  // (tastingsCount reste net car decrement -1 + increment +1 = 0)
  if (input.type && input.type !== previousType) {
    await Promise.all([
      decrementTastingStats(user._id, previousType),
      incrementTastingStats(user._id, tasting.type),
    ]);
  }

  // Re-synchronise les mentions si les notes ont change
  if (notesChanged) {
    await syncMentions({
      sourceType: 'tasting_notes',
      sourceId: tasting._id,
      mentionerId: user._id,
      text: tasting.notes,
    });
  }
  return tasting;
}

export async function deleteTasting(user: UserDoc, id: string): Promise<void> {
  const tasting = await TastingModel.findOne({ _id: id, deletedAt: null });
  if (!tasting) throw AppError.notFound('Tasting introuvable');
  if (!isOwner(tasting, user)) throw AppError.forbidden();

  tasting.deletedAt = new Date();
  await tasting.save();
  await decrementTastingStats(user._id, tasting.type);
  await clearMentions('tasting_notes', tasting._id);
}

// --- Photo de tasting ---

// Format carre 1080x1080 — assez gros pour zoom, optimal pour grilles type Instagram
const TASTING_PHOTO_SIZE = 1080;
const WEBP_QUALITY = 85;

async function deleteOldPhoto(previousUrl: string | undefined | null): Promise<void> {
  const key = extractKeyFromPublicUrl(previousUrl);
  if (key) await deleteObject(key);
}

export async function setTastingPhoto(user: UserDoc, id: string, file: Buffer): Promise<TastingDoc> {
  const tasting = await TastingModel.findOne({ _id: id, deletedAt: null });
  if (!tasting) throw AppError.notFound('Tasting introuvable');
  if (!isOwner(tasting, user)) throw AppError.forbidden();

  const optimized = await sharp(file)
    .rotate()
    .resize(TASTING_PHOTO_SIZE, TASTING_PHOTO_SIZE, { fit: 'cover' })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  // Tri par categorie: tastings/{type}/{userId}/{tastingId}/{timestamp}.webp
  const key = `tastings/${tasting.type}/${String(user._id)}/${String(tasting._id)}/${Date.now()}.webp`;
  const { publicUrl } = await uploadBuffer(key, optimized, 'image/webp');

  const previous = tasting.photoUrl;
  tasting.photoUrl = publicUrl;
  await tasting.save();

  if (previous && previous !== publicUrl) await deleteOldPhoto(previous);
  return tasting;
}

export async function removeTastingPhoto(user: UserDoc, id: string): Promise<TastingDoc> {
  const tasting = await TastingModel.findOne({ _id: id, deletedAt: null });
  if (!tasting) throw AppError.notFound('Tasting introuvable');
  if (!isOwner(tasting, user)) throw AppError.forbidden();

  const previous = tasting.photoUrl;
  if (!previous) return tasting;

  tasting.photoUrl = undefined;
  await tasting.save();
  await deleteOldPhoto(previous);
  return tasting;
}
