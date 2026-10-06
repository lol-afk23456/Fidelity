import { readFileSync } from 'node:fs';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { WalletError, type WalletStatus } from './types.js';

export type ServiceAccount = { client_email: string; private_key: string; private_key_id?: string };

export function publicBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  try {
    const value = new URL(env.PUBLIC_BASE_URL ?? '');
    if (value.protocol !== 'https:' || value.username || value.password || value.search || value.hash ||
      ['localhost', '127.0.0.1', '[::1]'].includes(value.hostname) || value.pathname !== '/') throw new Error();
    return value.origin;
  } catch {
    throw new WalletError('PUBLIC_BASE_URL deve essere un dominio HTTPS pubblico, senza percorso.', 'WALLET_CONFIGURATION');
  }
}

export function readServiceAccount(path: string | undefined): ServiceAccount {
  try {
    if (!path) throw new Error();
    const account: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!account || typeof account !== 'object') throw new Error();
    const value = account as Record<string, unknown>;
    if (value.type !== 'service_account' || typeof value.client_email !== 'string' ||
      !value.client_email.endsWith('.iam.gserviceaccount.com') || typeof value.private_key !== 'string') throw new Error();
    if (createPrivateKey(value.private_key).asymmetricKeyType !== 'rsa') throw new Error();
    return { client_email: value.client_email, private_key: value.private_key,
      ...(typeof value.private_key_id === 'string' ? { private_key_id: value.private_key_id } : {}) };
  } catch {
    // Never attach the underlying error: authentication errors can contain credentials.
    throw new WalletError('Credenziali service account Google mancanti o non valide.', 'WALLET_CONFIGURATION');
  }
}

export function appleCertificates(env: NodeJS.ProcessEnv = process.env) {
  try {
    const signerCert = readFileSync(env.APPLE_SIGNER_CERT_PATH ?? '');
    const signerKey = readFileSync(env.APPLE_SIGNER_KEY_PATH ?? '');
    const wwdr = readFileSync(env.APPLE_WWDR_CERT_PATH ?? '');
    const cert = new X509Certificate(signerCert);
    const intermediate = new X509Certificate(wwdr);
    const key = createPrivateKey({ key: signerKey, passphrase: env.APPLE_SIGNER_KEY_PASSPHRASE });
    if (!cert.checkPrivateKey(key) || Date.parse(cert.validTo) < Date.now() ||
      Date.parse(cert.validFrom) > Date.now() || Date.parse(intermediate.validTo) < Date.now()) throw new Error();
    if (!env.APPLE_PASS_TYPE_ID || !cert.subject.includes(env.APPLE_PASS_TYPE_ID) ||
      !env.APPLE_TEAM_ID || !cert.subject.includes(env.APPLE_TEAM_ID)) throw new Error();
    return { signerCert: Buffer.from(cert.toString()), signerKey, wwdr: Buffer.from(intermediate.toString()),
      ...(env.APPLE_SIGNER_KEY_PASSPHRASE ? { signerKeyPassphrase: env.APPLE_SIGNER_KEY_PASSPHRASE } : {}) };
  } catch {
    throw new WalletError('Certificati Apple mancanti, scaduti o non coerenti con chiave, team e Pass Type ID.', 'WALLET_CONFIGURATION');
  }
}

export function getWalletStatus(env: NodeJS.ProcessEnv = process.env): WalletStatus {
  const common: string[] = [];
  try { publicBaseUrl(env); } catch { common.push('PUBLIC_BASE_URL (HTTPS pubblico)'); }
  const apple = [...common];
  for (const name of ['APPLE_PASS_TYPE_ID', 'APPLE_TEAM_ID', 'APPLE_SIGNER_CERT_PATH', 'APPLE_SIGNER_KEY_PATH', 'APPLE_WWDR_CERT_PATH']) {
    if (!env[name]?.trim()) apple.push(name);
  }
  if (apple.length === common.length) {
    try { appleCertificates(env); } catch { apple.push('Certificati Apple validi e chiave corrispondente'); }
  }
  const google = [...common];
  if (!/^\d+$/.test(env.GOOGLE_ISSUER_ID ?? '')) google.push('GOOGLE_ISSUER_ID');
  try { readServiceAccount(env.GOOGLE_SERVICE_ACCOUNT_FILE); } catch { google.push('GOOGLE_SERVICE_ACCOUNT_FILE (JSON valido)'); }
  return { apple: { configured: apple.length === 0, missing: apple }, google: { configured: google.length === 0, missing: google } };
}

export function requireConfigured(provider: 'apple' | 'google'): void {
  const status = getWalletStatus()[provider];
  if (!status.configured) throw new WalletError(`${provider === 'apple' ? 'Apple' : 'Google'} Wallet non configurato: ${status.missing.join(', ')}.`, 'WALLET_CONFIGURATION');
}
