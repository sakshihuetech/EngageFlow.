import mongoose from 'mongoose';
import { AppError } from '../../utils/app-error.js';

export function parseCursorPagination(input: { limit?: unknown; cursor?: unknown }, fallback = 25) {
  const limit = Math.min(Math.max(Number(input.limit) || fallback, 1), 100);
  if (input.cursor !== undefined && (typeof input.cursor !== 'string' || !mongoose.isValidObjectId(input.cursor))) {
    throw new AppError(400, 'INVALID_CURSOR', 'Invalid pagination cursor.');
  }
  return { limit, cursor: input.cursor as string | undefined };
}
