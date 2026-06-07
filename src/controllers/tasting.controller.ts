import type { Request, Response } from 'express';
import type { Types } from 'mongoose';
import { AppError } from '../utils/AppError.js';
import { getUserByUsername } from '../services/user.service.js';
import {
  getLikedTastingIds,
  likeTasting,
  listTastingLikers,
  unlikeTasting,
} from '../services/like.service.js';
import {
  addTastingPhoto,
  createTasting,
  deleteTasting,
  getTastingForViewer,
  listDiscoverPlaces,
  listDiscoverTastings,
  listFeedTastings,
  listMyTastings,
  listPublicTastingsForUser,
  removeAllTastingPhotos,
  removeTastingPhotoAt,
  reorderTastingPhotos,
  updateTasting,
} from '../services/tasting.service.js';
import type { TastingDoc } from '../models/Tasting.js';
import type {
  CreateTastingInput,
  ListDiscoverPlacesQuery,
  ListTastingsQuery,
  ReorderPhotosInput,
  UpdateTastingInput,
} from '../zod/tasting.zod.js';

// Transforme un tasting (avec userId populated via AUTHOR_PROJECTION) en payload de reponse.
// Si userId n'est pas populated (cas marginal), on le laisse tel quel sans author.
// `isLikedByMe` est ajoute au payload pour piloter l'UI du heart cote front.
function serialize(t: { toJSON: () => unknown }, isLikedByMe = false): unknown {
  const json = t.toJSON() as Record<string, unknown>;
  const raw = json.userId;
  if (raw && typeof raw === 'object' && 'username' in raw) {
    const u = raw as { _id?: unknown; id?: string; username: string; displayName?: string; avatarUrl?: string };
    json.author = {
      id: u.id ?? (u._id !== undefined ? String(u._id) : undefined),
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
    };
    delete json.userId;
  }
  json.isLikedByMe = isLikedByMe;
  return json;
}

// Helper pour serialiser une liste de tastings en annotant les likes du viewer.
// Un seul query LikeModel pour toute la liste (vs 1 par item).
async function serializeListWithLikes(
  viewerId: Types.ObjectId | undefined,
  items: TastingDoc[],
): Promise<unknown[]> {
  const liked = viewerId
    ? await getLikedTastingIds(viewerId, items.map((t) => t._id))
    : new Set<string>();
  return items.map((t) => serialize(t, liked.has(String(t._id))));
}

export async function postTasting(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const tasting = await createTasting(req.user, req.body as CreateTastingInput);
  res.status(201).json({ tasting: serialize(tasting) });
}

export async function listMine(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const result = await listMyTastings(req.user, req.query as unknown as ListTastingsQuery);
  const data = await serializeListWithLikes(req.user._id, result.data);
  res.json({ ...result, data });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const tasting = await getTastingForViewer(id, req.user ?? null);
  const liked = req.user
    ? (await getLikedTastingIds(req.user._id, [tasting._id])).has(String(tasting._id))
    : false;
  res.json({ tasting: serialize(tasting, liked) });
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
  // Coherent avec getPublicProfile : 404 plutot que liste vide pour ne pas
  // leak l'existence d'un profil prive.
  if (user.prefs?.privacy?.profilePublic === false) {
    throw AppError.notFound('Utilisateur introuvable');
  }
  const result = await listPublicTastingsForUser(
    user._id,
    req.query as unknown as ListTastingsQuery,
  );
  const data = await serializeListWithLikes(req.user?._id, result.data);
  res.json({ ...result, data });
}

export async function listFeed(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const result = await listFeedTastings(req.user, req.query as unknown as ListTastingsQuery);
  const data = await serializeListWithLikes(req.user._id, result.data);
  res.json({ ...result, data });
}

export async function listDiscover(req: Request, res: Response): Promise<void> {
  const result = await listDiscoverTastings(req.user ?? null, req.query as unknown as ListTastingsQuery);
  const data = await serializeListWithLikes(req.user?._id, result.data);
  res.json({ ...result, data });
}

// GET /v1/tastings/discover/places — lieux agreges (count, avg rating, etc.)
// Requiert l'auth (cf decision projet : pas d'access anonyme aux donnees aggregees).
export async function listDiscoverPlacesHandler(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const result = await listDiscoverPlaces(req.user, req.query as unknown as ListDiscoverPlacesQuery);
  res.json(result);
}

// --- Photos de tasting (array, max 10) ---

// POST /:id/photos — append 1 photo en fin de liste
export async function postTastingPhoto(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  if (!req.file) throw AppError.badRequest('Fichier requis (field "file")');
  const { id } = req.params as { id: string };
  const tasting = await addTastingPhoto(req.user, id, req.file.buffer);
  res.status(201).json({ photoUrls: tasting.photoUrls });
}

// DELETE /:id/photos/:index — retire la photo a l'index donne
export async function deleteTastingPhoto(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { id, index } = req.params as { id: string; index: string };
  const i = parseInt(index, 10);
  if (!Number.isFinite(i)) throw AppError.badRequest('Index invalide');
  const tasting = await removeTastingPhotoAt(req.user, id, i);
  res.json({ photoUrls: tasting.photoUrls });
}

// DELETE /:id/photos — retire toutes les photos
export async function deleteAllTastingPhotos(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { id } = req.params as { id: string };
  await removeAllTastingPhotos(req.user, id);
  res.status(204).end();
}

// PATCH /:id/photos — reordonne les photos (permutation des indices)
export async function patchTastingPhotosOrder(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { id } = req.params as { id: string };
  const { order } = req.body as ReorderPhotosInput;
  const tasting = await reorderTastingPhotos(req.user, id, order);
  res.json({ photoUrls: tasting.photoUrls });
}

// --- Likes ---

// POST /:id/like — idempotent
export async function postTastingLike(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { id } = req.params as { id: string };
  const result = await likeTasting(req.user, id);
  res.json(result);
}

// DELETE /:id/like — idempotent
export async function deleteTastingLike(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { id } = req.params as { id: string };
  const result = await unlikeTasting(req.user, id);
  res.json(result);
}

// GET /:id/likes — liste paginee des users qui ont like
export async function listLikers(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const page = parseInt(String(req.query.page ?? '1'), 10) || 1;
  const limit = Math.min(parseInt(String(req.query.limit ?? '30'), 10) || 30, 100);
  const result = await listTastingLikers(id, req.user ?? null, page, limit);
  res.json(result);
}
