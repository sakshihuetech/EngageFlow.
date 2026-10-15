import { Router } from 'express';
import { createRetargetDraft, getRetargetPreview, getRetargetTemplates } from '../controllers/retargeting.controller.js';

export const retargetingRouter = Router({ mergeParams: true });
retargetingRouter.get('/preview', getRetargetPreview);
retargetingRouter.get('/templates', getRetargetTemplates);
retargetingRouter.post('/draft', createRetargetDraft);
