import type { Request } from 'express';
import mongoose from 'mongoose';
import { env } from '../config/env.js';

export interface WorkspaceContext {
  workspaceId: string;
}

export interface WorkspaceResolver {
  resolve(request: Request): Promise<WorkspaceContext | null>;
}

export class UnconfiguredWorkspaceResolver implements WorkspaceResolver {
  async resolve(_request: Request): Promise<WorkspaceContext | null> {
    void _request;
    return null;
  }
}

export class DevelopmentWorkspaceResolver implements WorkspaceResolver {
  async resolve(_request: Request): Promise<WorkspaceContext | null> {
    void _request;
    if (env.NODE_ENV === 'production' || !mongoose.isValidObjectId(env.DEV_WORKSPACE_ID)) return null;
    return { workspaceId: env.DEV_WORKSPACE_ID };
  }
}

export function createWorkspaceResolver(): WorkspaceResolver {
  return env.DEV_WORKSPACE_ID ? new DevelopmentWorkspaceResolver() : new UnconfiguredWorkspaceResolver();
}
