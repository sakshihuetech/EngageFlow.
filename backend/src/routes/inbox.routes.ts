import { Router } from 'express';
import { listConversationMessages, listConversations, markConversationRead, replyToConversation, updateConversation } from '../controllers/inbox.controller.js';

export const inboxRouter = Router();
inboxRouter.get('/conversations', listConversations);
inboxRouter.get('/conversations/:id/messages', listConversationMessages);
inboxRouter.post('/conversations/:id/messages', replyToConversation);
inboxRouter.post('/conversations/:id/read', markConversationRead);
inboxRouter.patch('/conversations/:id', updateConversation);
