import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const metaConnectionSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  provider: { type: String, enum: ['meta'], default: 'meta', required: true },
  metaBusinessId: { type: String, trim: true },
  businessName: { type: String, trim: true },
  status: { type: String, enum: ['PENDING', 'CONNECTED', 'REQUIRES_ACTION', 'ERROR', 'DISCONNECTED'], default: 'PENDING', index: true },
  onboardingMode: { type: String, enum: ['STANDARD', 'COEXISTENCE'], default: 'STANDARD' },
  webhookSubscribed: { type: Boolean, default: false },
  connectedAt: Date,
  lastSyncedAt: Date,
  lastError: { type: String, select: false },
}, { timestamps: true, collection: 'metaconnections' });

metaConnectionSchema.index({ workspaceId: 1, provider: 1 }, { unique: true });

export type MetaConnectionDocument = InferSchemaType<typeof metaConnectionSchema>;
export const MetaConnection = (mongoose.models.MetaConnection as Model<MetaConnectionDocument> | undefined) ?? mongoose.model<MetaConnectionDocument>('MetaConnection', metaConnectionSchema);
