import type { Types } from 'mongoose';
import sharp from 'sharp';
import { AppError } from '../utils/AppError.js';
import { TastingModel, type TastingDoc } from '../models/Tasting.js';
import type { UserDoc } from '../models/User.js';
import { BlockModel } from '../models/Block.js';
import { FollowModel } from '../models/Follow.js';
import { decrementTastingStats, incrementTastingStats } from './user.service.js';
import { deleteObject, extractKeyFromPublicUrl, uploadBuffer } from './storage.service.js';
import { clearMentions, syncMentions } from './mentions.service.js';
import type { CreateTastingInput, ListTastingsQuery, UpdateTastingInput } from '../zod/tasting.zod.js';

// Champs d'auteur renvoyes par populate — gardes minimaux pour les feeds.
export const AUTHOR_PROJECTION = 'username displayName avatarUrl' as const;

export interface TastingAuthor {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
}

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

async function loadBlockedIds(viewerId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const [blocking, blockedBy] = await Promise.all([
    BlockModel.find({ blockerId: viewerId }, { blockedId: 1 }).lean(),
    BlockModel.find({ blockedId: viewerId }, { blockerId: 1 }).lean(),
  ]);
  return [...blocking.map((b) => b.blockedId), ...blockedBy.map((b) => b.blockerId)];
}

export async function createTasting(user: UserDoc, input: CreateTastingInput): Promise<TastingDoc> {
  const created = await TastingModel.create({ ...input, userId: user._id });
  await incrementTastingStats(user._id, created.type);
  if (created.notes) {
    await syncMentions({
      sourceType: 'tasting_notes',
      sourceId: created._id,
      mentionerId: user._id,
      text: created.notes,
    });
  }
  await created.populate('userId', AUTHOR_PROJECTION);
  return created;
}

export async function listMyTastings(user: UserDoc, query: ListTastingsQuery): Promise<PaginatedTastings> {
  const filter: Record<string, unknown> = { userId: user._id, deletedAt: null };
  if (query.type) filter.type = query.type;

  const [data, total] = await Promise.all([
    TastingModel.find(filter)
      .populate('userId', AUTHOR_PROJECTION)
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
      .populate('userId', AUTHOR_PROJECTION)
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
  const tasting = await TastingModel.findOne({ _id: id, deletedAt: null }).populate('userId', AUTHOR_PROJECTION);
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
  await tasting.populate('userId', AUTHOR_PROJECTION);
  return tasting;
}

export async function deleteTasting(user: UserDoc, id: string): Promise<void> {
  const tasting = await TastingModel.findOne({ _id: id, deletedAt: null });
  if (!tasting) throw AppError.notFound('Tasting introuvable');
  if (!isOwner(tasting, user)) throw AppError.forbidden();

  // Snapshot des URLs avant le clear : on les utilise apres le save pour
  // delete les WebP sur R2 (best-effort, non bloquant).
  const photoUrls = [...tasting.photoUrls];

  tasting.photoUrls = [];
  tasting.deletedAt = new Date();
  await tasting.save();
  await decrementTastingStats(user._id, tasting.type);
  await clearMentions('tasting_notes', tasting._id);

  // Cleanup R2 — fire-and-forget pattern, on n'echoue pas la suppression du
  // tasting si R2 down. Tradeoff : la photo est definitivement perdue (pas
  // de feature "restore tasting" actuellement).
  await Promise.all(photoUrls.map((u) => deletePhotoByUrl(u).catch(() => undefined)));
}

// --- Feed & Discover ---

export async function listFeedTastings(viewer: UserDoc, query: ListTastingsQuery): Promise<PaginatedTastings> {
  // Comptes suivis par le viewer (l'auteur du tasting doit etre dans cette liste).
  const follows = await FollowModel.find({ followerId: viewer._id }, { followingId: 1 }).lean();
  const followingIds = follows.map((f) => f.followingId);

  // Si l'utilisateur ne suit personne, on renvoie une page vide — la decouverte
  // se fait via /discover.
  if (followingIds.length === 0) {
    return { data: [], page: query.page, limit: query.limit, total: 0, hasMore: false };
  }

  const blockedIds = await loadBlockedIds(viewer._id);
  const filter: Record<string, unknown> = {
    userId: { $in: followingIds, $nin: blockedIds },
    visibility: 'public',
    deletedAt: null,
  };
  if (query.type) filter.type = query.type;

  const [data, total] = await Promise.all([
    TastingModel.find(filter)
      .populate('userId', AUTHOR_PROJECTION)
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

export async function listDiscoverTastings(viewer: UserDoc | null, query: ListTastingsQuery): Promise<PaginatedTastings> {
  const filter: Record<string, unknown> = {
    visibility: 'public',
    deletedAt: null,
  };
  if (query.type) filter.type = query.type;

  // Exclut les contenus des comptes bloques (dans les deux sens) — uniquement si viewer connecte.
  if (viewer) {
    const blockedIds = await loadBlockedIds(viewer._id);
    if (blockedIds.length > 0) {
      filter.userId = { $nin: blockedIds };
    }
  }

  // V1 : trending = chronologique recent. La pondération (likes, vues) viendra avec V2.
  const [data, total] = await Promise.all([
    TastingModel.find(filter)
      .populate('userId', AUTHOR_PROJECTION)
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

// --- Photos de tasting ---

// Format carre 1080x1080 — assez gros pour zoom, optimal pour grilles type Instagram
const TASTING_PHOTO_SIZE = 1080;
const WEBP_QUALITY = 85;
// Limite IG-like : 10 photos max par degustation
export const MAX_TASTING_PHOTOS = 10;

async function deletePhotoByUrl(url: string | undefined | null): Promise<void> {
  const key = extractKeyFromPublicUrl(url);
  if (key) await deleteObject(key);
}

// Ajoute une photo en fin de tableau (max MAX_TASTING_PHOTOS).
export async function addTastingPhoto(user: UserDoc, id: string, file: Buffer): Promise<TastingDoc> {
  const tasting = await TastingModel.findOne({ _id: id, deletedAt: null });
  if (!tasting) throw AppError.notFound('Tasting introuvable');
  if (!isOwner(tasting, user)) throw AppError.forbidden();
  if (tasting.photoUrls.length >= MAX_TASTING_PHOTOS) {
    throw AppError.badRequest(`Maximum ${MAX_TASTING_PHOTOS} photos par degustation`);
  }

  const optimized = await sharp(file)
    .rotate()
    .resize(TASTING_PHOTO_SIZE, TASTING_PHOTO_SIZE, { fit: 'cover' })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  // Tri par categorie: tastings/{type}/{userId}/{tastingId}/{timestamp}.webp
  const key = `tastings/${tasting.type}/${String(user._id)}/${String(tasting._id)}/${Date.now()}.webp`;
  const { publicUrl } = await uploadBuffer(key, optimized, 'image/webp');

  tasting.photoUrls.push(publicUrl);
  await tasting.save();
  await tasting.populate('userId', AUTHOR_PROJECTION);
  return tasting;
}

// Retire une photo a un index donne (0-based).
export async function removeTastingPhotoAt(user: UserDoc, id: string, index: number): Promise<TastingDoc> {
  const tasting = await TastingModel.findOne({ _id: id, deletedAt: null });
  if (!tasting) throw AppError.notFound('Tasting introuvable');
  if (!isOwner(tasting, user)) throw AppError.forbidden();
  if (index < 0 || index >= tasting.photoUrls.length) {
    throw AppError.badRequest('Index de photo invalide');
  }

  const [removed] = tasting.photoUrls.splice(index, 1);
  await tasting.save();
  if (removed) await deletePhotoByUrl(removed);
  await tasting.populate('userId', AUTHOR_PROJECTION);
  return tasting;
}

// Reordonne les photos selon une permutation des indices actuels.
// Ex: photoUrls = [A, B, C] et order = [2, 0, 1] -> [C, A, B].
// Pas d'I/O R2 : les fichiers WebP restent au meme endroit, on ne touche que
// l'ordre du tableau cote DB.
export async function reorderTastingPhotos(
  user: UserDoc,
  id: string,
  order: number[],
): Promise<TastingDoc> {
  const tasting = await TastingModel.findOne({ _id: id, deletedAt: null });
  if (!tasting) throw AppError.notFound('Tasting introuvable');
  if (!isOwner(tasting, user)) throw AppError.forbidden();

  const n = tasting.photoUrls.length;
  if (order.length !== n) {
    throw AppError.badRequest('Ordre invalide : longueur incompatible');
  }
  // Verifie que c'est une permutation de [0..n-1] (chaque indice present une fois).
  const sorted = [...order].sort((a, b) => a - b);
  for (let i = 0; i < n; i++) {
    if (sorted[i] !== i) {
      throw AppError.badRequest('Ordre invalide : doit etre une permutation des indices');
    }
  }

  tasting.photoUrls = order.map((i) => tasting.photoUrls[i]);
  await tasting.save();
  await tasting.populate('userId', AUTHOR_PROJECTION);
  return tasting;
}

// Retire toutes les photos d'une degustation (soft cleanup au delete).
export async function removeAllTastingPhotos(user: UserDoc, id: string): Promise<TastingDoc> {
  const tasting = await TastingModel.findOne({ _id: id, deletedAt: null });
  if (!tasting) throw AppError.notFound('Tasting introuvable');
  if (!isOwner(tasting, user)) throw AppError.forbidden();
  if (tasting.photoUrls.length === 0) {
    await tasting.populate('userId', AUTHOR_PROJECTION);
    return tasting;
  }

  const urls = [...tasting.photoUrls];
  tasting.photoUrls = [];
  await tasting.save();
  await Promise.all(urls.map((u) => deletePhotoByUrl(u)));
  await tasting.populate('userId', AUTHOR_PROJECTION);
  return tasting;
}
