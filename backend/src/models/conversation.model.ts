import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const conversationSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  whatsappAccountId: { type: Schema.Types.ObjectId, ref: 'WhatsAppAccount', required: true },
  whatsappPhoneNumberId: { type: Schema.Types.ObjectId, ref: 'WhatsAppPhoneNumber' },
  phoneNumberId: { type: String, required: true, trim: true },
  contactId: { type: Schema.Types.ObjectId, ref: 'Contact' },
  customerPhone: { type: String, required: true, trim: true },
  customerName: { type: String, trim: true, maxlength: 160 },
  status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN', required: true },
  lastInboundAt: Date,
  lastMessageAt: { type: Date, required: true, default: Date.now },
  lastMessagePreview: { type: String, trim: true, maxlength: 240, default: '' },
  unreadCount: { type: Number, default: 0, min: 0 },
  assignedTo: Schema.Types.ObjectId,
}, { timestamps: true, collection: 'conversations' });

conversationSchema.index({ workspaceId: 1, whatsappAccountId: 1, phoneNumberId: 1, customerPhone: 1 }, { unique: true });
conversationSchema.index({ workspaceId: 1, lastMessageAt: -1, _id: -1 });
conversationSchema.index({ workspaceId: 1, whatsappAccountId: 1, lastMessageAt: -1, _id: -1 });
conversationSchema.index({ workspaceId: 1, status: 1, lastMessageAt: -1 });

export type ConversationDocument = InferSchemaType<typeof conversationSchema>;
export const Conversation = (mongoose.models.Conversation as Model<ConversationDocument> | undefined) ?? mongoose.model<ConversationDocument>('Conversation', conversationSchema);
