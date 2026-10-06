# Fidelity Studio API contract

All API responses are JSON except CSV and pkpass. Base `/api`. Errors `{error,code}`. Dates ISO UTC. IDs strings. Lists return `{items:[...]}`. No fake providers. JSON numbers are integer points, and integer cents for spend. SQLite persists all records.

## Sessions / tenant
GET `/health` => `{ok:true,demo:boolean}`.
POST `/auth/login` `{email,password}`; GET `/auth/me` => `{user:{id,name,email,role:'agency'|'owner'|'staff',tenantId:string|null},csrfToken:string}`.
POST `/auth/logout`. POST `/auth/password` `{currentPassword,newPassword}`.
Session cookie HttpOnly. Authenticated mutating requests header `X-CSRF-Token`; GET doesn't require it. Agency uses `X-Tenant-Id` for selected business; owner/staff always scoped to own business. Agency-only `/tenants` list/create/update. Login is Origin protected, no CSRF header. Public mutations also Origin protected.

## Businesses
GET `/tenants` => `{items:Tenant[]}` (agency all; owner/staff own).
POST `/tenants` `{name,slug,industry?,color?,address?}` => Tenant. PATCH `/tenants/:id` same optional fields incl active.
Tenant `{id,name,slug,industry,color,address,active:boolean,createdAt}`.

## Dashboard (tenant selected)
GET `/dashboard` => `{metrics:{members,activeMembers,credits,redemptions,programs,marketingMembers},activity:Transaction[],trend:Array<{date,credits,redemptions,registrations}>,programs:Program[]}`.
GET `/programs` => `{items:Program[]}`.
POST `/programs` `{name,type:'stamps'|'points'|'coupon',description,rewardThreshold,rewardName,color,pointsPerEuro?,expiresAt?,locations?:[{latitude,longitude,relevantText?}]}` => Program.
PATCH `/programs/:id` same optional fields + active. Type immutable; threshold can change only with no members. Other updates propagate wallet.
Program `{id,tenantId,name,type,description,rewardThreshold,rewardName,color,pointsPerEuro:number,active:boolean,expiresAt:string|null,memberCount:number,createdAt,locations:[],joinUrl:string}`.

## Customers
GET `/members?q=&programId=&segment=all|active|inactive|reward|marketing` => `{items:Member[]}`.
POST `/members` `{programId,name,email,phone?,marketingConsent:boolean}` => Member (owner/agency only).
GET `/members/:id` => `{member:Member,transactions:Transaction[]}`.
PATCH `/members/:id` `{name?,email?,phone?,marketingConsent?}` => Member (owner/agency).
DELETE `/members/:id` => `{ok:true}` anonymizes customer, revokes public token, disables wallet access, erases devices; accounting history retained pseudonymous.
GET `/members/export` CSV (owner/agency).
Member `{id,tenantId,programId,programName,programType,name,email,phone,marketingConsent,balance,totalEarned,rewardCount,availableRewards,status:'active'|'deleted',createdAt,updatedAt,lastVisitAt:string|null,cardUrl:string,publicToken:string}`. Operators with staff may view contacts only in their business, cannot export/delete/manage.
Transaction `{id,memberId,memberName,programName,type:'credit'|'redeem'|'reversal',amount,balanceAfter,note,actorName,createdAt,reversed:boolean,reversalOf:string|null}`. `amount` signed; redeem negative.

## Scanner / operations
POST `/scan` `{code}` (raw publicToken, member ID or full card URL) => `{member,transactions}`.
POST `/members/:id/transactions` `{type:'credit'|'redeem',amount?:number,spendCents?:number,note?:string,idempotencyKey:string}` => `{member,transaction}`. Credit stamps: integer amount 1..100; points: integer amount OR spendCents (server computes floor(spendCents*pointsPerEuro/100)), no both. Redeem: server deducts rewardThreshold (amount omitted), coupon starts at 1 on enrollment and may only redeem. Token retries same response; conflict if same key for different payload. No browser-generated balance.
POST `/transactions/:id/reverse` `{note:string,idempotencyKey:string}` => `{member,transaction}` owner/agency; one reversal max, never negative balance.
GET `/transactions` => `{items:Transaction[]}` most recent 200.

## Campaigns (owner/agency)
GET `/campaigns` => `{items:Campaign[]}`.
POST `/campaigns` `{name,title,body,segment:'all'|'active'|'inactive'|'reward',programId?:string,scheduledAt?:string}` => Campaign.
POST `/campaigns/:id/send` => `{campaign,recipients:number}` queues once; requires consent; draft->queued; schedule respected. No fake delivery with missing credentials. Sending means provider accepted, not proof user read.
GET `/campaigns/:id` => `{campaign,deliveries:Array<{id,memberName,channel:'google'|'apple',status:'pending'|'sent'|'blocked'|'failed',error:string|null}>}`.
Campaign `{id,name,title,body,segment,programId:string|null,status:'draft'|'scheduled'|'queued'|'complete',scheduledAt:string|null,createdAt,recipientCount,sentCount,failedCount,blockedCount}`.

## Settings
GET `/settings` => `{tenant:Tenant,wallet:{apple:{configured,missing:string[]},google:{configured,missing:string[]}},jobs:{pending,failed,blocked},publicBaseUrl:string,demo:boolean}`.
GET `/users` => `{items:User[]}`. POST `/users` `{name,email,password,role:'owner'|'staff'}` => User; PATCH `/users/:id` `{active?:boolean,name?:string,role?:'owner'|'staff'}`; owner/agency only. No password hashes. User includes active.
GET `/audit` => `{items:Array<{id,actorName,action,entityId,createdAt}>}` owner/agency.
POST `/jobs/retry` => `{requeued:number}` owner/agency for tenant blocked/failed jobs after configuration fixed.

## Public enrollment / card
GET `/public/join/:slug` => `{tenant:{name,slug,color,address},programs:Program[]}` only active.
POST `/public/join/:slug` `{programId,name,email,phone?,acceptTerms:true,marketingConsent:boolean}` => `{cardUrl:string,token:string}`. Explicit opt-in, rate limited; existing email enrollment does NOT reveal existing card token (409).
GET `/public/cards/:token` => `{member:{name,balance,rewardCount,availableRewards,status,createdAt},program:Program,tenant:{name,color,address},wallet:{apple:{configured},google:{configured}},marketingConsent:boolean,offer:string|null}`. Never expose contact info or ledger from bearer card.
PATCH `/public/cards/:token/consent` `{marketingConsent:boolean}` => `{ok:true}`.
GET `/public/cards/:token/apple` => signed pkpass or 503 configuration error.
GET `/public/cards/:token/google` => `{url:string}` Google signed save link or 503 config error.

## API details / UI expectations
Demo database created only by explicit `npm run seed:demo`, never implicit. Credentials admin@fidelity.local / FidelityDemo!2026 then demo banner visible. Production requires bootstrap via CLI and HTTPS; no default login.
All data screens refresh after mutation. Every active button does real work or has a clear disabled explanation. Display wallet missing credentials as unavailable; never invent success. Public program terms state reward, threshold, expiration; illustrative privacy text must be replaced with actual merchant policy before launch. The initial frontend should support all program types.

## Estensioni implementate
- `GET /public/join/:slug` include `demo:boolean` e `tenant.privacyUrl`/`tenant.termsText`. In produzione il server rifiuta le nuove iscrizioni finché questi documenti non sono configurati.
- `PATCH /settings/policies` `{privacyUrl,termsText}` riservato a titolare/agenzia.
- `POST /programs/:id/logo` `{dataUrl}` carica logo PNG/JPEG/WebP (512KiB, 2 milioni pixel), restituisce `{logoUrl}`. Program include `logoUrl:string|null`. `GET /branding/:programId.png` è pubblico e serve esclusivamente il logo sanitizzato.
- `GET /automations`, `POST /automations` `{name,title,body,inactiveDays,cooldownDays,programId?}`, `PATCH /automations/:id` `{active}`, `POST /automations/:id/run` => `{recipients}`. Campi delle regole: `id,name,title,body,inactiveDays,cooldownDays,programId,active,createdAt,lastRunAt`.
- Cancellazione membro: revoca asincrona Wallet e conservazione delle registrazioni Apple per massimo 7 giorni; ogni link pubblico precedente viene invalidato subito.
- I tentativi Google dall'esito incerto sono esclusi dalla riprova generica per evitare notifiche duplicate.
