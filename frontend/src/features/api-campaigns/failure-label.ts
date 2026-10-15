import type { ApiExecution } from './types';

export function executionFailureLabel(execution: ApiExecution): string {
  const title = execution.failureTitle?.trim();
  const message = execution.failureMessage?.trim();
  const code = execution.failureCode?.trim();
  const genericTitle = title === 'API Campaign execution failed' || title === 'Execution failed';
  const genericMessage = message === 'The execution could not be completed.';
  return (genericTitle ? '' : title)
    || (genericMessage ? '' : message)
    || (code ? (genericTitle || genericMessage) && /^\d{5,6}$/.test(code) ? `Meta error ${code}` : code : '')
    || title
    || message
    || (execution.status === 'FAILED' || execution.status === 'REJECTED' ? 'Execution failed; no reason was recorded.' : '—');
}
