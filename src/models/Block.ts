import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from 'mongoose';

const blockSchema = new Schema(
  {
    blockerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    blockedId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

// Une paire ne peut exister qu'une fois
blockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
// Liste des blocks d'un user
blockSchema.index({ blockerId: 1, createdAt: -1 });

export type Block = InferSchemaType<typeof blockSchema> & {
  blockerId: Types.ObjectId;
  blockedId: Types.ObjectId;
  createdAt: Date;
};
export type BlockDoc = HydratedDocument<Block>;
export const BlockModel = model<Block>('Block', blockSchema);
