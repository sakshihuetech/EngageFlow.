import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { WhatsAppMessage } from '../models/whatsapp-message.model.js';
import { getWhatsAppSetupOverview, resolveConnectedWhatsApp } from '../services/whatsapp/connection-context.service.js';
import { metaFailureResolution, MetaGraphError, sanitizeMetaDiagnosticText } from '../services/whatsapp/meta-graph.service.js';
import { sendApprovedTemplateMessage } from '../services/whatsapp/send-approved-template.service.js';
import { listWorkspaceTemplates, syncWorkspaceTemplates, validateTemplateStatus } from '../services/whatsapp/template.service.js';
import { createWorkspaceTemplate, editWorkspaceTemplate, deleteWorkspaceTemplate, listMetaLibrary, useMetaLibraryTemplate } from '../services/whatsapp/template-authoring.service.js';
import { successResponse } from '../utils/api-response.js';
import { unlink } from 'node:fs/promises';
import { uploadWorkspaceTemplateMedia } from '../services/whatsapp/template-media.service.js';
import { AppError, TemplateLibraryProviderError } from '../utils/app-error.js';
import { listAccountViews } from '../services/whatsapp/account-view.service.js';

function workspaceId(request: Request) {
  if (!request.workspaceContext) throw new AppError(503, 'WORKSPACE_CONTEXT_UNAVAILABLE', 'Workspace authentication is not configured.');
  return request.workspaceContext.workspaceId;
}

function asyncController(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch((error: unknown) => {
    if (error instanceof MetaGraphError) {
      const resolution = metaFailureResolution(error.details.code);
      next(new AppError(error.status, resolution?.code ?? error.code, resolution?.message ?? (error.status === 429 ? 'Meta rate limit reached. Try again later.' : 'Meta could not complete the template request. Check the template fields and connected account permissions.')));
    } else next(error);
  });
}

function safeMessageStatus(message: Record<string, unknown> & { _id: unknown }) {
  const resolution = metaFailureResolution(message.failureCode);
  return {
    recordId: String(message._id), messageId: message.metaMessageId, status: message.status,
    acceptedAt: message.acceptedAt, sentAt: message.sentAt, deliveredAt: message.deliveredAt,
    readAt: message.readAt, failedAt: message.failedAt, failureCode: message.failureCode,
    failureTitle: resolution?.title ?? message.failureTitle,
    failureMessage: resolution?.message ?? message.failureMessage,
    ...(resolution ? { nextAction: resolution.nextAction, actionUrl: resolution.actionUrl } : {}),
  };
}

export const getWhatsAppSetup = asyncController(async (request, response) => {
  const overview = await getWhatsAppSetupOverview(workspaceId(request));
  response.json(successResponse(request, {
    ...overview,
    liveSendEnabled: env.CAMPAIGN_LIVE_SEND_ENABLED === 'true',
    transport: env.CAMPAIGN_TRANSPORT === 'meta' ? 'META' : env.CAMPAIGN_TRANSPORT === 'mock' && env.NODE_ENV !== 'production' ? 'MOCK' : 'DISABLED',
    webhook: { configured: Boolean(env.META_APP_SECRET && env.WEBHOOK_VERIFY_TOKEN), subscribed: overview.connection.webhookSubscribed ?? false },
  }));
});

export const getWhatsAppAccountViews = asyncController(async (request, response) => {
  response.json(successResponse(request, await listAccountViews(workspaceId(request))));
});

export const listWhatsAppTemplates = asyncController(async (request, response) => {
  const status = validateTemplateStatus(request.query.status);
  const search = typeof request.query.search === 'string' ? request.query.search.trim().slice(0, 160) : '';
  const templates = await listWorkspaceTemplates(workspaceId(request), { ...(status !== 'ALL' ? { status } : {}), ...(search ? { search } : {}) });
  response.json(successResponse(request, { items: templates }));
});

export const syncWhatsAppTemplates = asyncController(async (request, response) => {
  const templates = await syncWorkspaceTemplates(workspaceId(request));
  response.json(successResponse(request, { items: templates, synced: templates.length }));
});

export const createWhatsAppTemplate = asyncController(async (request, response) => {
  response.status(201).json(successResponse(request, await createWorkspaceTemplate(workspaceId(request), request.body)));
});
export const editWhatsAppTemplate = asyncController(async (request, response) => {
  response.json(successResponse(request, await editWorkspaceTemplate(workspaceId(request), String(request.params.id), request.body)));
});
export const deleteWhatsAppTemplate = asyncController(async (request, response) => {
  response.json(successResponse(request, await deleteWorkspaceTemplate(workspaceId(request), String(request.params.id))));
});
export const listMetaTemplateLibrary = asyncController(async (request, response) => {
  const query = request.query;
  const filters = Object.fromEntries(['category', 'language', 'search', 'topic', 'usecase', 'industry', 'after'].filter((key) => typeof query[key] === 'string').map((key) => [key, String(query[key]).slice(0, 256)]));
  if (filters.category) filters.category = filters.category.toUpperCase();
  const limit = Number(query.limit);
  response.json(successResponse(request, await listMetaLibrary(workspaceId(request), { ...filters, ...(Number.isInteger(limit) ? { limit } : {}) })));
});
export function templateLibraryProviderError(error: MetaGraphError) {
  const details = error.details;
  const title = sanitizeMetaDiagnosticText(details.userTitle);
  const message = sanitizeMetaDiagnosticText(details.userMessage ?? details.providerMessage, 500);
  return new TemplateLibraryProviderError({
    httpStatus: error.status,
    ...(Number.isSafeInteger(details.code) && details.code! >= 0 ? { metaCode: details.code } : {}),
    ...(Number.isSafeInteger(details.errorSubcode) && details.errorSubcode! >= 0 ? { metaSubcode: details.errorSubcode } : {}),
    ...(title ? { title } : {}),
    message: message ?? 'Meta could not complete the template request. Check the selected template and connected account.',
    ...(details.traceId && /^[A-Za-z0-9._-]{1,128}$/.test(details.traceId) ? { traceId: details.traceId } : {}),
  });
}
export const useWhatsAppLibraryTemplate = asyncController(async (request, response) => {
  try {
    response.status(201).json(successResponse(request, await useMetaLibraryTemplate(workspaceId(request), request.body)));
  } catch (error) {
    if (!(error instanceof MetaGraphError)) throw error;
    throw templateLibraryProviderError(error);
  }
});
export const uploadWhatsAppTemplateMedia = asyncController(async (request, response) => {
  try {
    response.status(201).json(successResponse(request, await uploadWorkspaceTemplateMedia(workspaceId(request), request.body?.headerType, request.file)));
  } finally {
    if (request.file?.path) await unlink(request.file.path).catch(() => {});
  }
});

export function assertTestMessagingEnabled() {
  if (env.CAMPAIGN_LIVE_SEND_ENABLED !== 'true') throw new AppError(503, 'LIVE_SEND_DISABLED', 'Live WhatsApp sending is disabled.');
  if (env.CAMPAIGN_TRANSPORT !== 'meta') throw new AppError(503, 'TRANSPORT_NOT_CONFIGURED', 'The live Meta transport is not configured.');
}

export const sendTestMessage = asyncController(async (request, response) => {
  assertTestMessagingEnabled();
  const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {};
  for (const forbidden of ['workspaceId', 'accessToken', 'wabaId']) if (forbidden in body) throw new AppError(400, 'SERVER_CONTROLLED_FIELD', 'Workspace and credentials are resolved by the server.');
  const context = await resolveConnectedWhatsApp(workspaceId(request));
  const phoneNumberId = typeof body.phoneNumberId === 'string' ? body.phoneNumberId : context.phones.length === 1 ? context.phones[0]!.phoneNumberId : '';
  if (!phoneNumberId) throw new AppError(400, 'PHONE_SELECTION_REQUIRED', 'Select a connected WhatsApp phone.');
  try {
    const result = await sendApprovedTemplateMessage({
      workspaceId: context.workspace._id,
      whatsappAccountId: context.account._id,
      phoneNumberId,
      templateRecordId: body.templateRecordId as string,
      recipient: body.recipient as string,
      ...(Array.isArray(body.bodyVariables) ? { bodyVariables: body.bodyVariables as string[] } : {}),
      ...(Array.isArray(body.headerVariables) ? { headerVariables: body.headerVariables as string[] } : {}),
      ...(body.buttonVariables && typeof body.buttonVariables === 'object' && !Array.isArray(body.buttonVariables) ? { buttonVariables: body.buttonVariables as Record<string, string> } : {}),
      ...(body.media && typeof body.media === 'object' && !Array.isArray(body.media) ? { media: body.media as { type?: unknown; source?: unknown; value?: unknown; fileName?: unknown } } : {}),
      sendSource: 'TEST',
    });
    response.status(201).json(successResponse(request, { ...result, status: 'ACCEPTED' }));
  } catch (error) {
    if (error instanceof MetaGraphError) {
      const resolution = metaFailureResolution(error.details.code);
      throw new AppError(error.status, resolution?.code ?? error.code, resolution?.message ?? error.details.userMessage ?? error.message);
    }
    throw error;
  }
});

export const getTestMessageStatus = asyncController(async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.recordId)) throw new AppError(400, 'INVALID_ID', 'A valid message record is required.');
  const message = await WhatsAppMessage.findOne({ _id: request.params.recordId, workspaceId: workspaceId(request), sendSource: 'TEST' }).lean();
  if (!message) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Message status was not found.');
  response.json(successResponse(request, safeMessageStatus(message as unknown as Record<string, unknown> & { _id: unknown })));
});

export const getLatestTestMessageStatus = asyncController(async (request, response) => {
  const message = await WhatsAppMessage.findOne({ workspaceId: workspaceId(request), sendSource: 'TEST' }).sort({ acceptedAt: -1, createdAt: -1 }).lean();
  response.json(successResponse(request, message ? safeMessageStatus(message as unknown as Record<string, unknown> & { _id: unknown }) : null));
});
