import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const workspaceSchema = new Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
}, { timestamps: true, collection: 'workspaces' });

export type WorkspaceDocument = InferSchemaType<typeof workspaceSchema>;
export const Workspace = (mongoose.models.Workspace as Model<WorkspaceDocument> | undefined) ?? mongoose.model<WorkspaceDocument>('Workspace', workspaceSchema);
