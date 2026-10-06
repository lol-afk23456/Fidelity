import { connect } from 'node:http2';
import { PKPass } from 'passkit-generator';
import sharp from 'sharp';
import { appleCertificates, publicBaseUrl, requireConfigured } from './config.js';
import { walletIconPng } from './icon.js';
import { validateWalletData, walletColor } from './payloads.js';
import { WalletError, type WalletMember, type WalletProgram } from './types.js';

export function buildAppleDefinition(member: WalletMember, program: WalletProgram,
  config: { baseUrl: string; passTypeId: string; teamId: string }) {
  validateWalletData(member, program);
  if (member.appleAuthToken.length < 16 || !config.passTypeId.startsWith('pass.') || !config.teamId) {
    throw new WalletError('Identificativi o token Apple Wallet non validi.', 'WALLET_INVALID_DATA', 422);
  }
  const rgb = walletColor(program.color).slice(1).match(/../g)!.map(v => Number.parseInt(v, 16));
  const isLight = rgb[0]! * 0.299 + rgb[1]! * 0.587 + rgb[2]! * 0.114 > 160;
  const fields = {
    headerFields: [{ key: 'balance', label: program.type === 'coupon' ? 'STATO' : program.type === 'stamps' ? 'TIMBRI' : 'PUNTI',
      value: program.type === 'coupon' ? (member.balance > 0 ? 'Disponibile' : 'Utilizzato') : `${member.balance} / ${program.rewardThreshold}` }],
    primaryFields: [{ key: 'program', label: program.tenantName, value: program.name }],
    secondaryFields: [{ key: 'name', label: 'CLIENTE', value: member.name },
      { key: 'rewards', label: 'PREMI DISPONIBILI', value: program.type === 'coupon' ? member.balance : Math.floor(member.balance / program.rewardThreshold) }],
    auxiliaryFields: [{ key: 'reward', label: 'IL TUO PREMIO', value: program.rewardName }],
    backFields: [
      { key: 'description', label: 'Come funziona', value: program.description || program.name },
      { key: 'web', label: 'La tua tessera', value: `${config.baseUrl}/card/${encodeURIComponent(member.publicToken)}` },
      { key: 'updated', label: 'Ultimo aggiornamento', value: new Date(member.updatedAt).toISOString() },
      { key: 'redeemed', label: 'Premi riscattati', value: member.rewardCount },
      // Marketing content can appear on the pass but never abuses changeMessage for push campaigns.
      ...(member.offer ? [{ key: 'offer', label: 'Novità dal negozio', value: member.offer }] : []),
    ],
  };
  return {
    formatVersion: 1,
    passTypeIdentifier: config.passTypeId,
    teamIdentifier: config.teamId,
    serialNumber: member.id,
    organizationName: program.tenantName,
    description: program.name,
    logoText: program.tenantName,
    backgroundColor: `rgb(${rgb.join(', ')})`,
    foregroundColor: isLight ? 'rgb(23, 35, 30)' : 'rgb(255, 255, 255)',
    labelColor: isLight ? 'rgb(40, 55, 46)' : 'rgb(231, 239, 228)',
    authenticationToken: member.appleAuthToken,
    webServiceURL: `${config.baseUrl}/api/wallet/apple`,
    sharingProhibited: true,
    barcodes: [{ format: 'PKBarcodeFormatQR', message: member.publicToken, messageEncoding: 'utf-8' }],
    [program.type === 'coupon' ? 'coupon' : 'storeCard']: fields,
    ...(member.voided || (program.type === 'coupon' && member.balance === 0) ? { voided: true } : {}),
    ...(program.expiresAt ? { expirationDate: new Date(program.expiresAt).toISOString() } : {}),
    ...(program.locations?.length ? { locations: program.locations } : {}),
  };
}

export async function buildApplePass(member: WalletMember, program: WalletProgram): Promise<Buffer> {
  requireConfigured('apple');
  const definition = buildAppleDefinition(member, program, { baseUrl: publicBaseUrl(),
    passTypeId: process.env.APPLE_PASS_TYPE_ID!, teamId: process.env.APPLE_TEAM_ID! });
  try {
    const logos: Record<string, Buffer> = program.logoPng ? {
      'logo.png': await sharp(program.logoPng, { limitInputPixels: 2_000_000, failOn: 'warning' })
        .resize(160, 50, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(),
      'logo@2x.png': program.logoPng,
    } : {};
    const pass = new PKPass({
      'pass.json': Buffer.from(JSON.stringify(definition)),
      'icon.png': walletIconPng(29),
      'icon@2x.png': walletIconPng(58),
      'icon@3x.png': walletIconPng(87),
      ...logos,
    }, appleCertificates());
    return pass.getAsBuffer();
  } catch (error) {
    if (error instanceof WalletError) throw error;
    throw new WalletError('Impossibile firmare la tessera Apple. Verificare certificati e formato del programma.', 'APPLE_SIGNING_FAILED');
  }
}

export class ApplePushError extends WalletError {
  constructor(public readonly invalidTokens: string[], public readonly failedCount: number, retryable: boolean) {
    super(`APNs non ha confermato ${failedCount} aggiornamenti. La tessera resta aggiornata nel database.`, 'APPLE_PUSH_FAILED', 503, retryable);
  }
}

type PushOutcome = 'accepted' | 'invalid';

function pushOnce(token: string, certificates: ReturnType<typeof appleCertificates>): Promise<PushOutcome> {
  return new Promise((resolve, reject) => {
    const session = connect('https://api.push.apple.com', {
      cert: Buffer.concat([certificates.signerCert, Buffer.from('\n'), certificates.wwdr]),
      key: certificates.signerKey,
      passphrase: certificates.signerKeyPassphrase,
    });
    let finished = false;
    const timeout = setTimeout(() => finish(new WalletError('Timeout APNs.', 'APPLE_PUSH_TIMEOUT', 503, true)), 12_000);
    const finish = (error?: WalletError, outcome: PushOutcome = 'accepted') => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      session.destroy();
      if (error) reject(error); else resolve(outcome);
    };
    session.once('error', () => finish(new WalletError('Connessione APNs non riuscita.', 'APPLE_PUSH_CONNECTION', 503, true)));
    const stream = session.request({
      ':method': 'POST', ':path': `/3/device/${token}`,
      'apns-topic': process.env.APPLE_PASS_TYPE_ID!,
      'apns-push-type': 'background', 'apns-priority': '5', 'apns-expiration': '0',
      'content-type': 'application/json',
    });
    let status = 0;
    let body = '';
    stream.on('response', headers => { status = Number(headers[':status']); });
    stream.setEncoding('utf8');
    stream.on('data', (data: string) => { if (body.length < 4096) body += data; });
    stream.once('error', () => finish(new WalletError('Invio APNs interrotto.', 'APPLE_PUSH_CONNECTION', 503, true)));
    stream.once('end', () => {
      if (status === 200) return finish();
      let reason = '';
      try { reason = String((JSON.parse(body) as { reason?: string }).reason ?? ''); } catch { /* No raw provider output in errors. */ }
      if (status === 410 || (status === 400 && reason === 'BadDeviceToken')) return finish(undefined, 'invalid');
      finish(new WalletError('APNs ha rifiutato l’aggiornamento.', 'APPLE_PUSH_REJECTED', 503, status === 429 || status >= 500, status));
    });
    // Wallet's update protocol requires an empty dictionary, not an aps/alert payload.
    stream.end('{}');
  });
}

export async function notifyAppleDevices(tokens: string[]): Promise<{ invalidTokens: string[] }> {
  if (tokens.length === 0) return { invalidTokens: [] };
  requireConfigured('apple');
  const certificates = appleCertificates();
  const invalidTokens: string[] = [];
  let failedCount = 0;
  let retryable = false;
  const unique = [...new Set(tokens)];
  for (let start = 0; start < unique.length; start += 4) {
    await Promise.all(unique.slice(start, start + 4).map(async token => {
      if (!/^[a-f\d]{32,512}$/i.test(token)) { invalidTokens.push(token); return; }
      try {
        let outcome: PushOutcome;
        try { outcome = await pushOnce(token, certificates); }
        catch (error) {
          if (!(error instanceof WalletError) || !error.retryable) throw error;
          await new Promise(resolve => setTimeout(resolve, 250));
          outcome = await pushOnce(token, certificates);
        }
        if (outcome === 'invalid') invalidTokens.push(token);
      } catch (error) {
        failedCount++;
        retryable ||= error instanceof WalletError && error.retryable;
      }
    }));
  }
  if (failedCount) throw new ApplePushError(invalidTokens, failedCount, retryable);
  return { invalidTokens };
}
