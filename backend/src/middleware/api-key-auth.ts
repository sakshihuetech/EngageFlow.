import type { NextFunction, Request, Response } from 'express';
import { authenticateApiKey } from '../services/api-campaign/credential.service.js';
import { AppError } from '../utils/app-error.js';
export async function apiKeyAuth(req:Request,res:Response,next:NextFunction){try{const {credential,workspace}=await authenticateApiKey(req.get('authorization')); req.workspaceContext={workspaceId:String(workspace._id)}; req.apiCredentialId=String(credential._id); next();}catch(error){if(req.baseUrl==='/api/v1/whatsapp/api-campaigns'){const known=error instanceof AppError?error:undefined;res.status(known?.statusCode??500).json({code:known?.code??'API_CAMPAIGN_ERROR',message:known?.message??'API Campaign authentication failed.'});return;}next(error);}}
