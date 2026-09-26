import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { SESSION_ENCRYPTION_KEY } from './secrets';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

// SESSION_ENCRYPTION_KEY kann eine beliebig lange Passphrase sein — wir hashen sie
// einmal auf exakt 32 Byte runter, wie es aes-256-gcm als Key-Länge verlangt.
function getKey(): Buffer {
  if (!SESSION_ENCRYPTION_KEY) {
    throw new Error('NEXUS_SESSION_ENCRYPTION_KEY ist nicht gesetzt — Tokens können nicht verschlüsselt werden.');
  }
  return createHash('sha256').update(SESSION_ENCRYPTION_KEY).digest();
}

/** Verschlüsselt einen String für die Speicherung in der DB. Format: iv:authTag:ciphertext (alle base64). */
export function encrypt(plainText: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** Entschlüsselt einen mit encrypt() erzeugten String. */
export function decrypt(payload: string): string {
  const [ivB64, authTagB64, ciphertextB64] = payload.split(':');
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Ungültiges verschlüsseltes Token-Format.');
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plainText = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]);
  return plainText.toString('utf-8');
}
