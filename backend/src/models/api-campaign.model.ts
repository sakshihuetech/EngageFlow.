import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const schema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
  status: { type: String, enum: ['DRAFT', 'LIVE', 'PAUSED', 'ARCHIVED'], default: 'DRAFT', required: true },
  whatsappAccountId: { type: Schema.Types.ObjectId, ref: 'WhatsAppAccount', required: true },
  whatsappPhoneNumberId: { type: Schema.Types.ObjectId, ref: 'WhatsAppPhoneNumber', required: true },
  phoneNumberId: { type: String, required: true, trim: true },
  templateId: { type: Schema.Types.ObjectId, ref: 'WhatsAppTemplate', required: true },
  templateSnapshot: { type: Schema.Types.Mixed, required: true },
  templateParameterSchema: { type: [Schema.Types.Mixed], default: [] },
  description: { type: String, trim: true, maxlength: 1000 },
  senderChangeHistory: { type: [new Schema({ at: { type: Date, required: true }, requestId: String, fromAccountId: Schema.Types.ObjectId, toAccountId: Schema.Types.ObjectId, fromPhoneNumberId: String, toPhoneNumberId: String, fromTemplateId: Schema.Types.ObjectId, toTemplateId: Schema.Types.ObjectId }, { _id: false })], default: [] },
  triggerCount: { type: Number, default: 0, min: 0 }, lastTriggeredAt: Date,
}, { timestamps: true, collection: 'apicampaigns' });
schema.index({ workspaceId: 1, slug: 1 }, { unique: true });
schema.index({ workspaceId: 1, status: 1, _id: -1 });
schema.index({ workspaceId: 1, _id: -1 });
schema.index({ workspaceId: 1, whatsappAccountId: 1, _id: -1 });
export type ApiCampaignDocument = InferSchemaType<typeof schema>;
export const ApiCampaign = (mongoose.models.ApiCampaign as Model<ApiCampaignDocument> | undefined) ?? mongoose.model<ApiCampaignDocument>('ApiCampaign', schema);
