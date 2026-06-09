import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError.js';
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notification.service.js';
import type { ListNotificationsQuery } from '../zod/notification.zod.js';

// GET /me/notifications?page=&limit=
export async function getMyNotifications(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { page, limit } = req.query as unknown as ListNotificationsQuery;
  const result = await listNotifications(req.user._id, page, limit);
  res.json(result);
}

// GET /me/notifications/unread-count
export async function getMyUnreadCount(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const unreadCount = await getUnreadCount(req.user._id);
  res.json({ unreadCount });
}

// POST /me/notifications/read — marque toutes les notifs comme lues
export async function postMarkAllRead(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const marked = await markAllNotificationsRead(req.user._id);
  res.json({ marked });
}

// POST /me/notifications/:id/read — marque une notif comme lue
export async function postMarkOneRead(req: Request, res: Response): Promise<void> {
  if (!req.user) throw AppError.unauthorized();
  const { id } = req.params as { id: string };
  await markNotificationRead(req.user._id, id);
  res.status(204).end();
}
