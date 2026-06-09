import mongoose, { type Types } from 'mongoose';
import { logger } from '../config/logger.js';
import { UserModel, type UserDoc } from '../models/User.js';
import { FollowModel } from '../models/Follow.js';
import { BlockModel } from '../models/Block.js';
import { TastingModel } from '../models/Tasting.js';
import { LikeModel } from '../models/Like.js';
import { MentionModel } from '../models/Mention.js';
import { ReportModel } from '../models/Report.js';
import { NotificationModel } from '../models/Notification.js';
import { deleteObject, extractKeyFromPublicUrl } from './storage.service.js';
import { GRACE_MS } from '../utils/grace.js';

// Supprime les relations Follow de l'user (dans les 2 sens) et corrige les
// compteurs denormalises des users a l'autre bout, en une passe. Renvoie le
// nombre de relations supprimees.
async function removeFollowsAndFixStats(userId: Types.ObjectId): Promise<void> {
  // Les users que `userId` suivait -> leur followersCount baisse de 1.
  const following = await FollowModel.find({ followerId: userId }).select('followingId');
  // Les users qui suivaient `userId` -> leur followingCount baisse de 1.
  const followers = await FollowModel.find({ followingId: userId }).select('followerId');

  const ops = [
    ...following.map((f) => ({
      updateOne: {
        filter: { _id: f.followingId },
        update: { $inc: { 'stats.followersCount': -1 } },
      },
    })),
    ...followers.map((f) => ({
      updateOne: {
        filter: { _id: f.followerId },
        update: { $inc: { 'stats.followingCount': -1 } },
      },
    })),
  ];
  if (ops.length > 0) {
    await UserModel.bulkWrite(ops, { ordered: false });
  }

  await FollowModel.deleteMany({ $or: [{ followerId: userId }, { followingId: userId }] });
}

// Anonymise l'email/nom cote Better Auth (collection `user`, geree hors
// Mongoose par l'adapter). Best effort : on log sans throw pour ne pas bloquer
// l'anonymisation du profil metier si la collection auth diffère.
async function anonymizeAuthRecord(authUserId: string): Promise<void> {
  try {
    const db = mongoose.connection.db;
    if (!db) return;
    await db.collection('user').updateOne(
      { id: authUserId },
      {
        $set: {
          email: `deleted+${authUserId}@buvard.invalid`,
          name: 'Utilisateur supprime',
          image: null,
          emailVerified: false,
        },
      },
    );
  } catch (err) {
    logger.warn({ err, authUserId }, 'anonymisation auth Better Auth echouee (ignoree)');
  }
}

// --- 1. Demande de suppression (soft-delete, recuperable) ---
//
// Pose deletedAt : le compte est masque partout (tous les services filtrent
// deja deletedAt: null), mais recuperable au login pendant la periode de grace.
// On NE supprime PAS encore les relations ni la PII : la recuperation doit tout
// restaurer a l'identique. Les stats sont laissees telles quelles (le compte
// etant masque, ses compteurs ne sont plus exposes).
export async function requestAccountDeletion(user: UserDoc): Promise<void> {
  if (user.deletedAt) return; // deja en cours de suppression, idempotent
  user.deletedAt = new Date();
  await user.save();
}

// --- 2. Anonymisation definitive (irreversible) ---
//
// Efface toute la PII du profil, purge l'email cote auth, supprime les
// relations sociales (et corrige les stats des autres), et nettoie les
// mentions. Les tastings sont CONSERVES (contenu communautaire) mais leur
// auteur devient anonyme (username "deleted_*", avatar retire) — aucune PII
// ne subsiste cote profil.
export async function anonymizeAccount(user: UserDoc): Promise<void> {
  if (user.anonymizedAt) return; // deja anonymise, idempotent

  // Supprime les medias R2 (avatar / cover) avant de perdre les URLs.
  for (const url of [user.avatarUrl, user.coverUrl]) {
    const key = extractKeyFromPublicUrl(url);
    if (key) await deleteObject(key);
  }

  // Relations sociales : suppression + correction des compteurs des tiers.
  await removeFollowsAndFixStats(user._id);
  await BlockModel.deleteMany({ $or: [{ blockerId: user._id }, { blockedId: user._id }] });

  // Toutes les mentions impliquant cet user, qu'il soit l'auteur (mentionerId)
  // ou la cible (mentionedId) — y compris celles dans les notes de tasting.
  // (clearMentions supprime par source, ce qui ne couvrirait pas tout ici.)
  await MentionModel.deleteMany({
    $or: [{ mentionerId: user._id }, { mentionedId: user._id }],
  });

  // Notifications recues ou emises par cet user.
  await NotificationModel.deleteMany({
    $or: [{ userId: user._id }, { actorId: user._id }],
  });

  // Email / nom cote Better Auth.
  await anonymizeAuthRecord(user.authUserId);

  // Efface la PII du profil metier. username remplace par un slug stable et
  // unique base sur l'id (respecte le format username : a-z0-9_.-).
  const shortId = String(user._id).slice(-8);
  user.username = `deleted_${shortId}`;
  user.displayName = null;
  user.bio = null;
  user.avatarUrl = null;
  user.coverUrl = null;
  user.location = undefined;
  user.birthDate = null;
  user.birthYear = undefined;
  user.favoriteCategories = [];
  user.anonymizedAt = new Date();
  if (!user.deletedAt) user.deletedAt = user.anonymizedAt;
  await user.save();
}

// --- 3. Purge des comptes dont la periode de grace est ecoulee ---
//
// Appele par le scheduler. Anonymise tous les comptes soft-deletes depuis plus
// de GRACE jours et pas encore anonymises. Traite un par un (volumes faibles)
// pour isoler les erreurs. Renvoie le nombre de comptes anonymises.
export async function purgeExpiredAccounts(now: Date = new Date()): Promise<number> {
  const threshold = new Date(now.getTime() - GRACE_MS);
  const candidates = await UserModel.find({
    deletedAt: { $ne: null, $lte: threshold },
    anonymizedAt: null,
  });

  let count = 0;
  for (const user of candidates) {
    try {
      await anonymizeAccount(user);
      count += 1;
    } catch (err) {
      logger.error({ err, userId: String(user._id) }, 'anonymisation compte echouee');
    }
  }
  if (count > 0) logger.info({ count }, 'comptes anonymises (purge periodique)');
  return count;
}

// --- 4. Export des donnees personnelles (RGPD art. 15 / 20) ---
//
// Agrege l'integralite des donnees liees au user dans un objet JSON unique,
// pour le droit d'acces (art. 15) et la portabilite (art. 20). Inclut l'email
// cote Better Auth (PII centrale, hors userProfiles).

// Recupere les champs PII de l'enregistrement Better Auth (collection `user`).
// Best effort : si la collection differe, on renvoie ce qu'on a sans throw.
async function fetchAuthRecord(authUserId: string): Promise<Record<string, unknown> | null> {
  try {
    const db = mongoose.connection.db;
    if (!db) return null;
    const doc = await db
      .collection('user')
      .findOne(
        { id: authUserId },
        { projection: { email: 1, name: 1, emailVerified: 1, createdAt: 1, _id: 0 } },
      );
    return doc ?? null;
  } catch (err) {
    logger.warn({ err, authUserId }, 'export : lecture auth Better Auth echouee (ignoree)');
    return null;
  }
}

export async function exportAccountData(user: UserDoc): Promise<Record<string, unknown>> {
  const userId = user._id;

  const [auth, tastings, likes, following, followers, blocks, mentionsMade, mentionsReceived, reportsMade, notifications] =
    await Promise.all([
      fetchAuthRecord(user.authUserId),
      TastingModel.find({ userId }).sort({ createdAt: -1 }),
      LikeModel.find({ userId }).sort({ createdAt: -1 }),
      FollowModel.find({ followerId: userId }).select('followingId createdAt').sort({ createdAt: -1 }),
      FollowModel.find({ followingId: userId }).select('followerId createdAt').sort({ createdAt: -1 }),
      BlockModel.find({ blockerId: userId }).select('blockedId createdAt').sort({ createdAt: -1 }),
      MentionModel.find({ mentionerId: userId }).sort({ createdAt: -1 }),
      MentionModel.find({ mentionedId: userId }).sort({ createdAt: -1 }),
      ReportModel.find({ reporterId: userId }).sort({ createdAt: -1 }),
      NotificationModel.find({ userId }).sort({ createdAt: -1 }),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    format: 'buvard-account-export-v1',
    account: {
      // Profil metier complet (username, prefs, stats, gamification, dates...).
      profile: user.toJSON(),
      // PII d'authentification (email, nom) cote Better Auth.
      auth,
    },
    tastings: tastings.map((t) => t.toJSON()),
    likesGiven: likes.map((l) => ({ tastingId: String(l.tastingId), createdAt: l.createdAt })),
    following: following.map((f) => ({ userId: String(f.followingId), since: f.createdAt })),
    followers: followers.map((f) => ({ userId: String(f.followerId), since: f.createdAt })),
    blocks: blocks.map((b) => ({ userId: String(b.blockedId), since: b.createdAt })),
    mentions: {
      made: mentionsMade.map((m) => ({
        mentionedUserId: String(m.mentionedId),
        sourceType: m.sourceType,
        sourceId: String(m.sourceId),
        createdAt: m.createdAt,
      })),
      received: mentionsReceived.map((m) => ({
        byUserId: String(m.mentionerId),
        sourceType: m.sourceType,
        sourceId: String(m.sourceId),
        createdAt: m.createdAt,
      })),
    },
    reportsMade: reportsMade.map((r) => r.toJSON()),
    notifications: notifications.map((n) => ({
      type: n.type,
      actorId: String(n.actorId),
      tastingId: n.tastingId ? String(n.tastingId) : null,
      readAt: n.readAt,
      createdAt: n.createdAt,
    })),
  };
}
