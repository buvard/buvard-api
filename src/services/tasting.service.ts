import type { Types } from 'mongoose';
import sharp from 'sharp';
import { AppError } from '../utils/AppError.js';
import { TastingModel, type TastingDoc, type TastingType } from '../models/Tasting.js';
import type { UserDoc } from '../models/User.js';
import { BlockModel } from '../models/Block.js';
import { LikeModel } from '../models/Like.js';
import {
  awardTastingXp,
  decrementTastingStats,
  grantXp,
  incrementTastingStats,
  LONG_NOTES_THRESHOLD,
  MIN_AROMAS_FOR_BONUS,
  XP_BONUS_AROMAS,
  XP_BONUS_LONG_NOTES,
  XP_BONUS_PLACE,
  XP_FIRST_TASTING,
  XP_PER_PHOTO_ADDITIONAL,
  XP_PER_TASTING,
} from './user.service.js';
import { deleteObject, extractKeyFromPublicUrl, uploadBuffer } from './storage.service.js';
import { hasMorePages, pageSkip } from '../utils/pagination.js';
import { clearMentions, syncMentions } from './mentions.service.js';
import type {
  CreateTastingInput,
  ListDiscoverPlacesQuery,
  ListTastingsQuery,
  UpdateTastingInput,
} from '../zod/tasting.zod.js';

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

  // Calcul du baseXp avec bonus qualite (encourage le contenu riche) :
  // +5 si lieu, +5 si notes >= 50 chars, +3 si >= 3 aromas. Ces bonus sont
  // additifs et plafonnes par la limite des champs eux-memes.
  let baseXp = XP_PER_TASTING;
  if (input.place?.name?.trim()) baseXp += XP_BONUS_PLACE;
  if (input.notes && input.notes.length >= LONG_NOTES_THRESHOLD) baseXp += XP_BONUS_LONG_NOTES;
  if (input.aromas && input.aromas.length >= MIN_AROMAS_FOR_BONUS) baseXp += XP_BONUS_AROMAS;
  // Premiere degustation jamais publiee : bonus one-shot. Lu sur les stats
  // *avant* l'increment (donc 0 si c'est la 1ere).
  const previousCount = user.stats?.tastingsCount ?? 0;
  if (previousCount === 0) baseXp += XP_FIRST_TASTING;

  await awardTastingXp(user._id, baseXp);

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
      .skip(pageSkip(query.page, query.limit))
      .limit(query.limit),
    TastingModel.countDocuments(filter),
  ]);

  return {
    data,
    page: query.page,
    limit: query.limit,
    total,
    hasMore: hasMorePages(query.page, query.limit, total),
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
      .skip(pageSkip(query.page, query.limit))
      .limit(query.limit),
    TastingModel.countDocuments(filter),
  ]);

  return {
    data,
    page: query.page,
    limit: query.limit,
    total,
    hasMore: hasMorePages(query.page, query.limit, total),
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
  // Les likes d'un tasting supprime n'ont plus de sens : on les purge (pas de
  // feature "restore" qui les attendrait). Les listings de likers filtrent deja
  // sur le tasting non supprime, mais ca evite des docs Like orphelins.
  await LikeModel.deleteMany({ tastingId: tasting._id });

  // Cleanup R2 — fire-and-forget pattern, on n'echoue pas la suppression du
  // tasting si R2 down. Tradeoff : la photo est definitivement perdue (pas
  // de feature "restore tasting" actuellement).
  await Promise.all(photoUrls.map((u) => deletePhotoByUrl(u).catch(() => undefined)));
}

// --- Feed & Discover ---

export async function listFeedTastings(viewer: UserDoc, query: ListTastingsQuery): Promise<PaginatedTastings> {
  // Feed V1 : completement ouvert. Tous les tastings publics (auteurs non
  // bloques). Les tastings prives n'apparaissent jamais ici, meme les siens —
  // un brouillon prive reste un brouillon (visible uniquement sur son profil).
  const blockedIds = await loadBlockedIds(viewer._id);

  const filter: Record<string, unknown> = {
    visibility: 'public',
    deletedAt: null,
    userId: { $nin: blockedIds },
  };
  if (query.type) filter.type = query.type;

  const [data, total] = await Promise.all([
    TastingModel.find(filter)
      .populate('userId', AUTHOR_PROJECTION)
      .sort({ createdAt: -1 })
      .skip(pageSkip(query.page, query.limit))
      .limit(query.limit),
    TastingModel.countDocuments(filter),
  ]);

  return {
    data,
    page: query.page,
    limit: query.limit,
    total,
    hasMore: hasMorePages(query.page, query.limit, total),
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
      .skip(pageSkip(query.page, query.limit))
      .limit(query.limit),
    TastingModel.countDocuments(filter),
  ]);

  return {
    data,
    page: query.page,
    limit: query.limit,
    total,
    hasMore: hasMorePages(query.page, query.limit, total),
  };
}

// ============================================================
// Decouverte des lieux
// ============================================================

// Un lieu agrege a partir des degustations publiques. Sert l'onglet
// "Decouvrir" cote front (page Map) — on renvoie directement les places
// stats-only, plutot que les degustations brutes a grouper en JS.
export interface DiscoveredPlace {
  placeId: string | null;
  name: string;
  lat: number;
  lng: number;
  tastingsCount: number;
  averageRating: number;
  lastTastingAt: Date;
  coverPhotoUrl: string | null;
  sampleTypes: TastingType[];
}

export interface PaginatedDiscoveredPlaces {
  data: DiscoveredPlace[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

// Agrege les degustations publiques par lieu (placeId quand dispo, sinon
// coords arrondies a la 4eme decimale ~= 11m). Tri par date de la derniere
// degustation au lieu, decroissant : on surface ce qui s'est passe recemment.
export async function listDiscoverPlaces(
  viewer: UserDoc,
  query: ListDiscoverPlacesQuery,
): Promise<PaginatedDiscoveredPlaces> {
  const blockedIds = await loadBlockedIds(viewer._id);

  const match: Record<string, unknown> = {
    visibility: 'public',
    deletedAt: null,
    // Un lieu n'est affichable sur la map que s'il a des coords.
    'place.lat': { $exists: true, $ne: null },
    'place.lng': { $exists: true, $ne: null },
  };
  if (query.type) match.type = query.type;
  if (blockedIds.length > 0) match.userId = { $nin: blockedIds };

  // Bounding box optionnelle : restreint le $match aux lieux dans le viewport
  // du front. Reduit massivement le set traverse par l'aggregation. Note : le
  // cas swLng > neLng (bbox qui chevauche l'antimeridien Pacifique) n'est pas
  // gere ici — front responsable d'envoyer une bbox non-anti-meridienne.
  if (query.bbox) {
    match['place.lat'] = {
      $exists: true,
      $ne: null,
      $gte: query.bbox.swLat,
      $lte: query.bbox.neLat,
    };
    match['place.lng'] = {
      $exists: true,
      $ne: null,
      $gte: query.bbox.swLng,
      $lte: query.bbox.neLng,
    };
  }

  const skip = pageSkip(query.page, query.limit);

  const result = await TastingModel.aggregate<{
    data: DiscoveredPlace[];
    totalArr: { count: number }[];
  }>(
    [
    { $match: match },
    // Projection minimale : on degage tout ce qui n'est pas utilise par le
    // pipeline pour reduire la memoire utilisee dans le group.
    {
      $project: {
        place: 1,
        rating: 1,
        type: 1,
        photoUrls: 1,
        createdAt: 1,
      },
    },
    // Sort en amont du group pour que $first/$arrayElemAt prennent la cover
    // photo du tasting le plus recent au lieu.
    { $sort: { createdAt: -1 } },
    {
      // Cle de group sous forme d'objet — Mongo supporte les _id complexes
      // nativement, plus robuste qu'une concat string ($toString/$round qui
      // peuvent ne pas etre disponibles selon la version Mongo). On groupe par
      // coords arrondies a la 4e decimale (~11m) : en pratique le placeId
      // suit toujours les coords, donc on ne perd pas de fusion utile.
      $group: {
        _id: {
          lat: { $round: ['$place.lat', 4] },
          lng: { $round: ['$place.lng', 4] },
        },
        placeId: { $first: '$place.placeId' },
        name: { $first: '$place.name' },
        lat: { $first: '$place.lat' },
        lng: { $first: '$place.lng' },
        tastingsCount: { $sum: 1 },
        averageRating: { $avg: '$rating' },
        lastTastingAt: { $max: '$createdAt' },
        // 1ere photo du tasting le + recent (ou null si pas de photo).
        coverPhotoUrl: { $first: { $arrayElemAt: ['$photoUrls', 0] } },
        sampleTypes: { $addToSet: '$type' },
      },
    },
    {
      $project: {
        _id: 0,
        placeId: { $ifNull: ['$placeId', null] },
        name: 1,
        lat: 1,
        lng: 1,
        tastingsCount: 1,
        averageRating: { $round: ['$averageRating', 1] },
        lastTastingAt: 1,
        coverPhotoUrl: { $ifNull: ['$coverPhotoUrl', null] },
        sampleTypes: 1,
      },
    },
    { $sort: { lastTastingAt: -1 } },
    {
      // $facet : on recupere data paginee + total en un seul aller-retour.
      // Si la collection grossit beaucoup, envisager de splitter en 2 requetes
      // paralleles avec index sur (visibility, deletedAt, place.lat, place.lng).
      $facet: {
        data: [{ $skip: skip }, { $limit: query.limit }],
        totalArr: [{ $count: 'count' }],
      },
    },
    ],
    { allowDiskUse: true },
  );

  const facet = result[0];
  const data = facet?.data ?? [];
  const total = facet?.totalArr[0]?.count ?? 0;

  return {
    data,
    page: query.page,
    limit: query.limit,
    total,
    hasMore: hasMorePages(query.page, query.limit, total),
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
  // Bonus XP : photos additionnelles (2eme et +). La 1ere photo est deja
  // valorisee dans le base XP de la creation, on n'en redonne pas ici.
  if (tasting.photoUrls.length >= 2) {
    await grantXp(user._id, XP_PER_PHOTO_ADDITIONAL);
  }
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
