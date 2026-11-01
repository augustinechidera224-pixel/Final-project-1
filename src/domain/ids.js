import { randomBytes, randomUUID } from 'node:crypto';

// No 0/O or 1/I, so a code read out loud at the door is hard to get wrong.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 characters

export function newId() {
  return randomUUID();
}

export function newReference() {
  // The alphabet has 32 characters, so reducing a byte modulo 32 is unbiased.
  const bytes = randomBytes(8);
  let code = '';
  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}
