import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { allowedFrontendOrigins, createApp } from '../src/app.js';
import { env } from '../src/config/env.js';

describe('health endpoints', () => {
  const app = createApp();

  it('reports process liveness using the standard response shape', async () => {
    const response = await request(app).get('/api/health/live').expect(200);

    expect(response.headers['x-request-id']).toBeTypeOf('string');
    expect(response.body).toMatchObject({
      success: true,
      data: { status: 'HEALTHY', service: 'engageflow-api' },
      meta: { requestId: response.headers['x-request-id'] },
    });
    expect(Date.parse(response.body.data.timestamp)).not.toBeNaN();
  });

  it('reports unconfigured dependencies without pretending they are healthy', async () => {
    const originalMongo = env.MONGODB_URI;
    const originalRedis = env.REDIS_URL;
    env.MONGODB_URI = '';
    env.REDIS_URL = '';
    const response = await request(app).get('/api/health/ready').expect(200);
    env.MONGODB_URI = originalMongo;
    env.REDIS_URL = originalRedis;

    expect(response.body.data).toMatchObject({
      status: 'HEALTHY',
      dependencies: {
        mongodb: { status: 'NOT_CONFIGURED' },
        redis: { status: 'NOT_CONFIGURED' },
      },
    });
  });

  it('returns a safe standard error for unknown routes', async () => {
    const response = await request(app).get('/api/unknown').expect(404);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'ROUTE_NOT_FOUND' },
    });
  });

  it('allows explicitly configured local and public frontend origins', () => {
    expect(allowedFrontendOrigins('http://localhost:5173, https://frontend.example.test/')).toEqual([
      'http://localhost:5173',
      'https://frontend.example.test',
    ]);
  });
});
