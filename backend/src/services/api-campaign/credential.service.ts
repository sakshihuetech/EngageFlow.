import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiCredential } from '../../models/api-credential.model.js';
import { Workspace } from '../../models/workspace.model.js';
import { AppError } from '../../utils/app-error.js';

export const hashApiKey = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
export function safeHashEqual(left: string, right: string) { const a=Buffer.from(left,'hex'); const b=Buffer.from(right,'hex'); return a.length===b.length && a.length>0 && timingSafeEqual(a,b); }
export function generateApiKey() { const prefix=randomBytes(6).toString('hex'); const key=`oc_${prefix}_${randomBytes(32).toString('base64url')}`; return { key, prefix, secretHash: hashApiKey(key) }; }
export const parseApiKeyPrefix = (key: string) => key.match(/^oc_([a-f0-9]{12})_[A-Za-z0-9_-]{40,50}$/)?.[1];
export function serializeCredential(row: Record<string, any>) { return { id:String(row._id), label:row.label, prefix:row.keyPrefix, status:row.status, createdAt:row.createdAt, lastUsedAt:row.lastUsedAt, revokedAt:row.revokedAt }; }
export async function authenticateApiKey(authorization?: string) {
  const key=authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : ''; const prefix=parseApiKeyPrefix(key);
  if (!prefix) throw new AppError(401,'INVALID_API_KEY','Invalid API key.');
  const credential=await ApiCredential.findOne({keyPrefix:prefix,status:'ACTIVE'}).select('+secretHash');
  if (!credential || !safeHashEqual(hashApiKey(key), credential.secretHash)) throw new AppError(401,'INVALID_API_KEY','Invalid API key.');
  const workspace=await Workspace.findOne({_id:credential.workspaceId,status:'ACTIVE'});
  if (!workspace) throw new AppError(403,'WORKSPACE_UNAVAILABLE','API workspace is unavailable.');
  const cutoff=new Date(Date.now()-60_000); await ApiCredential.updateOne({_id:credential._id,status:'ACTIVE',$or:[{lastUsedAt:{$lt:cutoff}},{lastUsedAt:{$exists:false}}]},{$set:{lastUsedAt:new Date()}});
  return { credential, workspace };
}
