import express, { Router } from 'express';
import { handleClerkWebhook } from '../controllers/webhook.controller.js';

export const webhookRouter: Router = Router();

// Body brut requis pour la verification de signature svix
webhookRouter.post('/clerk', express.raw({ type: 'application/json' }), handleClerkWebhook);
