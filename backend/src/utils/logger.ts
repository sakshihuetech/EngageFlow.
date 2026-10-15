type LogLevel = 'info' | 'warn' | 'error';
type SafeMetadata = Record<string, string | number | boolean | null | undefined>;

const blockedKeys = /authorization|cookie|token|secret|password|credential|api[-_]?key/i;

function redact(metadata: SafeMetadata): SafeMetadata {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, blockedKeys.test(key) ? '[REDACTED]' : value]),
  );
}

function write(level: LogLevel, message: string, metadata: SafeMetadata = {}) {
  const entry = JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...redact(metadata) });
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.info(entry);
}

export const logger = {
  info: (message: string, metadata?: SafeMetadata) => write('info', message, metadata),
  warn: (message: string, metadata?: SafeMetadata) => write('warn', message, metadata),
  error: (message: string, metadata?: SafeMetadata) => write('error', message, metadata),
};
