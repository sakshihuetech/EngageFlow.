import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(5001),
  FRONTEND_ORIGIN: z.string().refine((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean).every((origin) => {
    try { return Boolean(new URL(origin)); } catch { return false; }
  }), 'FRONTEND_ORIGIN must contain valid comma-separated URLs').default('http://localhost:5173'),
  MONGODB_URI: z.string().optional().default(''),
  REDIS_URL: z.string().optional().default(''),
  DEV_WORKSPACE_ID: z.string().optional().default(''),
  CAMPAIGN_LIVE_SEND_ENABLED: z.enum(['true', 'false']).default('false'),
  CAMPAIGN_TEST_BYPASS_CONSENT: z.enum(['true', 'false']).default('false'),
  CAMPAIGN_TRANSPORT: z.enum(['disabled', 'mock', 'meta']).default('disabled'),
  CAMPAIGN_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(2),
  CAMPAIGN_BATCH_SIZE: z.coerce.number().int().min(10).max(500).default(100),
  API_CAMPAIGN_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  API_CAMPAIGN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(60000),
  API_CAMPAIGN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(120),
  API_CAMPAIGN_TEST_BYPASS_CONSENT: z.enum(['true','false']).default('false'),
  META_APP_ID: z.string().optional().default(''),
  META_APP_SECRET: z.string().optional().default(''),
  ENCRYPTION_KEY: z.string().optional().default(''),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
  WEBHOOK_VERIFY_TOKEN: z.string().optional().default(''),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Invalid environment configuration: ${fields}`);
}

export const env = result.data;
