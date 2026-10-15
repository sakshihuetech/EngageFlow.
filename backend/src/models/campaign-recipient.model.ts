import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const campaignRecipientSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true },
  contactId: { type: Schema.Types.ObjectId, ref: 'Contact' },
  sourceRecipientId: { type: Schema.Types.ObjectId, ref: 'CampaignRecipient' },
  sourceStatus: { type: String, enum: ['READ', 'DELIVERED', 'FAILED'] },
  recipientPhone: { type: String, required: true, trim: true },
  recipientKey: { type: String, required: true, trim: true },
  contactSnapshot: { type: Schema.Types.Mixed, default: {} },
  resolvedParameters: { type: Schema.Types.Mixed, default: {} },
  consentSnapshot: { type: Schema.Types.Mixed, default: {} },
  status: {
    type: String,
    enum: ['PENDING', 'QUEUED', 'SENDING', 'ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'RETRY_WAIT', 'FAILED', 'SKIPPED', 'CANCELLED'],
    default: 'PENDING', required: true,
  },
  attemptCount: { type: Number, default: 0, min: 0 },
  manualRetryCount: { type: Number, default: 0, min: 0 },
  retryBatchId: { type: String, trim: true, maxlength: 100 },
  retryEvaluationBatchId: { type: String, trim: true, maxlength: 100 },
  retryExclusionReason: { type: String, trim: true, maxlength: 80 },
  retrySafety: { type: String, enum: ['SAFE', 'PERMANENT', 'UNCERTAIN'] },
  failureSource: { type: String, enum: ['META_API', 'META_WEBHOOK', 'VALIDATION', 'WORKER', 'QUEUE'] },
  failureSubcode: Number,
  nextEligibleRetryAt: Date,
  attemptHistory: { type: [new Schema({ attempt: Number, at: Date, status: String, failureCode: String, failureSubcode: Number, failureTitle: String, failureMessage: String, failureSource: String, retrySafety: String, metaMessageId: String }, { _id: false })], default: [] },
  nextAttemptAt: Date,
  claimedAt: Date,
  leaseUntil: Date,
  workerId: { type: String, trim: true, maxlength: 120 },
  submissionState: { type: String, enum: ['NOT_SUBMITTED', 'SUBMITTING', 'ACCEPTED', 'UNCERTAIN'], default: 'NOT_SUBMITTED' },
  whatsappMessageId: { type: Schema.Types.ObjectId, ref: 'WhatsAppMessage' },
  metaMessageId: { type: String, trim: true },
  acceptedAt: Date,
  sentAt: Date,
  deliveredAt: Date,
  readAt: Date,
  failedAt: Date,
  failureCode: { type: String, trim: true, maxlength: 64 },
  failureTitle: { type: String, trim: true, maxlength: 300 },
  failureMessage: { type: String, trim: true, maxlength: 1000 },
}, { timestamps: true, collection: 'campaignrecipients' });

campaignRecipientSchema.index({ workspaceId: 1, campaignId: 1, recipientKey: 1 }, { unique: true });
campaignRecipientSchema.index({ workspaceId: 1, campaignId: 1, status: 1, _id: 1 });
campaignRecipientSchema.index({ workspaceId: 1, campaignId: 1, status: 1, retrySafety: 1, nextEligibleRetryAt: 1 });
campaignRecipientSchema.index({ workspaceId: 1, status: 1, nextAttemptAt: 1 });
campaignRecipientSchema.index({ workspaceId: 1, campaignId: 1, status: 1, leaseUntil: 1 });
campaignRecipientSchema.index({ workspaceId: 1, metaMessageId: 1 }, { sparse: true });

export type CampaignRecipientDocument = InferSchemaType<typeof campaignRecipientSchema>;
export const CampaignRecipient = (mongoose.models.CampaignRecipient as Model<CampaignRecipientDocument> | undefined) ?? mongoose.model<CampaignRecipientDocument>('CampaignRecipient', campaignRecipientSchema);
