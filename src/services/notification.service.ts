import type { Types } from 'mongoose';
import { NotificationModel, type NotificationDoc, type NotificationType } from '../models/Notification.js';
import { UserModel } from '../models/User.js';
import { hasMorePages, pageSkip } from '../utils/pagination.js';
import { logger } from '../config/logger.js';

interface CreateNotificationParams {
  userId: Types.ObjectId; // destinataire
  actorId: Types.ObjectId; // auteur de l'action
  type: NotificationType;
  tastingId?: Types.ObjectId;
}

// Mappe un type de notif vers le flag de pref correspondant. Si le flag est
// false, on ne cree pas la notif. (push/email sont pour le canal natif/mail,
// gere plus tard — ici on respecte les prefs par type d'evenement.)
const PREF_BY_TYPE: Record<NotificationType, 'newFollower' | 'tastingLiked' | null> = {
  follow: 'newFollower',
  like: 'tastingLiked',
  mention: null, // pas de flag dedie pour les mentions -> toujours notifiees
};

// Cree une notification in-app. Best-effort : conçue pour etre appelee SANS
// await bloquant depuis les services metier (like/follow/mention) — une erreur
// ici ne doit jamais faire echouer l'action. Garde anti self-notification +
// respect des prefs du destinataire.
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  try {
    const { userId, actorId, type, tastingId } = params;
    if (userId.equals(actorId)) return; // pas de notif pour soi-meme

    const prefKey = PREF_BY_TYPE[type];
    if (prefKey) {
      const recipient = await UserModel.findById(userId).select(`prefs.notifications.${prefKey}`);
      // Pref absente -> on notifie (defaut produit = true).
      if (recipient?.prefs?.notifications?.[prefKey] === false) return;
    }

    await NotificationModel.create({ userId, actorId, type, tastingId: tastingId ?? null });
  } catch (err) {
    logger.warn({ err, type: params.type }, 'creation notification echouee (ignoree)');
  }
}

export interface PaginatedNotifications {
  data: unknown[];
  page: number;
  limit: number;
  total: number;
  unreadCount: number;
  hasMore: boolean;
}

// Liste paginee des notifications du user, plus recentes d'abord. Peuple
// l'acteur (infos minimales) pour eviter un N+1 cote front. Filtre les acteurs
// supprimes (notif devenue sans objet).
export async function listNotifications(
  userId: Types.ObjectId,
  page: number,
  limit: number,
): Promise<PaginatedNotifications> {
  const filter = { userId };
  const [notifs, total, unreadCount] = await Promise.all([
    NotificationModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(pageSkip(page, limit))
      .limit(limit)
      .populate('actorId', 'username displayName avatarUrl deletedAt'),
    NotificationModel.countDocuments(filter),
    NotificationModel.countDocuments({ userId, readAt: null }),
  ]);

  const data = [];
  for (const n of notifs) {
    const json = n.toJSON() as Record<string, unknown>;
    const actor = json.actorId as
      | { _id?: Types.ObjectId; id?: string; username?: string; displayName?: string | null; avatarUrl?: string | null; deletedAt?: Date | null }
      | null;
    // Acteur supprime -> on masque la notif (devenue sans objet).
    if (!actor || !actor.username || actor.deletedAt) continue;
    json.actor = {
      id: actor.id ?? actor._id?.toString(),
      username: actor.username,
      displayName: actor.displayName ?? null,
      avatarUrl: actor.avatarUrl ?? null,
    };
    delete json.actorId;
    data.push(json);
  }

  return { data, page, limit, total, unreadCount, hasMore: hasMorePages(page, limit, total) };
}

export async function getUnreadCount(userId: Types.ObjectId): Promise<number> {
  return NotificationModel.countDocuments({ userId, readAt: null });
}

// Marque une notification comme lue. Scopee au user (on ne peut marquer que les
// siennes). Idempotent.
export async function markNotificationRead(userId: Types.ObjectId, notificationId: string): Promise<void> {
  await NotificationModel.updateOne(
    { _id: notificationId, userId, readAt: null },
    { $set: { readAt: new Date() } },
  );
}

// Marque toutes les notifications non lues du user comme lues. Renvoie le
// nombre marque.
export async function markAllNotificationsRead(userId: Types.ObjectId): Promise<number> {
  const res = await NotificationModel.updateMany(
    { userId, readAt: null },
    { $set: { readAt: new Date() } },
  );
  return res.modifiedCount;
}

// Re-export du type pour les services appelants.
export type { NotificationDoc };
