import { Router } from "express";
import { apiKeyAuth } from "../middleware/api-key-auth.js";
import { apiCampaignRateLimit } from "../middleware/api-campaign-rate-limit.js";
import { trigger } from "../controllers/api-campaign-trigger.controller.js";
export const apiCampaignTriggerRouter = Router();
apiCampaignTriggerRouter.post(
  "/trigger",
  apiKeyAuth,
  apiCampaignRateLimit,
  trigger,
);
