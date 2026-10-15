import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';
const schema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  label: { type: String, required: true, trim: true, maxlength: 120 },
  keyPrefix: { type: String, required: true, unique: true, trim: true },
  secretHash: { type: String, required: true, select: false },
  status: { type: String, enum: ['ACTIVE', 'REVOKED'], default: 'ACTIVE', required: true },
  lastUsedAt: Date, revokedAt: Date,
}, { timestamps: true, collection: 'apicredentials' });
schema.index({ workspaceId: 1, _id: -1 });
schema.index({ workspaceId: 1, status: 1, _id: -1 });
export type ApiCredentialDocument = InferSchemaType<typeof schema>;
export const ApiCredential = (mongoose.models.ApiCredential as Model<ApiCredentialDocument> | undefined) ?? mongoose.model<ApiCredentialDocument>('ApiCredential', schema);
