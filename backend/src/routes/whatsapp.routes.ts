import { Router } from 'express';
import multer from 'multer';
import { tmpdir } from 'node:os';
import { completeOnboarding, refreshAssets, disconnect, registerPhone, readProfile, writeProfile, writePicture } from '../controllers/whatsapp-setup.controller.js';
import {
  getLatestTestMessageStatus, getTestMessageStatus, getWhatsAppSetup, getWhatsAppAccountViews,
  listWhatsAppTemplates, sendTestMessage, syncWhatsAppTemplates,
  createWhatsAppTemplate, editWhatsAppTemplate, deleteWhatsAppTemplate, listMetaTemplateLibrary,
  useWhatsAppLibraryTemplate,
  uploadWhatsAppTemplateMedia,
} from '../controllers/whatsapp.controller.js';

export const whatsAppRouter = Router();

whatsAppRouter.get('/setup', getWhatsAppSetup);
whatsAppRouter.get('/accounts/views', getWhatsAppAccountViews);
whatsAppRouter.post('/setup/onboarding/complete', completeOnboarding);
whatsAppRouter.post('/setup/refresh', refreshAssets);
whatsAppRouter.post('/setup/register', registerPhone);
whatsAppRouter.post('/setup/disconnect', disconnect);
whatsAppRouter.get('/setup/profile', readProfile);
whatsAppRouter.patch('/setup/profile', writeProfile);
whatsAppRouter.post('/setup/profile/picture', multer({ dest: tmpdir(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } }).single('file'), writePicture);
whatsAppRouter.get('/templates', listWhatsAppTemplates);
whatsAppRouter.post('/templates/sync', syncWhatsAppTemplates);
whatsAppRouter.get('/templates/library', listMetaTemplateLibrary);
whatsAppRouter.post('/templates/library/use', useWhatsAppLibraryTemplate);
whatsAppRouter.post('/templates/media', multer({ dest: tmpdir(), limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 2 } }).single('file'), uploadWhatsAppTemplateMedia);
whatsAppRouter.post('/templates', createWhatsAppTemplate);
whatsAppRouter.patch('/templates/:id', editWhatsAppTemplate);
whatsAppRouter.delete('/templates/:id', deleteWhatsAppTemplate);
whatsAppRouter.get('/messages/latest/status', getLatestTestMessageStatus);
whatsAppRouter.get('/messages/:recordId/status', getTestMessageStatus);
whatsAppRouter.post('/messages', sendTestMessage);
