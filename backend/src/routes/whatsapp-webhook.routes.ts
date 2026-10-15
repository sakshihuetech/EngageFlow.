import { Router, raw } from 'express';
import { receiveWhatsAppWebhook, verifyWhatsAppWebhook } from '../controllers/whatsapp-webhook.controller.js';

export const whatsAppWebhookRouter = Router();

whatsAppWebhookRouter.get('/', verifyWhatsAppWebhook);
whatsAppWebhookRouter.post('/', raw({ type: 'application/json', limit: '100kb' }), receiveWhatsAppWebhook);
