import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

// Stockage temporaire d'un `state` aleatoire genere lors de l'init OAuth.
// Sert de CSRF token : on le passe a Google qui nous le renvoie au callback ;
// on le retrouve et le consomme pour valider l'origine du callback.
// TTL Mongo : 10 minutes (assez pour le consent Google le plus lent).
const oauthStateSchema = new Schema(
  {
    state: { type: String, required: true, unique: true, index: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Index TTL : Mongo supprime automatiquement les docs > 10 min apres createdAt.
oauthStateSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });

export type OAuthState = InferSchemaType<typeof oauthStateSchema> & {
  createdAt: Date;
  updatedAt: Date;
};
export type OAuthStateDoc = HydratedDocument<OAuthState>;
export const OAuthStateModel = model<OAuthState>('OAuthState', oauthStateSchema);
