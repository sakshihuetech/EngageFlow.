export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface SafeProviderDiagnostic {
  httpStatus: number;
  metaCode?: number;
  metaSubcode?: number;
  title?: string;
  message: string;
  traceId?: string;
}

export class TemplateLibraryProviderError extends AppError {
  constructor(public readonly provider: SafeProviderDiagnostic) {
    super(provider.httpStatus, 'META_TEMPLATE_REQUEST_FAILED', provider.message);
  }
}
