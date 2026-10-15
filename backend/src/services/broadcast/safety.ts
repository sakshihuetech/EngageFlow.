import { sanitizeMetaDiagnosticText } from '../whatsapp/meta-graph.service.js';

export function safeFailureText(value: unknown, max = 1_000): string {
  return sanitizeMetaDiagnosticText(value, max) ?? '';
}

export function maskPhone(value: string): string {
  if (value.length < 5) return '***';
  return `${value.slice(0, 3)}${'*'.repeat(Math.max(4, value.length - 5))}${value.slice(-2)}`;
}
