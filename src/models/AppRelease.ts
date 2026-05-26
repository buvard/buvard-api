import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const APP_PLATFORMS = ['ios', 'android'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

const appReleaseSchema = new Schema(
  {
    version: {
      type: String,
      required: true,
      match: [/^\d+\.\d+\.\d+$/, 'Format SemVer attendu: X.Y.Z'],
    },
    platform: { type: String, enum: APP_PLATFORMS, required: true, index: true },
    bundleUrl: { type: String, required: true },
    bundleKey: { type: String, required: true }, // cle R2 pour cleanup au delete
    checksum: {
      type: String,
      required: true,
      lowercase: true,
      match: [/^[a-f0-9]{64}$/, 'SHA-256 hex attendu (64 chars)'],
    },
    notes: { type: String, trim: true, maxlength: 1000 },
    active: { type: Boolean, default: false, index: true },
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

// Une seule release par (platform, version)
appReleaseSchema.index({ platform: 1, version: 1 }, { unique: true });
// Pour query rapide "derniere active par platform"
appReleaseSchema.index({ platform: 1, active: 1, createdAt: -1 });

export type AppRelease = InferSchemaType<typeof appReleaseSchema> & {
  createdAt: Date;
  updatedAt: Date;
};
export type AppReleaseDoc = HydratedDocument<AppRelease>;
export const AppReleaseModel = model<AppRelease>('AppRelease', appReleaseSchema);
