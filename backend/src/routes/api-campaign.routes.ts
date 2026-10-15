import { Router } from "express";
import {
  apiCampaignOptions,
  archiveApiCampaign,
  createApiCampaign,
  apiCampaignAnalytics,
  getApiCampaign,
  getExecution,
  listApiCampaigns,
  listExecutions,
  restoreApiCampaign,
  retryExecution,
  retryExecutionPreview,
  updateApiCampaign,
} from "../controllers/api-campaign.controller.js";
export const apiCampaignRouter = Router();
apiCampaignRouter.get("/", listApiCampaigns);
apiCampaignRouter.post("/", createApiCampaign);
apiCampaignRouter.get("/options", apiCampaignOptions);
apiCampaignRouter.get("/:id/analytics", apiCampaignAnalytics);
apiCampaignRouter.get("/:id/executions", listExecutions);
apiCampaignRouter.get("/:id/executions/:executionId", getExecution);
apiCampaignRouter.post("/:id/executions/:executionId/retry", retryExecution);
apiCampaignRouter.get("/:id/executions/:executionId/retry/preview", retryExecutionPreview);
apiCampaignRouter.get("/:id", getApiCampaign);
apiCampaignRouter.patch("/:id", updateApiCampaign);
apiCampaignRouter.post("/:id/restore", restoreApiCampaign);
apiCampaignRouter.delete("/:id", archiveApiCampaign);
