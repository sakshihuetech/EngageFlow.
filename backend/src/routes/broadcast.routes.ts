import { Router } from 'express';
import {
  broadcastAnalytics, broadcastOptions, broadcastReadiness, broadcastRecipients,
  cancelBroadcast, createBroadcast, duplicateBroadcast, getBroadcast, launchBroadcast, listBroadcasts,
  pauseBroadcast, resumeBroadcast, updateBroadcast,
  retryBroadcastPreview, retryBroadcastFailed,
} from '../controllers/broadcast.controller.js';

export const broadcastRouter = Router();

broadcastRouter.get('/', listBroadcasts);
broadcastRouter.post('/', createBroadcast);
broadcastRouter.get('/options', broadcastOptions);
broadcastRouter.get('/:id/readiness', broadcastReadiness);
broadcastRouter.get('/:id/analytics', broadcastAnalytics);
broadcastRouter.get('/:id/recipients', broadcastRecipients);
broadcastRouter.get('/:id/retry/preview', retryBroadcastPreview);
broadcastRouter.post('/:id/retry', retryBroadcastFailed);
broadcastRouter.post('/:id/launch', launchBroadcast);
broadcastRouter.post('/:id/pause', pauseBroadcast);
broadcastRouter.post('/:id/resume', resumeBroadcast);
broadcastRouter.post('/:id/cancel', cancelBroadcast);
broadcastRouter.post('/:id/duplicate', duplicateBroadcast);
broadcastRouter.get('/:id', getBroadcast);
broadcastRouter.patch('/:id', updateBroadcast);
