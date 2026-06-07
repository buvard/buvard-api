import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from 'mongoose';

// Like d'un user sur un tasting. Idempotent via index unique (userId, tastingId)
// — un user ne peut liker le meme tasting qu'une fois.
const likeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tastingId: { type: Schema.Types.ObjectId, ref: 'Tasting', required: true, index: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

// Empeche les doublons + accelere "ce user a-t-il like ce tasting ?"
likeSchema.index({ userId: 1, tastingId: 1 }, { unique: true });
// Acces aux likes d'un tasting (peu utile en V1, utile si on liste les likers)
likeSchema.index({ tastingId: 1, createdAt: -1 });

export type Like = InferSchemaType<typeof likeSchema> & {
  userId: Types.ObjectId;
  tastingId: Types.ObjectId;
  createdAt: Date;
};
export type LikeDoc = HydratedDocument<Like>;
export const LikeModel = model<Like>('Like', likeSchema);
