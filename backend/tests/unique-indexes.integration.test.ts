import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { CampaignRecipient } from '../src/models/campaign-recipient.model.js';
import { ApiCampaignExecution } from '../src/models/api-campaign-execution.model.js';
import { WhatsAppMessage } from '../src/models/whatsapp-message.model.js';

const identities = [
  { model: CampaignRecipient, keys: { workspaceId: 1, campaignId: 1, recipientKey: 1 }, row: () => ({ campaignId: new mongoose.Types.ObjectId(), recipientKey: 'recipient-a', recipientPhone: '000' }) },
  { model: ApiCampaignExecution, keys: { workspaceId: 1, apiCampaignId: 1, idempotencyKey: 1 }, row: () => ({ apiCampaignId: new mongoose.Types.ObjectId(), idempotencyKey: 'request-a', campaignSlug: 'test', destination: '000', requestFingerprint: 'fingerprint' }) },
  { model: WhatsAppMessage, keys: { metaMessageId: 1 }, row: () => ({ metaMessageId: 'wamid.test', whatsappAccountId: new mongoose.Types.ObjectId(), phoneNumberId: 'test', recipient: '000' }) },
  { model: WhatsAppMessage, keys: { workspaceId: 1, campaignRecipientId: 1 }, row: () => ({ campaignRecipientId: new mongoose.Types.ObjectId(), metaMessageId: 'wamid.campaign', whatsappAccountId: new mongoose.Types.ObjectId(), phoneNumberId: 'test', recipient: '000' }) },
  { model: WhatsAppMessage, keys: { workspaceId: 1, apiCampaignExecutionId: 1 }, row: () => ({ apiCampaignExecutionId: new mongoose.Types.ObjectId(), metaMessageId: 'wamid.api', whatsappAccountId: new mongoose.Types.ObjectId(), phoneNumberId: 'test', recipient: '000' }) },
] as const;

function declaredOptions(model: typeof identities[number]['model'], keys: object) {
  const match = model.schema.indexes().find(([fields]) => JSON.stringify(fields) === JSON.stringify(keys));
  if (!match) throw new Error(`Missing declared index: ${model.modelName}`);
  return match[1];
}

function mongoIndexOptions(model: typeof identities[number]['model'], keys: object) {
  const declared = declaredOptions(model, keys);
  return { unique: declared.unique === true, ...(declared.sparse === true ? { sparse: true } : {}) };
}

describe('declared unique identities (database-independent)', () => {
  for (const { model, keys } of identities) {
    it(`${model.modelName} declares ${Object.keys(keys).join(', ')}`, () => {
      expect(declaredOptions(model, keys)).toMatchObject({ unique: true });
    });
  }
  it('declares compound sparse options, including their missing-field limitation', () => {
    for (const field of ['campaignRecipientId', 'apiCampaignExecutionId'] as const) {
      expect(declaredOptions(WhatsAppMessage, { workspaceId: 1, [field]: 1 })).toMatchObject({ unique: true, sparse: true });
    }
  });
  it('does not claim an absent unique retry-attempt index exists', () => {
    const unique = WhatsAppMessage.schema.indexes().filter(([, options]) => options.unique);
    expect(unique.some(([fields]) => 'retryRecipientId' in fields)).toBe(false);
    expect(unique.some(([fields]) => 'apiCampaignRetryExecutionId' in fields && 'apiCampaignRetrySequence' in fields)).toBe(false);
  });
});

// An operator must explicitly confirm a newly started disposable mongod. This guard
// prevents accidental default connections; it cannot authenticate server ownership.
const requested = process.env.INDEX_AUDIT_DISPOSABLE_CONFIRM === 'I_CONFIRM_DISPOSABLE_LOCAL_MONGO';
const uri = process.env.INDEX_AUDIT_TEST_MONGODB_URI;
function isolatedUri(): boolean {
  if (!uri) return false;
  try {
    const parsed = new URL(uri);
    return parsed.protocol === 'mongodb:' && parsed.host === '127.0.0.1:27028'
      && /^\/engageflow_index_test_[a-f0-9]{24}$/.test(parsed.pathname)
      && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
  } catch { return false; }
}

describe.skipIf(!requested)('unique indexes on explicitly confirmed disposable local MongoDB', () => {
  beforeAll(async () => {
    if (!isolatedUri()) throw new Error('Refusing MongoDB integration test: explicit disposable loopback URI is required');
    await mongoose.connect(uri!, { autoIndex: false, autoCreate: false, directConnection: true, serverSelectionTimeoutMS: 3_000 });
    const existing = await mongoose.connection.db!.listCollections({}, { nameOnly: true }).toArray();
    if (existing.length) {
      await mongoose.disconnect();
      throw new Error('Refusing MongoDB integration test: test database is not empty');
    }
  });
  afterAll(async () => { if (mongoose.connection.readyState !== 0) await mongoose.disconnect(); });

  for (const { model, keys, row } of identities) {
    it(`${model.modelName}: intended index rejects duplicate; workspace boundary is exact`, async () => {
      const collection = mongoose.connection.db!.collection(`index_audit_${new mongoose.Types.ObjectId().toHexString()}`);
      const options = mongoIndexOptions(model, keys);
      const indexName = `audit_${Object.keys(keys).join('_')}`;
      const workspaceId = new mongoose.Types.ObjectId();
      const fields = row();
      try {
        await collection.createIndex(keys, { ...options, name: indexName });
        await collection.insertOne({ ...fields, workspaceId, _id: new mongoose.Types.ObjectId() });
        await expect(collection.insertOne({ ...fields, workspaceId, _id: new mongoose.Types.ObjectId() }))
          .rejects.toMatchObject({ code: 11000, keyPattern: keys });
        const otherWorkspace = { ...fields, workspaceId: new mongoose.Types.ObjectId(), _id: new mongoose.Types.ObjectId() };
        if ('workspaceId' in keys) {
          await expect(collection.insertOne(otherWorkspace)).resolves.toBeDefined();
        } else {
          await expect(collection.insertOne(otherWorkspace)).rejects.toMatchObject({ code: 11000, keyPattern: keys });
        }
      } finally {
        await collection.drop().catch((error: unknown) => {
          if (!(error instanceof Error && error.name === 'MongoServerError' && 'code' in error && error.code === 26)) throw error;
        });
      }
    });
  }

  it('compound sparse unique indexes include missing optional fields when workspaceId exists', async () => {
    for (const field of ['campaignRecipientId', 'apiCampaignExecutionId'] as const) {
      const collection = mongoose.connection.db!.collection(`index_audit_${new mongoose.Types.ObjectId().toHexString()}`);
      const keys = { workspaceId: 1, [field]: 1 };
      const workspaceId = new mongoose.Types.ObjectId();
      try {
        await collection.createIndex(keys, { ...mongoIndexOptions(WhatsAppMessage, keys), name: `audit_${field}` });
        await collection.insertOne({ _id: new mongoose.Types.ObjectId(), workspaceId, metaMessageId: 'wamid.first' });
        await expect(collection.insertOne({ _id: new mongoose.Types.ObjectId(), workspaceId, metaMessageId: 'wamid.second' }))
          .rejects.toMatchObject({ code: 11000, keyPattern: keys });
        await expect(collection.insertOne({ _id: new mongoose.Types.ObjectId(), workspaceId: new mongoose.Types.ObjectId(), metaMessageId: 'wamid.third' })).resolves.toBeDefined();
      } finally {
        await collection.drop().catch((error: unknown) => {
          if (!(error instanceof Error && error.name === 'MongoServerError' && 'code' in error && error.code === 26)) throw error;
        });
      }
    }
  });

  it('current retry indexes do not enforce one message per retry attempt', async () => {
    for (const retry of [
      { fields: { retryRecipientId: new mongoose.Types.ObjectId() }, keys: { workspaceId: 1, retryRecipientId: 1, createdAt: -1 }, options: mongoIndexOptions(WhatsAppMessage, { workspaceId: 1, retryRecipientId: 1, createdAt: -1 }) },
      { fields: { apiCampaignRetryExecutionId: new mongoose.Types.ObjectId(), apiCampaignRetrySequence: 1 }, keys: null, options: null },
    ]) {
      const collection = mongoose.connection.db!.collection(`index_audit_${new mongoose.Types.ObjectId().toHexString()}`);
      const workspaceId = new mongoose.Types.ObjectId();
      try {
        if (retry.keys && retry.options) await collection.createIndex(retry.keys, retry.options);
        await collection.insertOne({ _id: new mongoose.Types.ObjectId(), workspaceId, ...retry.fields, metaMessageId: 'wamid.retry.first' });
        await expect(collection.insertOne({ _id: new mongoose.Types.ObjectId(), workspaceId, ...retry.fields, metaMessageId: 'wamid.retry.second' })).resolves.toBeDefined();
      } finally {
        await collection.drop().catch((error: unknown) => {
          if (!(error instanceof Error && error.name === 'MongoServerError' && 'code' in error && error.code === 26)) throw error;
        });
      }
    }
  });
});
