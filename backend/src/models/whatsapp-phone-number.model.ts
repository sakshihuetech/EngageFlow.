import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const whatsAppPhoneNumberSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  whatsappAccountId: { type: Schema.Types.ObjectId, ref: 'WhatsAppAccount', required: true, index: true },
  phoneNumberId: { type: String, required: true, trim: true },
  displayPhoneNumber: String,
  verifiedName: String,
  qualityRating: String,
  registrationStatus: String,
  codeVerificationStatus: String,
  nameStatus: String,
  lastSyncedAt: Date,
}, { timestamps: true, collection: 'whatsappphonenumbers' });

whatsAppPhoneNumberSchema.index({ workspaceId: 1, phoneNumberId: 1 }, { unique: true });
whatsAppPhoneNumberSchema.index({ whatsappAccountId: 1, phoneNumberId: 1 }, { unique: true });

export type WhatsAppPhoneNumberDocument = InferSchemaType<typeof whatsAppPhoneNumberSchema>;
export const WhatsAppPhoneNumber = (mongoose.models.WhatsAppPhoneNumber as Model<WhatsAppPhoneNumberDocument> | undefined) ?? mongoose.model<WhatsAppPhoneNumberDocument>('WhatsAppPhoneNumber', whatsAppPhoneNumberSchema);
