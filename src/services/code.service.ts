import type { Types } from 'mongoose';
import { AppError } from '../utils/AppError.js';
import {
  RedemptionCodeModel,
  type RedemptionCodeDoc,
  type RedemptionType,
} from '../models/RedemptionCode.js';
import { type UserDoc } from '../models/User.js';

// Redeem un code : valide existence + expiration + usesRemaining + non-deja-redeem
// par ce user. En cas de succes, active le flag User.features[type] et
// increment le compteur du code.
export async function redeemCode(user: UserDoc, codeKey: string): Promise<{
  type: RedemptionType;
  code: string;
}> {
  const normalized = codeKey.trim().toUpperCase();
  if (!normalized) throw AppError.badRequest('Code vide');

  const code = await RedemptionCodeModel.findOne({ code: normalized });
  if (!code) throw AppError.notFound('Code invalide');

  // Expire ?
  if (code.expiresAt && code.expiresAt.getTime() < Date.now()) {
    throw AppError.forbidden('Code expire');
  }

  // Quota atteint ? Mongoose tape le champ avec un undefined possible bien
  // que le default soit null. On normalise.
  const maxUses = code.maxUses ?? null;
  if (maxUses !== null && code.usedCount >= maxUses) {
    throw AppError.forbidden('Code epuise');
  }

  // Deja utilise par ce user ?
  if (code.usedBy.some((id) => id.equals(user._id))) {
    throw AppError.conflict('Code deja utilise');
  }

  // Feature deja active ? Le code est consume mais ne fait rien d'utile.
  // On accepte quand meme (peut-etre des codes a usage multi-types plus tard),
  // mais on signale le user.
  const alreadyActive = user.features?.[code.type] ?? false;

  // Activation du flag user
  if (!user.features) {
    user.features = { pochtron: false };
  }
  user.features[code.type] = true;
  await user.save();

  // Increment du compteur code (apres save user OK)
  code.usedCount += 1;
  code.usedBy.push(user._id);
  await code.save();

  return {
    type: code.type,
    code: code.code,
    // Hint pour le front : si feature deja active, le user le sait
    ...(alreadyActive ? { alreadyActive: true } : {}),
  } as { type: RedemptionType; code: string };
}

// Cree un code admin. Si `code` non fourni, genere un code random.
// (genere un slug type "POCHTRON-2026-AB12CD")
export async function createCode(input: {
  code?: string;
  type: RedemptionType;
  maxUses: number | null;
  expiresAt: Date | null;
  createdBy: Types.ObjectId;
}): Promise<RedemptionCodeDoc> {
  const codeKey = (input.code?.trim().toUpperCase()) ?? generateRandomCode(input.type);

  // Check unicite
  const exists = await RedemptionCodeModel.findOne({ code: codeKey });
  if (exists) throw AppError.conflict('Code deja existant');

  return RedemptionCodeModel.create({
    code: codeKey,
    type: input.type,
    maxUses: input.maxUses,
    expiresAt: input.expiresAt,
    createdBy: input.createdBy,
  });
}

export async function listCodes(): Promise<RedemptionCodeDoc[]> {
  return RedemptionCodeModel.find().sort({ createdAt: -1 }).limit(200);
}

export async function deleteCode(id: string): Promise<void> {
  const result = await RedemptionCodeModel.deleteOne({ _id: id });
  if (result.deletedCount === 0) throw AppError.notFound('Code introuvable');
}

// Genere un slug type POCHTRON-2026-AB12CD (uppercase, 6 chars hex).
function generateRandomCode(type: RedemptionType): string {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  const year = new Date().getFullYear();
  return `${type.toUpperCase()}-${year}-${random}`;
}

// Type-export pour le controller.
export type { RedemptionType } from '../models/RedemptionCode.js';
