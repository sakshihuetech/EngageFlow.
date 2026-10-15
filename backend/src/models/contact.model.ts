import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const consentSchema = new Schema({
  status: { type: String, enum: ['OPTED_IN', 'OPTED_OUT', 'UNKNOWN'], default: 'UNKNOWN', required: true },
  timestamp: Date,
  source: { type: String, trim: true, maxlength: 120 },
  evidence: { type: String, trim: true, maxlength: 500 },
  accountId: { type: Schema.Types.ObjectId, ref: 'WhatsAppAccount' },
}, { _id: false });

const contactSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  phoneE164: { type: String, required: true, trim: true },
  email: { type: String, trim: true, lowercase: true, maxlength: 254 },
  tags: [{ type: String, trim: true, maxlength: 80 }],
  attributes: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['ACTIVE', 'BLOCKED', 'DELETED'], default: 'ACTIVE', required: true },
  source: { type: String, trim: true, maxlength: 120, default: 'MANUAL' },
  whatsappConsent: { type: consentSchema, default: () => ({ status: 'UNKNOWN' }) },
  optedOutAt: Date,
}, { timestamps: true, collection: 'contacts' });

contactSchema.index({ workspaceId: 1, phoneE164: 1 }, { unique: true });
contactSchema.index({ workspaceId: 1, status: 1, _id: -1 });
contactSchema.index({ workspaceId: 1, tags: 1, _id: -1 });

export type ContactDocument = InferSchemaType<typeof contactSchema>;
export const Contact = (mongoose.models.Contact as Model<ContactDocument> | undefined) ?? mongoose.model<ContactDocument>('Contact', contactSchema);
