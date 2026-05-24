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
    photoUrl: { type: String, trim: true },
    visibility: { type: String, enum: VISIBILITIES, default: 'private', index: true },
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
