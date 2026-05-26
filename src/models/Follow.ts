import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from 'mongoose';

const followSchema = new Schema(
  {
    followerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    followingId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

// Empeche les doublons et accelere le check "est-ce que A suit B ?"
followSchema.index({ followerId: 1, followingId: 1 }, { unique: true });
// Acces aux followers d'un user tries du plus recent au plus ancien
followSchema.index({ followingId: 1, createdAt: -1 });
// Acces au feed "qui je suis" trie chronologiquement
followSchema.index({ followerId: 1, createdAt: -1 });

export type Follow = InferSchemaType<typeof followSchema> & {
  followerId: Types.ObjectId;
  followingId: Types.ObjectId;
  createdAt: Date;
};
export type FollowDoc = HydratedDocument<Follow>;
export const FollowModel = model<Follow>('Follow', followSchema);
