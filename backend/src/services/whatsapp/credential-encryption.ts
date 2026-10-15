import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/app-error.js';

export interface EncryptedCredential {
  iv: string;
  authTag: string;
  ciphertext: string;
}

function encryptionKey() {
  if (!env.ENCRYPTION_KEY) throw new AppError(503, 'CREDENTIAL_ENCRYPTION_NOT_CONFIGURED', 'Credential encryption is not configured.');
  return createHash('sha256').update(env.ENCRYPTION_KEY, 'utf8').digest();
}

export function decryptMetaCredential(value: EncryptedCredential) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new AppError(409, 'META_CREDENTIAL_DECRYPTION_FAILED', 'The Meta credential could not be read.');
  }
}

export function encryptMetaCredential(value: string): EncryptedCredential {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}
