import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from 'mongoose';

// sourceType est extensible: ajouter 'comment', 'dm', etc. quand ces modules existeront
export const MENTION_SOURCE_TYPES = ['tasting_notes', 'bio'] as const;
export type MentionSourceType = (typeof MENTION_SOURCE_TYPES)[number];

const mentionSchema = new Schema(
  {
    mentionerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mentionedId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sourceType: { type: String, enum: MENTION_SOURCE_TYPES, required: true },
    sourceId: { type: Schema.Types.ObjectId, required: true, index: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

// Empeche les doublons: un user ne peut mentionner le meme user qu'une seule fois dans le meme source
mentionSchema.index(
  { mentionerId: 1, mentionedId: 1, sourceType: 1, sourceId: 1 },
  { unique: true },
);
// Acces aux mentions recues d'un user, triees chronologiquement
mentionSchema.index({ mentionedId: 1, createdAt: -1 });
// Acces aux mentions par source (sync/clear lors d'un update/delete du source)
mentionSchema.index({ sourceType: 1, sourceId: 1 });

export type Mention = InferSchemaType<typeof mentionSchema> & {
  mentionerId: Types.ObjectId;
  mentionedId: Types.ObjectId;
  sourceId: Types.ObjectId;
  createdAt: Date;
};
export type MentionDoc = HydratedDocument<Mention>;
export const MentionModel = model<Mention>('Mention', mentionSchema);
