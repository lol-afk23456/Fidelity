# Fidelity Studio

Piattaforma di fidelizzazione proprietaria e self-hosted. Codice applicativo, database, programmi, dashboard, scanner e integrazioni Wallet sono in questo repository. Non utilizza un servizio loyalty o un intermediario Wallet white label.

## Avvio locale

Richiede **Node.js 24**. Il Node 12/14 eventualmente preinstallato non è compatibile. Il database SQLite viene creato automaticamente in `data/fidelity.sqlite`; il file contiene dati privati e non va pubblicato.

Repository dedicato: [lol-afk23456/Fidelity](https://github.com/lol-afk23456/Fidelity). Per il passaggio a un collega usa il [prompt di collaudo e attivazione](docs/consegna-collega.md). Il file `.nvmrc` seleziona Node 24 con `nvm install` e `nvm use`.

```sh
npm ci
cp .env.example .env
npm run seed:demo
npm run dev
```

In un secondo terminale:

```sh
npm run dev:client
```

Apri `http://localhost:5173`. Vite legge `PORT` da `.env` per raggiungere il server; cambia questa porta se occupata da un altro servizio. Dopo modifiche al backend, riavvia `npm run dev`. I dati demo sono sintetici e contrassegnati nell'interfaccia. Credenziali locali:

| Ruolo | Email | Password demo |
| --- | --- | --- |
| Agenzia | admin@fidelity.local | FidelityDemo!2026 |
| Negoziante | negozio@fidelity.local | FidelityDemo!2026 |
| Banco | banco@fidelity.local | FidelityDemo!2026 |

Il seed è esplicito, rifiuta un database già utilizzato e non può essere eseguito in produzione. Non distribuire un database dimostrativo a clienti reali.

## Funzioni

- Pannello agenzia e gestione di attività separate.
- Ruoli agenzia, titolare e personale al banco.
- Programmi a timbri, punti e coupon monouso, personalizzazione, scadenze e località.
- Iscrizione pubblica via QR/link, opt-in marketing separato, carta web privata tramite token casuale.
- Scanner web, accredito da quantità o spesa, riscatti atomici, storni, registro operazioni.
- Protezione da doppi invii attraverso chiavi di idempotenza persistenti.
- Segmenti clienti, campagne programmate, controllo del consenso prima della consegna.
- Integrazioni dirette Apple/Google, coda di aggiornamento, diagnostica e tentativi controllati.
- Export CSV, anonimizzazione locale, audit, backup e restore verificabili.

La tessera nel wallet è una rappresentazione del saldo. Il database è l'autorità per le operazioni. Una notifica accettata dal provider non prova che l'utente l'abbia visualizzata. Una campagna Apple aggiorna il contenuto del pass: non promette una push promozionale visibile.

## Produzione

```sh
npm run build
npm start
```

Il server serve API e interfaccia compilata sulla stessa porta (predefinita 3001). Configurare HTTPS su un dominio dell'agenzia e `PUBLIC_BASE_URL` con la sua origine esatta. Utilizzare un database nuovo e creare il primo amministratore con `npm run bootstrap`, impostando `FIDELITY_ADMIN_EMAIL`, `FIDELITY_ADMIN_PASSWORD` e opzionalmente `FIDELITY_ADMIN_NAME` nel proprio ambiente. La password deve avere almeno 12 caratteri e non viene stampata.

Per Docker, persistenza, backup, segreti, aggiornamenti e ripristino vedi [operazioni](docs/operations.md). SQLite è destinato a **una singola istanza applicativa con disco persistente locale**; non mettere il database su filesystem di rete e non eseguire repliche concorrenti del worker. La migrazione a un database distribuito va progettata quando necessaria.

## Wallet e configurazioni esterne

Account, infrastruttura e pubblicazione saranno configurati alla fine dello sviluppo. Il documento [dati per l’attivazione dell’agenzia](docs/attivazione-agenzia.md) raccoglie tutto ciò che occorrerà fornire, inclusi i due account ancora da creare.

I pulsanti di salvataggio diventano disponibili solo dopo la configurazione dei relativi account e certificati; nessuna risposta simulata viene presentata come carta realmente emessa. Leggi [configurazione Wallet](docs/wallet-setup.md). Servono account dell'agenzia, accesso alla pubblicazione Google, certificati Apple validi, dominio HTTPS raggiungibile e prove su iPhone/Android.

L'agenzia deve fornire identità del servizio, documenti privacy, termini dei programmi, tempi di conservazione e meccaniche dei premi approvate prima dell'utilizzo con clienti reali. Il software non può sostituire questi dati organizzativi. Le integrazioni specifiche con casse, NFC ai POS e riscatti offline richiedono requisiti e hardware del singolo esercente.

## Verifica

```sh
npm test
npm run typecheck
npm run build
```

[Contratto API](docs/api-contract.md) · [Architettura](docs/architecture.md) · [Stato delle verifiche](docs/acceptance.md)
