# Verifiche e stato del rilascio

Aggiornato il 6 ottobre 2026, in preparazione della pubblicazione nel repository dedicato [lol-afk23456/Fidelity](https://github.com/lol-afk23456/Fidelity). I test usano dati isolati e provider simulati; le prove browser usano solo database dimostrativi. L'approccio è mirato: ripetere i controlli interessati da una modifica, senza rieseguire suite invariate. Prima della consegna è stata eseguita una verifica completa: **40 test superati su 40** e build riuscita.

| Area | Evidenza osservata |
| --- | --- |
| Accessi e operazioni | 15 casi superati in `test/api.test.ts`: Origin/CSRF, logout, ruoli, isolamento delle attività, idempotenza, doppio riscatto, coupon, punti da importo, storni, iscrizione, consensi, PATCH, anonimizzazione e autorizzazione Wallet. |
| Wallet | 10 casi in `test/wallet.test.ts`: firma RSA del link Google, payload, coupon, separazione dei segreti, input e configurazione, errori provider. Nessuna emissione reale dichiarata. |
| Loghi | 7 casi in `test/branding.test.ts`: decodifica reale, limiti byte/pixel, rifiuto SVG e contenuti falsificati, rimozione metadati, autorizzazione e persistenza. |
| Worker | 8 casi in `test/jobs.test.ts`: controllo del consenso, limite Google 3/24h, esiti incerti senza reinvio automatico, ripresa dopo riavvio, revoca e inattività con intervallo minimo. Aggiunto e superato un test mirato per cambio nome, sospensione e riattivazione dell’attività: aggiornamento delle carte emesse, campagne ferme durante la sospensione e isolamento delle altre attività. Ricontrollati anche consenso e automazioni su attività sospese. |
| Compilazione | TypeScript frontend/backend e `npm run build` superati. Scanner caricato separatamente. Dopo la correzione della sincronizzazione attività, ricompilato con successo il solo backend. |
| Installazione | Il 6 ottobre, installazione pulita dei soli file destinati al repository con npm 11 e lockfile v3 riuscita: 227 pacchetti, incluse le dipendenze native. |
| Browser | Login e dashboard desktop; iscrizione pubblica e carta con QR su viewport mobile 390px. Percorso timbri già verificato: accredito di 10 timbri, riscatto e saldo finale 0. Il 6 ottobre verificata la build compilata su database isolato: creazione programma punti dall’interfaccia, iscrizione mobile, ricerca al banco tramite link, 10 € × 1,5 punti/euro = 15 punti, riscatto da 10 punti, saldo finale 5 e un premio riscattato. Nessun errore JavaScript osservato e nessuno scorrimento orizzontale sulla carta mobile. |
| Backup/ripristino | SQLite con WAL aperto, schema 3: dati, logo BLOB, automazioni e documenti recuperati. Rifiuto sovrascrittura, file corrotti, database estranei, sidecar e versioni future. |

## Da verificare con risorse dell'agenzia

Su richiesta dell’agenzia, account e servizi esterni saranno configurati dopo lo sviluppo. I dati da raccogliere sono elencati in [attivazione-agenzia.md](attivazione-agenzia.md); i due account Wallet sono ancora da creare.

- Firma e installazione `.pkpass`, registrazione dispositivo, aggiornamento e revoca su iPhone con certificati reali.
- Emissione, salvataggio e aggiornamento Google Wallet con issuer autorizzato e service account.
- Scansione con la fotocamera sul telefono scelto per il banco. Il percorso manuale usa la stessa API di ricerca.
- Docker Engine non è disponibile in questo ambiente. La pipeline [GitHub Actions](https://github.com/lol-afk23456/Fidelity/actions) include la build dell’immagine: consultare l’esito associato al commit. L’esecuzione sul server scelto resta da verificare.
- Dominio HTTPS e server di proprietà dell'agenzia, backup esterno, informative e regolamenti dell'attività.

La revoca cambia subito il token pubblico e impedisce l'uso al banco. Un job aggiorna il pass remoto con dati anonimi e stato revocato. Le registrazioni Apple sono conservate per un massimo di sette giorni per permettere al dispositivo di ricevere l'aggiornamento. Il software non può rimuovere fisicamente una carta dal telefono dell'utente e non considera una notifica accettata come prova di lettura.

NFC, integrazioni con modelli specifici di casse e operazioni offline richiedono un progetto dedicato; non sono inclusi nel primo rilascio concordato.
