// Age legal minimum pour acceder a une app de degustation d'alcool.
export const MIN_AGE = 18;

// Calcule l'age en annees revolues a partir d'une date de naissance, par
// rapport a `now` (defaut: maintenant). Exact au jour pres : tient compte du
// mois et du jour, contrairement a un simple `annee - birthYear`.
export function ageFromBirthDate(birthDate: Date, now: Date = new Date()): number {
  let age = now.getFullYear() - birthDate.getFullYear();
  const m = now.getMonth() - birthDate.getMonth();
  // Pas encore atteint l'anniversaire cette annee -> retire 1 an.
  if (m < 0 || (m === 0 && now.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
}

// Vrai si la personne a au moins MIN_AGE ans a la date `now`.
export function isAdult(birthDate: Date, now: Date = new Date()): boolean {
  return ageFromBirthDate(birthDate, now) >= MIN_AGE;
}

// Borne de validation pour une date de naissance plausible : ni dans le futur,
// ni avant 1900. Utilisee par le schema Zod.
export const MIN_BIRTH_DATE = new Date('1900-01-01T00:00:00.000Z');
