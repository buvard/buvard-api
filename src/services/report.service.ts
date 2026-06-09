import type { Types } from 'mongoose';
import { AppError } from '../utils/AppError.js';
import { ReportModel, type ReportDoc, type ReportStatus, type ReportTargetType } from '../models/Report.js';
import { TastingModel } from '../models/Tasting.js';
import { UserModel, type UserDoc } from '../models/User.js';
import type { CreateReportInput, ListReportsQuery } from '../zod/report.zod.js';
import { isDuplicateKeyError } from '../utils/mongoErrors.js';
import { hasMorePages, pageSkip } from '../utils/pagination.js';

// Resout la cible d'un signalement et renvoie l'id de son proprietaire (pour
// l'auto-report) + l'ObjectId de la cible. Throw si la cible n'existe pas /
// est supprimee.
async function resolveTarget(
  targetType: ReportTargetType,
  targetId: string,
): Promise<{ targetObjectId: Types.ObjectId; ownerId: Types.ObjectId }> {
  if (targetType === 'tasting') {
    const tasting = await TastingModel.findOne({ _id: targetId, deletedAt: null }).select('userId');
    if (!tasting) throw AppError.notFound('Tasting introuvable');
    return { targetObjectId: tasting._id, ownerId: tasting.userId };
  }
  const user = await UserModel.findOne({ _id: targetId, deletedAt: null }).select('_id');
  if (!user) throw AppError.notFound('Utilisateur introuvable');
  return { targetObjectId: user._id, ownerId: user._id };
}

// Cree un signalement. Idempotent : un meme reporter ne peut signaler une
// meme cible qu'une fois (unique index) — on renvoie le report existant sans
// erreur plutot que 409, pour que le client n'ait pas a gerer le doublon.
export async function createReport(
  reporter: UserDoc,
  targetType: ReportTargetType,
  targetId: string,
  input: CreateReportInput,
): Promise<{ report: ReportDoc; alreadyReported: boolean }> {
  const { targetObjectId, ownerId } = await resolveTarget(targetType, targetId);

  // Pas d'auto-signalement (ni de son propre profil ni de son propre contenu).
  if (ownerId.equals(reporter._id)) {
    throw AppError.badRequest('Impossible de se signaler soi-meme');
  }

  try {
    const report = await ReportModel.create({
      reporterId: reporter._id,
      targetType,
      targetId: targetObjectId,
      reason: input.reason,
      note: input.note,
    });
    // Compteur denormalise sur le profil cible (sert au tri moderation et a
    // d'eventuels seuils d'auto-masquage). Uniquement pour les cibles user :
    // un tasting signale impacte aussi son auteur.
    await UserModel.updateOne({ _id: ownerId }, { $inc: { reportsReceivedCount: 1 } });
    return { report, alreadyReported: false };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const existing = await ReportModel.findOne({
        reporterId: reporter._id,
        targetType,
        targetId: targetObjectId,
      });
      // existing est garanti non-null (le duplicate vient de cette paire).
      return { report: existing as ReportDoc, alreadyReported: true };
    }
    throw err;
  }
}

export interface PaginatedReports {
  data: ReportDoc[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

// File de moderation paginee. Filtrable par statut. Les plus recents d'abord.
// On peuple le reporter (infos minimales) pour l'affichage admin ; la cible
// reste un id brut (resolution a la demande cote admin si besoin).
export async function listReports(query: ListReportsQuery): Promise<PaginatedReports> {
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;

  const [data, total] = await Promise.all([
    ReportModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(pageSkip(query.page, query.limit))
      .limit(query.limit)
      .populate('reporterId', 'username displayName avatarUrl'),
    ReportModel.countDocuments(filter),
  ]);

  return {
    data,
    page: query.page,
    limit: query.limit,
    total,
    hasMore: hasMorePages(query.page, query.limit, total),
  };
}

// Resout un report : change son statut + trace le moderateur et la date.
// 'reviewed' = vu sans action, 'actioned' = sanction appliquee, 'dismissed' =
// rejete. La sanction effective (ban user, masquage tasting) reste manuelle /
// a brancher sur les endpoints admin existants.
export async function resolveReport(
  reportId: string,
  moderator: UserDoc,
  status: Exclude<ReportStatus, 'pending'>,
  resolutionNote?: string,
): Promise<ReportDoc> {
  const report = await ReportModel.findById(reportId);
  if (!report) throw AppError.notFound('Signalement introuvable');

  report.status = status;
  report.reviewedBy = moderator._id;
  report.reviewedAt = new Date();
  if (resolutionNote !== undefined) report.resolutionNote = resolutionNote;
  await report.save();

  return report;
}
