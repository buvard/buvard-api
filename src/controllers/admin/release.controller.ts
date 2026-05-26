import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError.js';
import {
  createRelease,
  deleteRelease,
  listReleases,
  updateRelease,
} from '../../services/release.service.js';
import type {
  CreateReleaseInput,
  ListReleasesQuery,
  UpdateReleaseInput,
} from '../../zod/release.zod.js';

export async function postRelease(req: Request, res: Response): Promise<void> {
  if (!req.file) throw AppError.badRequest('Bundle requis (field "file")');
  const body = req.body as CreateReleaseInput;
  const release = await createRelease({ ...body, file: req.file.buffer });
  res.status(201).json({ release: release.toJSON() });
}

export async function getReleases(req: Request, res: Response): Promise<void> {
  const { platform } = req.query as unknown as ListReleasesQuery;
  const releases = await listReleases(platform);
  res.json({ data: releases.map((r) => r.toJSON()) });
}

export async function patchRelease(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const release = await updateRelease(id, req.body as UpdateReleaseInput);
  res.json({ release: release.toJSON() });
}

export async function deleteReleaseHandler(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  await deleteRelease(id);
  res.status(204).end();
}
