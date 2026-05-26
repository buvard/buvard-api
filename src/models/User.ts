import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { TASTING_TYPES } from './Tasting.js';

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const LANGUAGES = ['fr', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const UNITS = ['metric', 'imperial'] as const;
export type Units = (typeof UNITS)[number];

export const CURRENCIES = ['EUR', 'USD', 'GBP'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const USER_ROLES = ['user', 'moderator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['active', 'suspended', 'banned'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

// Sous-schema pour stats par categorie — tous les types de tasting trackes
const tastingsByCategoryFields = TASTING_TYPES.reduce<Record<string, { type: NumberConstructor; default: number }>>(
  (acc, type) => {
    acc[type] = { type: Number, default: 0 };
    return acc;
  },
  {},
);

const userSchema = new Schema(
  {
    clerkId: { type: String, required: true, unique: true, index: true },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 32,
      match: /^[a-z0-9_.-]+$/,
    },
    displayName: { type: String, trim: true, maxlength: 60 },
    avatarUrl: { type: String, trim: true },
    bio: { type: String, trim: true, maxlength: 280 },
    coverUrl: { type: String, trim: true },
    location: {
      country: { type: String, trim: true, uppercase: true, minlength: 2, maxlength: 2 },
      city: { type: String, trim: true, maxlength: 80 },
    },
    birthYear: { type: Number, min: 1900 },
    favoriteCategories: { type: [String], enum: TASTING_TYPES, default: [] },

    // Role & statut compte
    role: { type: String, enum: USER_ROLES, default: 'user', index: true },
    status: { type: String, enum: USER_STATUSES, default: 'active', index: true },
    suspendedUntil: { type: Date, default: null },
    verified: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },

    // Activite
    lastSeenAt: { type: Date, default: Date.now },
    onboardingCompletedAt: { type: Date, default: null },

    // Gamification
    gamification: {
      xp: { type: Number, default: 0, index: true },
      level: { type: Number, default: 1 },
      streak: {
        current: { type: Number, default: 0 },
        longest: { type: Number, default: 0 },
        lastActiveAt: { type: Date, default: null },
      },
    },

    // Stats denormalisees — evite countDocuments couteux
    stats: {
      tastingsCount: { type: Number, default: 0 },
      tastingsByCategory: tastingsByCategoryFields,
      followersCount: { type: Number, default: 0 },
      followingCount: { type: Number, default: 0 },
    },

    prefs: {
      theme: { type: String, enum: THEMES, default: 'system' },
      language: { type: String, enum: LANGUAGES, default: 'fr' },
      units: { type: String, enum: UNITS, default: 'metric' },
      currency: { type: String, enum: CURRENCIES, default: 'EUR' },
      notifications: {
        push: { type: Boolean, default: true },
        email: { type: Boolean, default: false },
        friendActivity: { type: Boolean, default: true },
        newFollower: { type: Boolean, default: true },
        tastingLiked: { type: Boolean, default: true },
        tastingCommented: { type: Boolean, default: true },
      },
      privacy: {
        profilePublic: { type: Boolean, default: true },
        showRatings: { type: Boolean, default: true },
        searchable: { type: Boolean, default: true },
        showLocation: { type: Boolean, default: true },
      },
    },

    // Legal & safety
    acceptedTermsAt: { type: Date, default: null },
    acceptedPrivacyAt: { type: Date, default: null },
    reportsReceivedCount: { type: Number, default: 0 },

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

// `timestamps` n'est pas inclus dans InferSchemaType, on l'ajoute explicitement
export type User = InferSchemaType<typeof userSchema> & {
  createdAt: Date;
  updatedAt: Date;
};
export type UserDoc = HydratedDocument<User>;
export const UserModel = model<User>('User', userSchema);
