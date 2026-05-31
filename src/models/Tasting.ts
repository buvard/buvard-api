import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from 'mongoose';

export const TASTING_TYPES = [
  'whisky',
  'wine',
  'rum',
  'beer',
  'gin',
  'vodka',
  'tequila',
  'cognac',
  'champagne',
  'mezcal',
  'other',
] as const;
export type TastingType = (typeof TASTING_TYPES)[number];

export const VISIBILITIES = ['public', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

const tastingSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: TASTING_TYPES, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    producer: { type: String, trim: true, maxlength: 120 },
    year: { type: Number, min: 1700 },
    price: { type: Number, min: 0, max: 1_000_000 },
    currency: { type: String, trim: true, uppercase: true, minlength: 3, maxlength: 3, default: 'EUR' },
    rating: { type: Number, required: true, min: 0.5, max: 5 },
    aromas: { type: [String], default: [] },
    notes: { type: String, trim: true, maxlength: 2000 },
    // Lieu de degustation. Saisi via autocomplete Google Places cote front.
    // - name est obligatoire si l'objet existe (sinon le tasting n'a pas de place du tout)
    // - lat/lng/placeId sont optionnels mais en general renseignes par l'autocomplete.
    //   placeId permet de relier plusieurs tastings au meme etablissement.
    place: {
      type: {
        name: { type: String, required: true, trim: true, maxlength: 200 },
        lat: { type: Number, min: -90, max: 90 },
        lng: { type: Number, min: -180, max: 180 },
        placeId: { type: String, trim: true, maxlength: 200 },
      },
      _id: false,
      default: undefined,
    },
    // Photos d'une degustation — jusqu'a MAX_PHOTOS images (cf service).
    // L'ordre du tableau = ordre d'affichage (carousel). La 1ere photo sert
    // de cover dans les listings denses si besoin.
    photoUrls: { type: [String], default: [] },
    visibility: { type: String, enum: VISIBILITIES, default: 'public', index: true },
    // Compteur denormalize des likes — incrementer/decrementer atomiquement
    // dans le service like. Eviter countDocuments() qui est couteux.
    likesCount: { type: Number, default: 0, min: 0 },
    deletedAt: { type: Date, default: null },
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

tastingSchema.index({ userId: 1, createdAt: -1 });
tastingSchema.index({ visibility: 1, createdAt: -1 });

export type Tasting = InferSchemaType<typeof tastingSchema> & { userId: Types.ObjectId };
export type TastingDoc = HydratedDocument<Tasting>;
export const TastingModel = model<Tasting>('Tasting', tastingSchema);
