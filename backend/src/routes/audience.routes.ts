import { Router } from 'express';
import { createContact, createSegment, deleteContact, deleteSegment, listContacts, listSegments, restoreContact, updateContact, updateSegment } from '../controllers/audience.controller.js';
import { bulkContacts, getContact, importContactBatch } from '../controllers/audience.controller.js';

export const audienceRouter = Router();

audienceRouter.get('/contacts', listContacts);
audienceRouter.post('/contacts', createContact);
audienceRouter.post('/contacts/import', importContactBatch);
audienceRouter.post('/contacts/bulk', bulkContacts);
audienceRouter.get('/contacts/:id', getContact);
audienceRouter.patch('/contacts/:id', updateContact);
audienceRouter.delete('/contacts/:id', deleteContact);
audienceRouter.post('/contacts/:id/restore', restoreContact);
audienceRouter.get('/segments', listSegments);
audienceRouter.post('/segments', createSegment);
audienceRouter.patch('/segments/:id', updateSegment);
audienceRouter.delete('/segments/:id', deleteSegment);
