import type { Types } from 'mongoose';
import { AppError } from '../utils/AppError.js';
import { TastingModel, type TastingDoc } from '../models/Tasting.js';
import type { UserDoc } from '../models/User.js';
import type {
  CreateTastingInput,
  ListTastingsQuery,
  UpdateTastingInput,
} from '../zod/tasting.zod.js';

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

export async function createTasting(
  user: UserDoc,
  input: CreateTastingInput,
): Promise<TastingDoc> {
  return TastingModel.create({ ...input, userId: user._id });
}

export async function listMyTastings(
  user: UserDoc,
  query: ListTastingsQuery,
): Promise<PaginatedTastings> {
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

export async function listPublicTastingsForUser(
  userId: Types.ObjectId,
  query: ListTastingsQuery,
): Promise<PaginatedTastings> {
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

export async function getTastingForViewer(
  id: string,
  viewer: UserDoc | null,
): Promise<TastingDoc> {
  const tasting = await TastingModel.findOne({ _id: id, deletedAt: null });
  if (!tasting) throw AppError.notFound('Tasting introuvable');

  if (tasting.visibility === 'public') return tasting;
  if (viewer && isOwner(tasting, viewer)) return tasting;
  throw AppError.forbidden();
}

export async function updateTasting(
  user: UserDoc,
  id: string,
  input: UpdateTastingInput,
): Promise<TastingDoc> {
  const tasting = await TastingModel.findOne({ _id: id, deletedAt: null });
  if (!tasting) throw AppError.notFound('Tasting introuvable');
  if (!isOwner(tasting, user)) throw AppError.forbidden();

  Object.assign(tasting, input);
  await tasting.save();
  return tasting;
}

export async function deleteTasting(user: UserDoc, id: string): Promise<void> {
  const tasting = await TastingModel.findOne({ _id: id, deletedAt: null });
  if (!tasting) throw AppError.notFound('Tasting introuvable');
  if (!isOwner(tasting, user)) throw AppError.forbidden();

  tasting.deletedAt = new Date();
  await tasting.save();
}
