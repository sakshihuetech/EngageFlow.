import mongoose from 'mongoose';
import { CampaignRecipient } from '../src/models/campaign-recipient.model.js';
import { ApiCampaignExecution } from '../src/models/api-campaign-execution.model.js';
import { WhatsAppMessage } from '../src/models/whatsapp-message.model.js';

// No application-env import, index synchronization, document output, or writes.
// Supply separately authorized read-only credentials; this script cannot verify privileges.
const uri = process.env.INDEX_AUDIT_READONLY_MONGODB_URI;
if (!uri) {
  console.error('INDEX_AUDIT_READONLY_MONGODB_URI must be an explicitly authorized read-only MongoDB URI.');
  process.exitCode = 2;
} else {
  const checks = [
    { model: CampaignRecipient, keys: { workspaceId: 1, campaignId: 1, recipientKey: 1 } },
    { model: ApiCampaignExecution, keys: { workspaceId: 1, apiCampaignId: 1, idempotencyKey: 1 } },
    { model: WhatsAppMessage, keys: { metaMessageId: 1 } },
    { model: WhatsAppMessage, keys: { workspaceId: 1, campaignRecipientId: 1 }, sparse: true },
    { model: WhatsAppMessage, keys: { workspaceId: 1, apiCampaignExecutionId: 1 }, sparse: true },
  ] as const;
  try {
    await mongoose.connect(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 3_000, socketTimeoutMS: 5_000 });
    for (const check of checks) {
      const { model, keys } = check;
      const identity = `${model.collection.name} (${Object.keys(keys).join(', ')})`;
      try {
        const indexes = await model.collection.listIndexes().toArray();
        const matchingKeys = indexes.filter((index) => JSON.stringify(index.key) === JSON.stringify(keys));
        console.log(`${identity}: installed=${JSON.stringify(matchingKeys.map((index) => ({ name: index.name, key: index.key, unique: index.unique === true, sparse: index.sparse === true, partialFilterExpression: index.partialFilterExpression ?? null, collation: index.collation ?? null })))}`);
        const exact = matchingKeys.some((index) => index.unique === true && (index.sparse === true) === ('sparse' in check) && !index.partialFilterExpression && !index.collation);
        if (!exact) {
          console.log(`${identity}: declared unique index NOT VERIFIED as installed`);
          process.exitCode = 1;
        }
        // Bounded duplicate-existence probe, not an exhaustive count. Include missing
        // optional fields, since compound sparse indexes include rows with workspaceId.
        const duplicate = await model.collection.aggregate([
          { $group: { _id: Object.fromEntries(Object.keys(keys).map((key) => [key, `$${key}`])), count: { $sum: 1 } } },
          { $match: { count: { $gt: 1 } } },
          { $limit: 1 },
          { $project: { _id: 0, found: { $literal: true } } },
        ], { maxTimeMS: 3_000, allowDiskUse: false }).toArray();
        console.log(`${identity}: duplicateGroup=${duplicate.length ? 'FOUND' : 'NONE_FOUND_WITHIN_LIMIT'}`);
        if (duplicate.length) process.exitCode = 1;
      } catch (error) {
        console.error(`${identity}: INCONCLUSIVE (${error instanceof Error ? error.name : 'UnknownError'})`);
        process.exitCode = 1;
      }
    }
    for (const fields of [['workspaceId', 'retryRecipientId'], ['workspaceId', 'apiCampaignRetryExecutionId', 'apiCampaignRetrySequence']]) {
      const identity = `whatsappmessages (${fields.join(', ')})`;
      try {
        const indexes = await WhatsAppMessage.collection.listIndexes().toArray();
        const related = indexes.filter((index) => fields.slice(1).some((field) => field in index.key));
        console.log(`${identity}: relatedInstalled=${JSON.stringify(related.map((index) => ({ name: index.name, key: index.key, unique: index.unique === true, sparse: index.sparse === true, partialFilterExpression: index.partialFilterExpression ?? null })))}`);
        const duplicates = await WhatsAppMessage.collection.aggregate([
          { $match: Object.fromEntries(fields.slice(1).map((field) => [field, { $exists: true }])) },
          { $group: { _id: Object.fromEntries(fields.map((field) => [field, `$${field}`])), count: { $sum: 1 } } },
          { $match: { count: { $gt: 1 } } }, { $limit: 1 }, { $project: { _id: 0, found: { $literal: true } } },
        ], { maxTimeMS: 3_000, allowDiskUse: false }).toArray();
        console.log(`${identity}: duplicateGroup=${duplicates.length ? 'FOUND' : 'NONE_FOUND_WITHIN_LIMIT'}; schemaUnique=ABSENT`);
        if (duplicates.length) process.exitCode = 1;
      } catch (error) {
        console.error(`${identity}: INCONCLUSIVE (${error instanceof Error ? error.name : 'UnknownError'})`);
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error(`Index verification unavailable: ${error instanceof Error ? error.name : 'UnknownError'}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
