import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { requestId } from './middleware/request-id.js';
import { securityHeaders } from './middleware/security-headers.js';
import { apiRouter } from './routes/index.js';
import { broadcastRouter } from './routes/broadcast.routes.js';
import { whatsAppWebhookRouter } from './routes/whatsapp-webhook.routes.js';
import { whatsAppRouter } from './routes/whatsapp.routes.js';
import { audienceRouter } from './routes/audience.routes.js';
import { inboxRouter } from './routes/inbox.routes.js';
import { apiCampaignRouter } from './routes/api-campaign.routes.js';
import { apiCredentialRouter } from './routes/api-credential.routes.js';
import { apiCampaignTriggerRouter } from './routes/api-campaign-trigger.routes.js';
import { listExecutions } from './controllers/api-campaign.controller.js';
import { requireDatabase } from './middleware/require-database.js';
import { requireWorkspace } from './middleware/require-workspace.js';
import { requireRetargetingAccess } from './middleware/require-retargeting-access.js';
import { retargetingRouter } from './routes/retargeting.routes.js';
import { createWorkspaceResolver, type WorkspaceResolver } from './types/workspace.js';

export function allowedFrontendOrigins(value: string) {
  return value.split(',').map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean);
}

export function createApp(options: { workspaceResolver?: WorkspaceResolver } = {}) {
  const app = express();
  const workspaceResolver = options.workspaceResolver ?? createWorkspaceResolver();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(securityHeaders);
  app.use(cors({ origin: allowedFrontendOrigins(env.FRONTEND_ORIGIN), methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'X-Request-Id', 'Idempotency-Key', 'Authorization'] }));
  app.use('/api/webhooks/whatsapp', whatsAppWebhookRouter);
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', apiRouter);
  app.use('/api/v1/campaigns', requireDatabase, apiCampaignTriggerRouter);
  app.use('/api/v1/whatsapp/api-campaigns', requireDatabase, apiCampaignTriggerRouter);
  app.use('/api/campaigns/:id/retargeting', requireRetargetingAccess, requireDatabase, retargetingRouter);
  app.use('/api/campaigns', requireWorkspace(workspaceResolver), requireDatabase, broadcastRouter);
  app.use('/api/whatsapp', requireWorkspace(workspaceResolver), requireDatabase, whatsAppRouter);
  app.use('/api/audience', requireWorkspace(workspaceResolver), requireDatabase, audienceRouter);
  app.use('/api/inbox', requireWorkspace(workspaceResolver), requireDatabase, inboxRouter);
  app.use('/api/api-campaigns', requireWorkspace(workspaceResolver), requireDatabase, apiCampaignRouter);
  app.use('/api/api-credentials', requireWorkspace(workspaceResolver), requireDatabase, apiCredentialRouter);
  app.get('/api/api-campaign-executions', requireWorkspace(workspaceResolver), requireDatabase, listExecutions);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
