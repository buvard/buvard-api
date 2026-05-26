import { createHash } from 'node:crypto';
import { AppError } from '../utils/AppError.js';
import { compareVersions } from '../utils/version.js';
import { AppReleaseModel, type AppPlatform, type AppReleaseDoc } from '../models/AppRelease.js';
import { deleteObject, uploadBuffer } from './storage.service.js';
import type { CreateReleaseInput, UpdateReleaseInput } from '../zod/release.zod.js';

interface CreateReleaseParams extends CreateReleaseInput {
  file: Buffer;
}

// Calcule un SHA-256 hex sur un buffer
function computeSha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

// Erreur Mongo de cle dupliquee (index unique platform+version)
function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 11000;
}

export async function createRelease(params: CreateReleaseParams): Promise<AppReleaseDoc> {
  const { version, platform, notes, active, file } = params;

  const checksum = computeSha256(file);
  const key = `bundles/${platform}/${version}.zip`;
  const { publicUrl } = await uploadBuffer(key, file, 'application/zip');

  try {
    const release = await AppReleaseModel.create({
      version,
      platform,
      bundleUrl: publicUrl,
      bundleKey: key,
      checksum,
      notes,
      active: Boolean(active),
    });

    // Si on cree active=true, on desactive les autres releases active de cette platform
    if (release.active) {
      await AppReleaseModel.updateMany(
        { platform, active: true, _id: { $ne: release._id } },
        { $set: { active: false } },
      );
    }
    return release;
  } catch (err) {
    // Race: cle dupliquee — on cleanup le zip qu'on vient d'uploader pour pas laisser d'orphan
    if (isDuplicateKeyError(err)) {
      await deleteObject(key);
      throw AppError.conflict(`Release ${platform} ${version} existe deja`);
    }
    await deleteObject(key);
    throw err;
  }
}

export async function listReleases(platform?: AppPlatform): Promise<AppReleaseDoc[]> {
  const filter: Record<string, unknown> = {};
  if (platform) filter.platform = platform;
  return AppReleaseModel.find(filter).sort({ platform: 1, createdAt: -1 });
}

export async function updateRelease(id: string, input: UpdateReleaseInput): Promise<AppReleaseDoc> {
  const release = await AppReleaseModel.findById(id);
  if (!release) throw AppError.notFound('Release introuvable');

  if (input.notes !== undefined) release.notes = input.notes;
  if (input.active !== undefined) release.active = input.active;
  await release.save();

  // Si on active une release, on desactive les autres de la meme platform
  if (input.active === true) {
    await AppReleaseModel.updateMany(
      { platform: release.platform, active: true, _id: { $ne: release._id } },
      { $set: { active: false } },
    );
  }
  return release;
}

export async function deleteRelease(id: string): Promise<void> {
  const release = await AppReleaseModel.findById(id);
  if (!release) throw AppError.notFound('Release introuvable');

  await AppReleaseModel.deleteOne({ _id: release._id });
  await deleteObject(release.bundleKey);
}

export interface LatestUpdateResponse {
  version: string;
  url: string;
  checksum: string;
  notes?: string;
}

// Endpoint public consomme par Capgo au boot.
// Retourne null si l'app est deja a jour (le controller renvoie 204).
export async function getLatestUpdateForClient(
  platform: AppPlatform,
  currentVersion: string,
): Promise<LatestUpdateResponse | null> {
  const latest = await AppReleaseModel.findOne({ platform, active: true }).sort({ createdAt: -1 });
  if (!latest) return null;

  if (compareVersions(latest.version, currentVersion) <= 0) return null;

  return {
    version: latest.version,
    url: latest.bundleUrl,
    checksum: latest.checksum,
    notes: latest.notes ?? undefined,
  };
}
