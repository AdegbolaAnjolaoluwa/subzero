import CryptoJS from 'crypto-js';

const KEY = process.env.ENCRYPTION_KEY || 'fallback_key_change_in_production!!';

export function encryptToken(token) {
  if (!token) return null;
  return CryptoJS.AES.encrypt(token, KEY).toString();
}

export function decryptToken(encrypted) {
  if (!encrypted) return null;
  const bytes = CryptoJS.AES.decrypt(encrypted, KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}
