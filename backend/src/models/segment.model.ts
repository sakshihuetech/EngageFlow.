import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const conditionSchema = new Schema({
  field: { type: String, required: true, trim: true },
  operator: { type: String, required: true, trim: true },
  value: Schema.Types.Mixed,
}, { _id: false });

const segmentSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  type: { type: String, enum: ['STATIC', 'DYNAMIC'], default: 'DYNAMIC', required: true },
  definition: {
    match: { type: String, enum: ['ALL', 'ANY'], default: 'ALL' },
    conditions: { type: [conditionSchema], default: [] },
  },
  status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE', required: true },
  estimatedCount: { type: Number, default: 0, min: 0 },
}, { timestamps: true, collection: 'segments' });

segmentSchema.index({ workspaceId: 1, status: 1, _id: -1 });
segmentSchema.index({ workspaceId: 1, name: 1 }, { unique: true });

export type SegmentDocument = InferSchemaType<typeof segmentSchema>;
export const Segment = (mongoose.models.Segment as Model<SegmentDocument> | undefined) ?? mongoose.model<SegmentDocument>('Segment', segmentSchema);
