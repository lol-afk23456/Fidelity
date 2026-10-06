import { GoogleAuth } from 'google-auth-library';
import { publicBaseUrl, readServiceAccount, requireConfigured } from './config.js';
import { buildGoogleMessage, buildGooglePayloads, signGoogleSaveJwt } from './payloads.js';
import { WalletError, type WalletMember, type WalletProgram } from './types.js';

type JsonObject = Record<string, unknown>;
type GoogleRequest = (method: 'GET' | 'POST' | 'PATCH', resource: string, body?: JsonObject) => Promise<JsonObject>;

/** Avoid exposing Google's request objects, bearer tokens, or service-account content in errors. */
export function googleProviderError(error: unknown): WalletError {
  const response = (error as { response?: { status?: number } } | null)?.response;
  const status = response?.status;
  if (status === 400) return new WalletError('Google Wallet ha rifiutato i dati della tessera. Verificare programma, logo e impostazioni issuer.', 'GOOGLE_BAD_REQUEST', 502, false, status);
  if (status === 401 || status === 403) return new WalletError('Accesso Google Wallet rifiutato. Verificare API attiva, ruolo del service account, issuer e accesso alla pubblicazione nella console Google.', 'GOOGLE_ACCESS_DENIED', 502, false, status);
  if (status === 404) return new WalletError('Tessera o classe Google Wallet non trovata.', 'GOOGLE_NOT_FOUND', 502, false, status);
  if (status === 409) return new WalletError('La risorsa Google Wallet esiste già.', 'GOOGLE_CONFLICT', 502, false, status);
  if (status === 429) return new WalletError('Limite Google Wallet raggiunto. Riprovare in seguito; le notifiche hanno limiti per tessera.', 'GOOGLE_RATE_LIMIT', 503, true, status);
  return new WalletError('Google Wallet non è raggiungibile o ha restituito un errore. La consegna non è confermata.', 'GOOGLE_UNAVAILABLE', 503, true, status);
}

function googleRequest(): GoogleRequest {
  const account = readServiceAccount(process.env.GOOGLE_SERVICE_ACCOUNT_FILE);
  const auth = new GoogleAuth({ credentials: account, scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'] });
  return async (method, resource, body) => {
    try {
      const client = await auth.getClient();
      const response = await client.request<JsonObject>({
        url: `https://walletobjects.googleapis.com/walletobjects/v1/${resource}`,
        method,
        ...(body ? { data: body } : {}),
        timeout: 15_000,
        retry: false,
      });
      return response.data;
    } catch (error) { throw googleProviderError(error); }
  };
}

async function upsert(request: GoogleRequest, resource: string, body: JsonObject): Promise<void> {
  const id = encodeURIComponent(String(body.id));
  try {
    await request('GET', `${resource}/${id}`);
  } catch (error) {
    if (!(error instanceof WalletError) || error.providerStatus !== 404) throw error;
    try { await request('POST', resource, body); return; }
    catch (insertError) {
      // Another process may have inserted it between the GET and POST.
      if (!(insertError instanceof WalletError) || insertError.providerStatus !== 409) throw insertError;
    }
  }
  const patchBody={...body};
  // Only new classes request review; updating a live class must not reset its review state.
  if(resource.endsWith('Class'))delete patchBody.reviewStatus;
  await request('PATCH', `${resource}/${id}`, patchBody);
}

async function provision(member: WalletMember, program: WalletProgram, notify = false) {
  requireConfigured('google');
  const payloads = buildGooglePayloads(member, program, process.env.GOOGLE_ISSUER_ID!, publicBaseUrl());
  const request = googleRequest();
  await upsert(request, `${payloads.kind}Class`, payloads.classPayload);
  await upsert(request, `${payloads.kind}Object`, {
    ...payloads.objectPayload,
    // Loyalty balances support field notifications. Offers use the separate AddMessage endpoint.
    ...(notify && payloads.kind === 'loyalty' ? { notifyPreference: 'NOTIFY_ON_UPDATE' } : {}),
  });
  return payloads;
}

export async function googleSaveUrl(member: WalletMember, program: WalletProgram): Promise<string> {
  // Provision against the real API before returning any save link; a JWT alone is not proof of issuance.
  const payloads = await provision(member, program);
  const jwt = signGoogleSaveJwt(readServiceAccount(process.env.GOOGLE_SERVICE_ACCOUNT_FILE), payloads.objectPayload.id,
    payloads.kind, publicBaseUrl());
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

export async function updateGooglePass(member: WalletMember, program: WalletProgram, notify = false): Promise<void> {
  await provision(member, program, notify);
}

export async function sendGoogleMessage(member: WalletMember, program: WalletProgram, message: { id: string; title: string; body: string }): Promise<void> {
  requireConfigured('google');
  const body = buildGoogleMessage(message);
  const payloads = buildGooglePayloads(member, program, process.env.GOOGLE_ISSUER_ID!, publicBaseUrl());
  // No automatic retry here: a network timeout may follow a successful send. A retry could duplicate alerts.
  await googleRequest()('POST', `${payloads.kind}Object/${encodeURIComponent(payloads.objectPayload.id)}/addMessage`, body);
}
