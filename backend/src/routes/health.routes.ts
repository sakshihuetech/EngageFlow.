import { Router } from 'express';
import { liveness, readiness } from '../controllers/health.controller.js';

export const healthRouter = Router();

healthRouter.get('/live', liveness);
healthRouter.get('/ready', readiness);
