import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const encryptedTokenSchema = new Schema({
  iv: { type: String, required: true, select: false },
  authTag: { type: String, required: true, select: false },
  ciphertext: { type: String, required: true, select: false },
}, { _id: false });

const metaCredentialSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  connectionId: { type: Schema.Types.ObjectId, ref: 'MetaConnection', required: true, unique: true },
  encryptedAccessToken: { type: encryptedTokenSchema, required: true },
  tokenType: { type: String, default: 'bearer' },
  expiresAt: Date,
  scopes: [{ type: String }],
}, { timestamps: true, collection: 'metacredentials' });

metaCredentialSchema.index({ workspaceId: 1, connectionId: 1 }, { unique: true });

export type MetaCredentialDocument = InferSchemaType<typeof metaCredentialSchema>;
export const MetaCredential = (mongoose.models.MetaCredential as Model<MetaCredentialDocument> | undefined) ?? mongoose.model<MetaCredentialDocument>('MetaCredential', metaCredentialSchema);
