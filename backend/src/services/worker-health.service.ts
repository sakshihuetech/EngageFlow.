import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_FRESH_MS = 45_000;
export const HEARTBEAT_TTL_SECONDS = 120;
export type WorkerKind = 'broadcast' | 'api-campaign';
export type WorkerHealth = { status: 'HEALTHY' | 'STALE' | 'NOT_VERIFIED' };
const key = (kind: WorkerKind) => `engageflow:worker:${kind}:heartbeat`;
type HeartbeatRedis = Pick<Redis, 'set' | 'get' | 'eval'>;

export function heartbeatStatus(value: string | null, now = Date.now()): WorkerHealth {
  if (!value || !/^[^|]+\|\d+$/.test(value)) return { status: 'NOT_VERIFIED' };
  const timestamp = Number(value.split('|')[1]);
  if (!Number.isFinite(timestamp) || timestamp > now + 5_000) return { status: 'NOT_VERIFIED' };
  return { status: now - timestamp <= HEARTBEAT_FRESH_MS ? 'HEALTHY' : 'STALE' };
}

export async function readWorkerHealth(redis: HeartbeatRedis, kind: WorkerKind): Promise<WorkerHealth> {
  try { return heartbeatStatus(await redis.get(key(kind))); }
  catch { return { status: 'NOT_VERIFIED' }; }
}

/** One bounded key per worker role. Shutdown only removes this instance's lease. */
export async function startWorkerHeartbeat(redis: HeartbeatRedis, kind: WorkerKind) {
  const instance = randomUUID();
  let stopped = false;
  let inFlight = false;
  let pending: Promise<unknown> = Promise.resolve();
  const beat = () => {
    if (stopped || inFlight) return;
    inFlight = true;
    pending = redis.set(key(kind), `${instance}|${Date.now()}`, 'EX', HEARTBEAT_TTL_SECONDS).catch(() => undefined).finally(() => { inFlight = false; });
  };
  beat();
  await boundedHealthRead(pending).catch(() => undefined);
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await boundedHealthRead(pending).catch(() => undefined);
    await boundedHealthRead(redis.eval("local v=redis.call('get',KEYS[1]); if v and string.sub(v,1,string.len(ARGV[1]))==ARGV[1] then return redis.call('del',KEYS[1]) end return 0", 1, key(kind), `${instance}|`)).catch(() => undefined);
  };
}

export function boundedQueueCounts(counts: Record<string, number>) {
  return Object.fromEntries(['waiting', 'active', 'delayed', 'failed'].map(name => [name, Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(Number.isFinite(counts[name]) ? counts[name]! : 0)))]));
}

export async function boundedHealthRead<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Health check timed out.')), 5000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
