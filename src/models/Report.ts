import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from 'mongoose';

// Cible d'un signalement : un tasting (contenu UGC) ou un user (profil/comportement).
export const REPORT_TARGET_TYPES = ['tasting', 'user'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

// Motifs de signalement — exposes au client pour le menu de report.
export const REPORT_REASONS = [
  'spam',
  'harassment',
  'inappropriate',
  'underage',
  'impersonation',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

// Cycle de vie cote moderation.
export const REPORT_STATUSES = ['pending', 'reviewed', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

const reportSchema = new Schema(
  {
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    targetType: { type: String, enum: REPORT_TARGET_TYPES, required: true },
    // Id polymorphe : ref vers Tasting ou User selon targetType. Pas de `ref`
    // fixe car la cible depend du type — la resolution se fait cote service.
    targetId: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    note: { type: String, trim: true, maxlength: 500 },

    status: { type: String, enum: REPORT_STATUSES, default: 'pending', index: true },
    // Trace de moderation : qui a traite et quand.
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    // Note interne du moderateur (non exposee au reporter).
    resolutionNote: { type: String, trim: true, maxlength: 500, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        delete ret._id;
        return ret;
      },
    },
  },
);

// Un user ne peut signaler une meme cible qu'une fois (anti-spam de reports).
reportSchema.index({ reporterId: 1, targetType: 1, targetId: 1 }, { unique: true });
// File de moderation : les plus recents en attente d'abord.
reportSchema.index({ status: 1, createdAt: -1 });
// Tous les reports recus par une cible donnee (compteur / historique).
reportSchema.index({ targetType: 1, targetId: 1 });

export type Report = InferSchemaType<typeof reportSchema> & {
  reporterId: Types.ObjectId;
  targetId: Types.ObjectId;
  reviewedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};
export type ReportDoc = HydratedDocument<Report>;
export const ReportModel = model<Report>('Report', reportSchema);
