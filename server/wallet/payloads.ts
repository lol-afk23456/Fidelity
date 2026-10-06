import { createHash, createPrivateKey, sign } from 'node:crypto';
import type { ServiceAccount } from './config.js';
import { WalletError, type WalletMember, type WalletProgram } from './types.js';

export function validateWalletData(member: WalletMember, program: WalletProgram): void {
  if (!member.id || !member.publicToken || !member.name || !program.id || !program.name || !program.tenantName ||
    !['stamps', 'points', 'coupon'].includes(program.type) ||
    !Number.isSafeInteger(member.balance) || member.balance < 0 ||
    !Number.isSafeInteger(member.rewardCount) || member.rewardCount < 0 ||
    !Number.isSafeInteger(program.rewardThreshold) || program.rewardThreshold < 1 ||
    !Number.isFinite(Date.parse(member.updatedAt)) ||
    (program.expiresAt !== undefined && !Number.isFinite(Date.parse(program.expiresAt)))) {
    throw new WalletError('Dati tessera non validi.', 'WALLET_INVALID_DATA', 422);
  }
  if ((program.locations?.length ?? 0) > 10 || program.locations?.some(location =>
    !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 ||
    !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180)) {
    throw new WalletError('Specificare fino a 10 coordinate geografiche valide.', 'WALLET_INVALID_DATA', 422);
  }
}

export function walletColor(color: string): string {
  if (/^#[a-f\d]{6}$/i.test(color)) return color;
  if (/^#[a-f\d]{3}$/i.test(color)) return `#${[...color.slice(1)].map(c => c + c).join('')}`;
  return '#174436';
}

export function googlePassIds(issuer: string, member: WalletMember, program: WalletProgram) {
  if (!/^\d+$/.test(issuer)) throw new WalletError('GOOGLE_ISSUER_ID non valido.', 'WALLET_CONFIGURATION');
  const suffix = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 40);
  return { classId: `${issuer}.program_${suffix(program.id)}`, objectId: `${issuer}.member_${suffix(`${program.id}:${member.id}`)}` };
}

export function buildGooglePayloads(member: WalletMember, program: WalletProgram, issuer: string, baseUrl: string) {
  validateWalletData(member, program);
  const { classId, objectId } = googlePassIds(issuer, member, program);
  const logo = program.logoUrl ?? `${baseUrl}/api/wallet/icon.png`;
  try {
    const url = new URL(logo);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
  } catch { throw new WalletError('Il logo Google Wallet deve avere un URL HTTPS pubblico.', 'WALLET_INVALID_DATA', 422); }
  const image = { sourceUri: { uri: logo }, contentDescription: { defaultValue: { language: 'it', value: program.tenantName } } };
  const cardUrl = `${baseUrl}/card/${encodeURIComponent(member.publicToken)}`;
  const classCommon = {
    id: classId,
    issuerName: program.tenantName,
    reviewStatus: 'UNDER_REVIEW',
    multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES',
    ...(program.locations?.length ? { merchantLocations: program.locations.map(({ latitude, longitude }) => ({ latitude, longitude })) } : {}),
  };
  const objectCommon = {
    id: objectId,
    classId,
    state: member.voided || (program.type === 'coupon' && member.balance === 0) ? 'INACTIVE' : 'ACTIVE',
    ...(program.expiresAt ? { validTimeInterval: { end: { date: new Date(program.expiresAt).toISOString() } } } : {}),
    barcode: { type: 'QR_CODE', value: member.publicToken },
    linksModuleData: { uris: [{ id: 'card', uri: cardUrl, description: 'Apri la tua tessera' }] },
    textModulesData: [
      { id: 'reward', header: 'Il tuo premio', body: program.rewardName },
      { id: 'details', header: 'Come funziona', body: program.description || program.name },
      { id: 'redeemed', header: 'Premi riscattati', body: String(member.rewardCount) },
      ...(member.offer ? [{ id: 'offer', header: 'Novità dal negozio', body: member.offer }] : []),
    ],
  };
  if (program.type === 'coupon') {
    return { kind: 'offer' as const, classPayload: { ...classCommon, title: program.name,
      provider: program.tenantName, redemptionChannel: 'INSTORE', titleImage: image,
      details: program.description || program.rewardName },
    objectPayload: { ...objectCommon } };
  }
  return { kind: 'loyalty' as const,
    classPayload: { ...classCommon, programName: program.name, programLogo: image,
      hexBackgroundColor: walletColor(program.color), accountNameLabel: 'Cliente', accountIdLabel: 'Tessera' },
    objectPayload: { ...objectCommon, accountId: member.id, accountName: member.name,
      loyaltyPoints: { label: program.type === 'stamps' ? 'Timbri' : 'Punti', balance: { int: member.balance } },
      secondaryLoyaltyPoints: { label: 'Premi disponibili', balance: { int: Math.floor(member.balance / program.rewardThreshold) } } } };
}

/** Sign references to server-created objects: the URL does not expose customer fields or secret keys. */
export function signGoogleSaveJwt(account: ServiceAccount, objectId: string, kind: 'loyalty' | 'offer', baseUrl: string, issuedAt = Math.floor(Date.now() / 1000)): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'RS256', typ: 'JWT', ...(account.private_key_id ? { kid: account.private_key_id } : {}) });
  const payload = encode({ iss: account.client_email, aud: 'google', typ: 'savetowallet', iat: issuedAt,
    origins: [new URL(baseUrl).origin], payload: { [kind === 'offer' ? 'offerObjects' : 'loyaltyObjects']: [{ id: objectId }] } });
  try {
    const input = `${header}.${payload}`;
    const key = createPrivateKey(account.private_key);
    if (key.asymmetricKeyType !== 'rsa') throw new Error();
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
  } catch { throw new WalletError('Impossibile firmare il link Google Wallet: verificare la chiave service account.', 'WALLET_CONFIGURATION'); }
}

export function buildGoogleMessage(message: { id: string; title: string; body: string }) {
  if (!message.id?.trim() || !message.title?.trim() || !message.body?.trim() ||
    message.title.length > 100 || message.body.length > 1000 || message.id.length > 200) {
    throw new WalletError('Messaggio Wallet non valido (titolo massimo 100 caratteri, testo 1000).', 'WALLET_INVALID_DATA', 422);
  }
  // Messages intentionally contain plain text only; never untrusted HTML/link markup.
  const plainText = (value: string) => value.replace(/[<>]/g, '');
  return { message: { id: message.id, header: plainText(message.title), body: plainText(message.body), messageType: 'TEXT_AND_NOTIFY' } };
}
