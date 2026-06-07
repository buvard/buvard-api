import { Router, type Request, type Response } from 'express';
import { listGrades } from '../../services/grade.service.js';

export const gradeRouter: Router = Router();

// GET /v1/grades — liste publique des paliers. Tries par order croissant.
// Lecture depuis le cache memoire (charge au boot) — pas de cout BDD.
gradeRouter.get('/', (_req: Request, res: Response) => {
  res.json({ data: listGrades() });
});
