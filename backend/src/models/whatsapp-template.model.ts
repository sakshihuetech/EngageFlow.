import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const whatsAppTemplateSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  whatsappAccountId: { type: Schema.Types.ObjectId, ref: 'WhatsAppAccount', required: true, index: true },
  metaTemplateId: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  language: { type: String, required: true, trim: true },
  category: { type: String, required: true, enum: ['MARKETING', 'UTILITY', 'AUTHENTICATION'] },
  status: { type: String, required: true, trim: true },
  components: { type: [Schema.Types.Mixed], default: [] },
  source: { type: String, enum: ['CUSTOM', 'META_LIBRARY'], default: 'CUSTOM', index: true },
  libraryTemplateName: { type: String, trim: true },
  rejectionReason: String,
  isActive: { type: Boolean, default: true, index: true },
  deletedAt: Date,
  deleteSource: { type: String, enum: ['USER'] },
  lastSyncedAt: { type: Date, required: true },
}, { timestamps: true, collection: 'whatsapptemplates' });

whatsAppTemplateSchema.index({ workspaceId: 1, whatsappAccountId: 1, metaTemplateId: 1 }, { unique: true });
whatsAppTemplateSchema.index({ workspaceId: 1, whatsappAccountId: 1, status: 1 });

export type WhatsAppTemplateDocument = InferSchemaType<typeof whatsAppTemplateSchema>;
export const WhatsAppTemplate = (mongoose.models.WhatsAppTemplate as Model<WhatsAppTemplateDocument> | undefined) ?? mongoose.model<WhatsAppTemplateDocument>('WhatsAppTemplate', whatsAppTemplateSchema);
