import { describe, expect, it } from 'vitest';
import { normalizeApiUrl } from './client';

describe('API URL composition', () => {
  it('does not duplicate the API prefix when VITE_API_URL already includes it', () => {
    expect(`${normalizeApiUrl('https://api.example.test/api')}/api/campaigns?limit=100`)
      .toBe('https://api.example.test/api/campaigns?limit=100');
  });

  it('preserves a host-only API URL', () => {
    expect(`${normalizeApiUrl('http://localhost:5001')}/api/health/live`)
      .toBe('http://localhost:5001/api/health/live');
  });
});
