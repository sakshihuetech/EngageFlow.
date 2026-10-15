import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const whatsAppMessageSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  whatsappAccountId: { type: Schema.Types.ObjectId, ref: 'WhatsAppAccount', required: true, index: true },
  phoneNumberId: { type: String, required: true, trim: true },
  conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', index: true },
  contactId: { type: Schema.Types.ObjectId, ref: 'Contact' },
  direction: { type: String, enum: ['INBOUND', 'OUTBOUND'], default: 'OUTBOUND', required: true },
  recipient: { type: String, required: true, trim: true },
  templateId: { type: Schema.Types.ObjectId, ref: 'WhatsAppTemplate', index: true },
  metaTemplateId: { type: String, trim: true },
  templateName: { type: String, trim: true },
  language: { type: String, trim: true },
  messageType: { type: String, enum: ['TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'LOCATION', 'CONTACTS', 'UNKNOWN'], default: 'TEXT' },
  text: { type: String, trim: true, maxlength: 4096 },
  mediaMetadata: Schema.Types.Mixed,
  contextMetaMessageId: { type: String, trim: true },
  metaMessageId: { type: String, required: true, trim: true },
  status: { type: String, enum: ['RECEIVED', 'ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'FAILED'], default: 'ACCEPTED', required: true, index: true },
  metaResponseStatus: { type: String, trim: true },
  sendSource: { type: String, enum: ['TEST', 'SINGLE', 'CAMPAIGN', 'API_CAMPAIGN', 'INBOX', 'BOT'], default: 'TEST', required: true, index: true },
  campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign' },
  campaignRecipientId: { type: Schema.Types.ObjectId, ref: 'CampaignRecipient' },
  retryRecipientId: { type: Schema.Types.ObjectId, ref: 'CampaignRecipient' },
  apiCampaignExecutionId: { type: Schema.Types.ObjectId, ref: 'ApiCampaignExecution' },
  apiCampaignRetryExecutionId: { type: Schema.Types.ObjectId, ref: 'ApiCampaignExecution' },
  apiCampaignRetrySequence: { type: Number, min: 1 },
  bodyVariableCount: { type: Number, default: 0 },
  headerType: { type: String, enum: ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'], default: 'NONE' },
  mediaReferenceType: { type: String, enum: ['LINK', 'ID'] },
  receivedAt: Date,
  acceptedAt: Date,
  sentAt: Date,
  deliveredAt: Date,
  readAt: Date,
  failedAt: Date,
  failureCode: { type: String, trim: true },
  failureSubcode: Number,
  failureTitle: { type: String, trim: true },
  failureMessage: { type: String, trim: true },
}, { timestamps: true, collection: 'whatsappmessages' });

whatsAppMessageSchema.index({ workspaceId: 1, whatsappAccountId: 1, createdAt: -1 });
whatsAppMessageSchema.index({ metaMessageId: 1 }, { unique: true });
whatsAppMessageSchema.index({ workspaceId: 1, campaignId: 1, createdAt: -1 }, { sparse: true });
whatsAppMessageSchema.index({ workspaceId: 1, campaignRecipientId: 1 }, { unique: true, sparse: true });
whatsAppMessageSchema.index({ workspaceId: 1, retryRecipientId: 1, createdAt: -1 }, { sparse: true });
whatsAppMessageSchema.index({ workspaceId: 1, apiCampaignExecutionId: 1 }, { unique: true, sparse: true });
whatsAppMessageSchema.index({ workspaceId: 1, conversationId: 1, createdAt: -1 });

export type WhatsAppMessageDocument = InferSchemaType<typeof whatsAppMessageSchema>;
export const WhatsAppMessage = (mongoose.models.WhatsAppMessage as Model<WhatsAppMessageDocument> | undefined) ?? mongoose.model<WhatsAppMessageDocument>('WhatsAppMessage', whatsAppMessageSchema);
