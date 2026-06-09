import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from 'mongoose';

// Types de notifications in-app. Extensible (comment, etc.) quand les modules
// correspondants existeront.
export const NOTIFICATION_TYPES = ['follow', 'like', 'mention'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const notificationSchema = new Schema(
  {
    // Destinataire de la notification.
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    // Auteur de l'action (celui qui a like / suivi / mentionne).
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Contexte optionnel : le tasting concerne (like, mention dans des notes).
    tastingId: { type: Schema.Types.ObjectId, ref: 'Tasting', default: null },
    // null = non lue ; date = lue.
    readAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
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

// Liste des notifs d'un user, plus recentes d'abord.
notificationSchema.index({ userId: 1, createdAt: -1 });
// Compteur de non-lues (filtre readAt: null).
notificationSchema.index({ userId: 1, readAt: 1 });

export type Notification = InferSchemaType<typeof notificationSchema> & {
  userId: Types.ObjectId;
  actorId: Types.ObjectId;
  tastingId: Types.ObjectId | null;
  createdAt: Date;
};
export type NotificationDoc = HydratedDocument<Notification>;
export const NotificationModel = model<Notification>('Notification', notificationSchema);
