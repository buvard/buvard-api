import { GradeModel, type Grade } from '../models/Grade.js';
export type { Grade } from '../models/Grade.js';
import { logger } from '../config/logger.js';

// Definitions de seed des grades : utilisees au boot pour upserter les paliers
// dans la BDD si absents (idempotent). Les icones referencent Lucide
// (https://lucide.dev/icons/), le front fait le map nom -> composant.
interface GradeSeed {
  key: string;
  minLevel: number;
  maxLevel: number;
  icon: string;
  color: string;
  order: number;
}

const GRADE_SEEDS: GradeSeed[] = [
  { key: 'curious',     minLevel: 1,   maxLevel: 5,   icon: 'Sparkles', color: '#9CA3AF', order: 1 },
  { key: 'explorer',    minLevel: 6,   maxLevel: 15,  icon: 'Compass',  color: '#60A5FA', order: 2 },
  { key: 'amateur',     minLevel: 16,  maxLevel: 30,  icon: 'Wine',     color: '#34D399', order: 3 },
  { key: 'connoisseur', minLevel: 31,  maxLevel: 50,  icon: 'Star',     color: '#FBBF24', order: 4 },
  { key: 'sommelier',   minLevel: 51,  maxLevel: 75,  icon: 'Award',    color: '#F97316', order: 5 },
  { key: 'master',      minLevel: 76,  maxLevel: 99,  icon: 'Crown',    color: '#A855F7', order: 6 },
  { key: 'legend',      minLevel: 100, maxLevel: 100, icon: 'Trophy',   color: '#8B2635', order: 7 },
];

// Cache en memoire : evite un fetch BDD a chaque grantXp / awardTastingXp.
// Rechargeable via loadGradesCache() si necessaire (ex: admin a modifie un
// grade en live — pour l'instant pas d'API admin, mais structure prete).
let gradesCache: Grade[] = [];

export async function seedGrades(): Promise<void> {
  for (const seed of GRADE_SEEDS) {
    await GradeModel.updateOne(
      { key: seed.key },
      { $setOnInsert: seed },
      { upsert: true },
    );
  }
  logger.info({ count: GRADE_SEEDS.length }, 'grades seeded');
}

export async function loadGradesCache(): Promise<void> {
  const grades = await GradeModel.find().sort({ order: 1 }).lean();
  gradesCache = grades;
  logger.info({ count: gradesCache.length }, 'grades cache loaded');
}

export function listGrades(): Grade[] {
  return gradesCache;
}

export function getGradeByKey(key: string): Grade | undefined {
  return gradesCache.find((g) => g.key === key);
}

// Retourne le grade correspondant a un niveau donne. Lecture O(n) sur 7
// entrees : negligeable. Fallback sur le dernier grade si level > MAX.
export function getGradeForLevel(level: number): Grade {
  for (const g of gradesCache) {
    if (level >= g.minLevel && level <= g.maxLevel) return g;
  }
  return gradesCache[gradesCache.length - 1];
}
