import type { Types } from 'mongoose';
import { MentionModel, type MentionSourceType } from '../models/Mention.js';
import { UserModel } from '../models/User.js';
import { BlockModel } from '../models/Block.js';

// Regex: @ suivi des caracteres autorises pour un username (a-z 0-9 _ . -)
// On exige une frontiere (debut ou char non-word) en amont pour eviter de matcher "email@domain"
const MENTION_REGEX = /(^|[^a-z0-9_.-])@([a-z0-9_.-]{3,32})/gi;

// Extrait les usernames mentionnes dans un texte, dedupes et lowercase
export function parseMentions(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(MENTION_REGEX)) {
    const username = match[2]?.toLowerCase();
    if (username) found.add(username);
  }
  return Array.from(found);
}

interface SyncMentionsParams {
  sourceType: MentionSourceType;
  sourceId: Types.ObjectId;
  mentionerId: Types.ObjectId;
  text: string | null | undefined;
}

// Synchronise les mentions d'un source: cree les nouvelles, supprime celles plus presentes.
// Filtre les self-mentions et les paires bloquees.
export async function syncMentions(params: SyncMentionsParams): Promise<void> {
  const { sourceType, sourceId, mentionerId, text } = params;
  const usernames = parseMentions(text);

  // Resout les usernames en userIds existants et actifs
  let resolvedUsers: Array<{ _id: Types.ObjectId }> = [];
  if (usernames.length > 0) {
    resolvedUsers = await UserModel.find({
      username: { $in: usernames },
      deletedAt: null,
      _id: { $ne: mentionerId }, // pas de self-mention
    }).select('_id');
  }

  // Filtre les paires bloquees (dans un sens ou l'autre)
  let resolvedIds = resolvedUsers.map((u) => u._id);
  if (resolvedIds.length > 0) {
    const blocks = await BlockModel.find({
      $or: [
        { blockerId: mentionerId, blockedId: { $in: resolvedIds } },
        { blockedId: mentionerId, blockerId: { $in: resolvedIds } },
      ],
    }).select('blockerId blockedId');

    const blockedIds = new Set<string>();
    for (const b of blocks) {
      blockedIds.add(b.blockerId.equals(mentionerId) ? b.blockedId.toString() : b.blockerId.toString());
    }
    if (blockedIds.size > 0) {
      resolvedIds = resolvedIds.filter((id) => !blockedIds.has(id.toString()));
    }
  }

  // Mentions actuelles en DB pour ce (sourceType, sourceId, mentionerId)
  const existing = await MentionModel.find({ sourceType, sourceId, mentionerId }).select('mentionedId');
  const existingIds = new Set(existing.map((m) => m.mentionedId.toString()));
  const newIds = new Set(resolvedIds.map((id) => id.toString()));

  // Diff: a creer / a supprimer
  const toCreate = resolvedIds.filter((id) => !existingIds.has(id.toString()));
  const toDelete = existing
    .filter((m) => !newIds.has(m.mentionedId.toString()))
    .map((m) => m.mentionedId);

  const ops: Array<Promise<unknown>> = [];
  if (toCreate.length > 0) {
    ops.push(
      MentionModel.insertMany(
        toCreate.map((mentionedId) => ({ mentionerId, mentionedId, sourceType, sourceId })),
        { ordered: false }, // ignore les eventuels duplicates race
      ).catch(() => undefined), // best-effort sur dups
    );
  }
  if (toDelete.length > 0) {
    ops.push(
      MentionModel.deleteMany({
        sourceType,
        sourceId,
        mentionerId,
        mentionedId: { $in: toDelete },
      }),
    );
  }
  if (ops.length > 0) await Promise.all(ops);
}

// Supprime toutes les mentions liees a un source (au delete du tasting/user)
export async function clearMentions(sourceType: MentionSourceType, sourceId: Types.ObjectId): Promise<void> {
  await MentionModel.deleteMany({ sourceType, sourceId });
}

export interface MentionListItem {
  id: string;
  sourceType: MentionSourceType;
  sourceId: string;
  createdAt: Date;
  mentioner: {
    id: string;
    username: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  } | null;
}

export interface PaginatedMentions {
  data: MentionListItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

// Liste paginee des mentions recues par un user
export async function listMentionsForUser(
  userId: Types.ObjectId,
  page: number,
  limit: number,
): Promise<PaginatedMentions> {
  const filter = { mentionedId: userId };
  const [mentions, total] = await Promise.all([
    MentionModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    MentionModel.countDocuments(filter),
  ]);

  const mentionerIds = mentions.map((m) => m.mentionerId);
  const mentioners = await UserModel.find({ _id: { $in: mentionerIds }, deletedAt: null }).select(
    'username displayName avatarUrl',
  );
  const byId = new Map(mentioners.map((u) => [u._id.toString(), u]));

  const data: MentionListItem[] = mentions.map((m) => {
    const u = byId.get(m.mentionerId.toString());
    return {
      id: String(m._id),
      sourceType: m.sourceType,
      sourceId: String(m.sourceId),
      createdAt: m.createdAt,
      mentioner: u
        ? {
            id: String(u._id),
            username: u.username,
            displayName: u.displayName,
            avatarUrl: u.avatarUrl,
          }
        : null,
    };
  });

  return { data, page, limit, total, hasMore: page * limit < total };
}
