import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const whatsAppAccountSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  connectionId: { type: Schema.Types.ObjectId, ref: 'MetaConnection', required: true, index: true },
  wabaId: { type: String, required: true, trim: true },
  name: String,
  currency: String,
  timezone: String,
  status: { type: String, default: 'CONNECTED' },
}, { timestamps: true, collection: 'whatsappaccounts' });

whatsAppAccountSchema.index({ workspaceId: 1, wabaId: 1 }, { unique: true });
whatsAppAccountSchema.index({ connectionId: 1, wabaId: 1 }, { unique: true });

export type WhatsAppAccountDocument = InferSchemaType<typeof whatsAppAccountSchema>;
export const WhatsAppAccount = (mongoose.models.WhatsAppAccount as Model<WhatsAppAccountDocument> | undefined) ?? mongoose.model<WhatsAppAccountDocument>('WhatsAppAccount', whatsAppAccountSchema);
