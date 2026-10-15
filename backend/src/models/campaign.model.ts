import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const countersSchema = new Schema({
  total: { type: Number, default: 0, min: 0 },
  pending: { type: Number, default: 0, min: 0 },
  queued: { type: Number, default: 0, min: 0 },
  accepted: { type: Number, default: 0, min: 0 },
  sent: { type: Number, default: 0, min: 0 },
  delivered: { type: Number, default: 0, min: 0 },
  read: { type: Number, default: 0, min: 0 },
  failed: { type: Number, default: 0, min: 0 },
  skipped: { type: Number, default: 0, min: 0 },
  cancelled: { type: Number, default: 0, min: 0 },
}, { _id: false });

const campaignSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  whatsappAccountId: { type: Schema.Types.ObjectId, ref: 'WhatsAppAccount', required: true },
  phoneNumberId: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  channel: { type: String, enum: ['WHATSAPP'], default: 'WHATSAPP', required: true },
  type: { type: String, enum: ['BROADCAST'], default: 'BROADCAST', required: true },
  status: {
    type: String,
    enum: ['DRAFT', 'SNAPSHOTTING', 'READY', 'SCHEDULED', 'QUEUED', 'PROCESSING', 'PAUSED', 'CANCELLED', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'],
    default: 'DRAFT', required: true,
  },
  whatsAppTemplateId: { type: Schema.Types.ObjectId, ref: 'WhatsAppTemplate' },
  templateSnapshot: Schema.Types.Mixed,
  parameterMapping: { type: Schema.Types.Mixed, default: {} },
  mediaMapping: { type: Schema.Types.Mixed, default: {} },
  audienceDefinition: { type: Schema.Types.Mixed, default: () => ({ source: 'CONTACTS', contactIds: [] }) },
  audienceSnapshotCount: { type: Number, default: 0, min: 0 },
  sourceCampaignId: { type: Schema.Types.ObjectId, ref: 'Campaign' },
  retargetingFilter: { type: String, enum: ['READ', 'DELIVERED_NOT_READ', 'FAILED'] },
  retargetingSourceAccountId: { type: Schema.Types.ObjectId, ref: 'WhatsAppAccount' },
  retargetingSourceWabaId: { type: String, trim: true },
  snapshotAt: Date,
  sendMode: { type: String, enum: ['DRAFT', 'SEND_NOW', 'SCHEDULE'], default: 'DRAFT' },
  scheduledAt: Date,
  timezone: { type: String, trim: true, maxlength: 80, default: 'UTC' },
  counters: { type: countersSchema, default: () => ({}) },
  idempotencyKey: { type: String, trim: true, maxlength: 160 },
  creationFingerprint: { type: String, trim: true, maxlength: 64, select: false },
  launchKey: { type: String, trim: true, maxlength: 160 },
  launchRequestedAt: Date,
  dispatchSequence: { type: Number, default: 0, min: 0 },
  retryBatchId: { type: String, trim: true, maxlength: 100 },
  retryKey: { type: String, trim: true, maxlength: 160 },
  retryRequestedAt: Date,
  retryLastError: { type: String, trim: true, maxlength: 300 },
  createdBy: { type: String, trim: true, maxlength: 160, default: 'DEVELOPMENT_UI' },
  updatedBy: { type: String, trim: true, maxlength: 160 },
}, { timestamps: true, collection: 'campaigns' });

campaignSchema.index({ workspaceId: 1, createdAt: -1, _id: -1 });
campaignSchema.index({ workspaceId: 1, whatsappAccountId: 1, _id: -1 });
campaignSchema.index({ workspaceId: 1, status: 1, scheduledAt: 1 });
campaignSchema.index({ workspaceId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
campaignSchema.index({ workspaceId: 1, launchKey: 1 }, { unique: true, partialFilterExpression: { launchKey: { $type: 'string' } } });

export type CampaignDocument = InferSchemaType<typeof campaignSchema>;
export const Campaign = (mongoose.models.Campaign as Model<CampaignDocument> | undefined) ?? mongoose.model<CampaignDocument>('Campaign', campaignSchema);
