declare global {
  namespace Express {
    interface Request {
      requestId: string;
      workspaceContext?: import('./workspace.js').WorkspaceContext;
      apiCredentialId?: string;
    }
  }
}

export {};
