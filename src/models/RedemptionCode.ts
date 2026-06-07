import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from 'mongoose';

// Codes "VIP" / "early-access" / "pochtron" que les users peuvent rentrer
// dans l'app pour debloquer des features cachees. Cree par les admins.
// - code : string unique uppercase (POCHTRON-2026-XYZ)
// - type : feature debloque (un flag de User.features est set true au redeem)
// - maxUses : null = illimite ; sinon limite a N usages
// - usedCount + usedBy : track des consommations pour audit + anti-double-use
// - expiresAt : null = pas d'expi
// Un seul type pour l'instant : 'pochtron' (= acces aux features
// experimentales / VIP / early access — tout dans le meme bonus). On garde
// la structure enum-array pour pouvoir etendre plus tard sans refactor.
export const REDEMPTION_TYPES = ['pochtron'] as const;
export type RedemptionType = (typeof REDEMPTION_TYPES)[number];

const redemptionCodeSchema = new Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, unique: true, maxlength: 64 },
    type: { type: String, enum: REDEMPTION_TYPES, required: true, index: true },
    // null = utilisation illimitee. Sinon, on plafonne au compteur.
    maxUses: { type: Number, default: null, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    usedBy: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    expiresAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
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

export type RedemptionCode = InferSchemaType<typeof redemptionCodeSchema> & {
  createdBy: Types.ObjectId;
  usedBy: Types.ObjectId[];
};
export type RedemptionCodeDoc = HydratedDocument<RedemptionCode>;
export const RedemptionCodeModel = model<RedemptionCode>('RedemptionCode', redemptionCodeSchema);
