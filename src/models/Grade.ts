import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

// Grade : tranche de niveaux avec metadata visuelles. Source de verite des
// paliers de progression Buvard (Premiere gorgee, Bacchus, etc.).
// - key : identifiant stable, persiste aussi sur User.gamification.grade
// - icon : nom d'une icone Lucide ("Wine", "Trophy", ...) — le front map
// - color : couleur d'accent (hex) reutilisable badges / cards
// - order : ordre d'affichage croissant (1 = premier grade)
const gradeSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true, unique: true },
    minLevel: { type: Number, required: true, min: 1 },
    maxLevel: { type: Number, required: true, min: 1 },
    icon: { type: String, required: true, trim: true },
    color: { type: String, required: true, trim: true, match: /^#[0-9a-fA-F]{6}$/ },
    order: { type: Number, required: true, min: 0, index: true },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.createdAt;
        delete ret.updatedAt;
        return ret;
      },
    },
  },
);

export type Grade = InferSchemaType<typeof gradeSchema>;
export type GradeDoc = HydratedDocument<Grade>;
export const GradeModel = model<Grade>('Grade', gradeSchema);
