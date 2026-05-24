import type { Request, Response } from 'express';
import { Webhook } from 'svix';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/AppError.js';
import {
  softDeleteUserByClerkId,
  upsertUserFromWebhook,
} from '../services/user.service.js';

interface ClerkUserPayload {
  id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  image_url: string | null;
  email_addresses: { email_address: string }[];
}

interface ClerkDeletedPayload {
  id: string;
  deleted: boolean;
}

type ClerkEvent =
  | { type: 'user.created'; data: ClerkUserPayload }
  | { type: 'user.updated'; data: ClerkUserPayload }
  | { type: 'user.deleted'; data: ClerkDeletedPayload };

function buildUpsertPayload(data: ClerkUserPayload) {
  const primaryEmail = data.email_addresses[0]?.email_address ?? null;
  return {
    clerkId: data.id,
    username: data.username,
    emailPrefix: primaryEmail ? primaryEmail.split('@')[0] ?? null : null,
    fullName: [data.first_name, data.last_name].filter(Boolean).join(' ') || null,
    imageUrl: data.image_url ?? null,
  };
}

export async function handleClerkWebhook(req: Request, res: Response): Promise<void> {
  const svixId = req.header('svix-id');
  const svixTimestamp = req.header('svix-timestamp');
  const svixSignature = req.header('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    throw AppError.badRequest('Headers svix manquants');
  }

  const wh = new Webhook(env.CLERK_WEBHOOK_SECRET);
  let event: ClerkEvent;
  try {
    event = wh.verify(req.body as Buffer, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkEvent;
  } catch (err) {
    logger.warn({ err }, 'signature webhook clerk invalide');
    throw AppError.unauthorized('Signature invalide');
  }

  switch (event.type) {
    case 'user.created':
    case 'user.updated': {
      const payload = buildUpsertPayload(event.data);
      await upsertUserFromWebhook(payload);
      logger.info({ clerkId: payload.clerkId, type: event.type }, 'user sync');
      break;
    }
    case 'user.deleted': {
      await softDeleteUserByClerkId(event.data.id);
      logger.info({ clerkId: event.data.id }, 'user soft-delete');
      break;
    }
    default:
      logger.debug({ type: (event as { type: string }).type }, 'event clerk ignore');
  }

  res.status(200).json({ received: true });
}
