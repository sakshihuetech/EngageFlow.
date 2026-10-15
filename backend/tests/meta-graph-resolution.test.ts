import { describe, expect, it } from 'vitest';
import { metaFailureResolution } from '../src/services/whatsapp/meta-graph.service.js';

describe('Meta 131037 resolution', () => {
  it('preserves provider code and gives safe guidance', () => {
    expect(metaFailureResolution(131037)).toMatchObject({ code: '131037', title: 'Display name approval required' });
    expect(JSON.stringify(metaFailureResolution(131037))).not.toMatch(/access_token|credential|Bearer/i);
  });
  it('does not change other errors', () => {
    expect(metaFailureResolution(131042)?.code).toBe('131042');
    expect(metaFailureResolution(999999)).toBeUndefined();
  });
});
