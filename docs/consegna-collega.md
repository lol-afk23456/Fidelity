# Prompt per il collega — deploy e pilot cliente oggi

Aggiornato il **6 ottobre 2026**. Testo pronto da inoltrare. Il repository è privato: il collega deve avere accesso GitHub prima del clone.

---

Devi portare **Fidelity Studio online oggi, 6 ottobre 2026**, per consegnarlo gratuitamente a un primo cliente reale e provarlo con lui. **Il tuo incarico comprende configurare i servizi esterni, collegarli e fare il deploy** usando le risorse e gli accessi forniti dall'agenzia. Le precedenti indicazioni di rimandare account e pubblicazione sono superate. Il risultato richiesto è un indirizzo HTTPS funzionante, un'attività configurata sulle esigenze del cliente e un accesso Titolare dedicato.

Il progetto è separato da BigAnt Book e usa **Node.js 24**, React/Vite, Express e SQLite. Non usare l'ambiente Node 22 di BigAnt.

## 1. Clona e prepara il commit da distribuire

```sh
git clone https://github.com/lol-afk23456/Fidelity.git
cd Fidelity
nvm install
nvm use
npm ci
```

Se non usi nvm, installa Node.js 24 con il gestore disponibile. Registra il commit con `git rev-parse HEAD`.

Il software è già predisposto: **40 test superati**, build TypeScript/frontend/backend e percorso punti nel browser verificati; anche la pipeline e la build dell'immagine sono risultate verdi nella [verifica GitHub](https://github.com/lol-afk23456/Fidelity/actions/runs/37465874431). Controlla che l'evidenza riguardi il commit che distribuisci. Il funzionamento sul server e sui dispositivi reali resta da verificare.

Non ripetere la suite invariata per sole modifiche ai documenti. Per modifiche applicative esegui i test coinvolti; per un commit senza evidenza valida esegui:

```sh
npm test
npm run build
```

Per eventuali prove locali usa un database separato con soli dati fittizi. **Non eseguire `seed:demo` sull'installazione pubblica** e non pubblicare gli account dimostrativi.

## 2. Collega i servizi e pubblica

Raccogli dall'agenzia dominio, gestione DNS, hosting/server e accesso tecnico, email amministratore e destinazione dei backup. Hosting e dominio non sono ancora specificati nel repository: usa quelli concordati direttamente per il rilascio. La gratuità riguarda il pilot per il cliente, non garantisce gratuità di hosting e account esterni.

Segui i comandi verificati in [operations.md](operations.md), scegliendo Docker oppure Node.js 24:

1. Configura `.env`, `NODE_ENV=production`, `PUBLIC_BASE_URL` con il dominio HTTPS reale, reverse proxy e disco locale persistente. Usa una sola istanza applicativa/worker con SQLite.
2. Crea un **database nuovo**, distinto da qualsiasi demo. Crea l'amministratore con la procedura **bootstrap**, credenziali dedicate e password propria; rimuovi la password di bootstrap dalla configurazione al termine.
3. Costruisci e avvia la versione di produzione, collega DNS e HTTPS e verifica persistenza e riavvio. Non usare il server Vite per il rilascio.
4. Esegui un backup consistente, esportalo nella destinazione separata concordata e verifica un ripristino in un percorso nuovo e isolato, seguendo [operations.md](operations.md). Verifica accessi, programma e saldi recuperati. Pianifica e documenta i backup periodici.

Conserva `.env`, chiavi, certificati e database sul server con accessi protetti; non inserirli nel repository, nei log di consegna o in chat.

## 3. Configura Apple e Google Wallet

Gli account sono **entrambi ancora da creare**. Avvia i passaggi necessari con il referente dell'agenzia; la creazione degli account, le eventuali approvazioni e le prove reali non sono comprese nei test software già verdi e non se ne può promettere il completamento oggi.

- **Apple:** iscrizione all'Apple Developer Program nel percorso adatto all'agenzia e completamento delle verifiche richieste; recupera **Team ID**, crea il **Pass Type ID** e il relativo **certificato del pass**, conserva la **chiave privata corrispondente** e configura il **certificato intermedio WWDR**. Imposta `APPLE_TEAM_ID`, `APPLE_PASS_TYPE_ID`, `APPLE_SIGNER_CERT_PATH`, `APPLE_SIGNER_KEY_PATH` e `APPLE_WWDR_CERT_PATH`; se la chiave è cifrata, anche `APPLE_SIGNER_KEY_PASSPHRASE`. Dettagli in [wallet-setup.md](wallet-setup.md).
- **Google:** crea l'account **Google Wallet API Issuer**, un progetto **Google Cloud**, abilita **Google Wallet API**, crea un **service account** e aggiungilo come **Developer nell'issuer**. Custodisci la **chiave JSON** sul server e configura `GOOGLE_ISSUER_ID` e `GOOGLE_SERVICE_ACCOUNT_FILE`. Completa il profilo e la richiesta di **publishing access**. Prima dell'approvazione, la modalità demo permette prove solo con gli account di test autorizzati: un progetto Cloud da solo non concede accesso all'issuer.

In Docker, abilita il montaggio `./certs:/app/certs:ro` previsto in `docker-compose.yml` e usa nelle variabili i percorsi interni `/app/certs/...`. Consenti all'utente applicativo la lettura dei file senza renderli pubblici. Su altri ambienti usa percorsi protetti accessibili al processo. Riavvia l'applicazione dopo la configurazione e controlla **Impostazioni → Connessioni wallet** e la coda; lo stato «Configurato» non sostituisce la prova sul telefono.

Concorda il perimetro effettivo con agenzia e cliente:

- Il pilot iniziale con **carta web e QR** è tecnicamente supportato senza credenziali Wallet. Se lo accettano esplicitamente, consegnalo dopo il collaudo pubblico, indicando i Wallet ancora non attivi.
- Se **Apple Wallet e Google Wallet sono indispensabili dall'inizio**, completa account, configurazione e collaudi prima di dichiarare soddisfatta la consegna. Prepara comunque il deploy e segnala precisamente eventuali attese dei provider; non sostituire questo requisito con la sola carta web.

## 4. Configura l'attività del cliente

La configurazione si fa dal pannello: non esiste una generazione automatica da un brief.

1. Come agenzia, crea l'attività reale con nome, indirizzo e colore concordati.
2. Crea il programma richiesto: punti, timbri o coupon, logo, premio, soglia, conversione euro/punti ed eventuale scadenza. Fai verificare al cliente questi valori prima dell'apertura delle iscrizioni.
3. Inserisci informativa privacy pubblica e regolamento approvati dall'attività. **Non inventare testi legali o condizioni dei premi:** l'iscrizione in produzione richiede i documenti compilati e l'uso di dati reali richiede quelli effettivi dell'attività.
4. Crea un accesso **Titolare dedicato** e gli eventuali operatori al banco. Consegna le credenziali tramite canale sicuro; il cliente non deve usare l'account agenzia.
5. Prepara link e QR di iscrizione. Attiva campagne e automazioni secondo il perimetro concordato e i canali realmente configurati; senza Wallet attivi non promettere invii reali.

## 5. Collauda sul dominio reale prima della consegna

Usa un cliente di prova riconoscibile, poi rimuovilo o concordane la conservazione. Registra gli esiti senza allegare dati personali.

| Controllo | Esito richiesto |
| --- | --- |
| HTTPS e salute | Il dominio concordato e `/api/health` rispondono correttamente; nessun link rimanda a localhost. |
| Login e ruoli | Agenzia e Titolare accedono; il Titolare vede solo la propria attività. L'eventuale banco può accreditare e riscattare senza gestire utenti o programmi. |
| Iscrizione | Il link/QR apre il programma corretto da telefono; informativa e regolamento sono quelli approvati, il marketing resta facoltativo e la carta si apre. |
| Credito e riscatto | Con le regole del cliente, accredita un'operazione e riscatta il premio; verifica saldo e movimenti dal banco e dalla carta ricaricata. In un programma isolato, il caso di riferimento è 10 € × 1,5 punti/euro = 15 punti, riscatto da 10, saldo finale 5. Non modificare per questo le regole reali concordate. |
| Scanner | Prova la fotocamera sul dispositivo del banco, con HTTPS e permessi corretti; verifica anche il codice/link manuale. |
| Persistenza | Dopo il riavvio dell'applicazione, accessi, programma, saldo e movimenti rimangono disponibili. |
| Recupero | Backup esportato e ripristino su copia isolata verificati; frequenza, conservazione e referente documentati. |
| Wallet inclusi nella consegna | Su iPhone e Android reali verifica aggiunta, aggiornamento dopo credito/riscatto, sospensione/riattivazione e revoca. Per Google, verifica anche un account fuori dai tester dopo l'approvazione alla pubblicazione. Finché mancano account o prove, indica questa parte come pendente. |

Le campagne Apple aggiornano il contenuto del pass; gli avvisi Google dipendono dai limiti del provider. «Accettato dal provider» non dimostra la visualizzazione o lettura sul telefono. SMS, WhatsApp, email marketing, POS/NFC e operazioni offline non fanno parte di questo rilascio.

## 6. Consegna e prova insieme al cliente

Consegna URL HTTPS, link/QR d'iscrizione, accesso Titolare tramite canale sicuro e istruzioni brevi per iscrizione, accredito e riscatto. Esegui questi passaggi insieme al cliente sul dispositivo che userà, raccogli i difetti riproducibili e concorda il referente per l'assistenza durante il pilot gratuito.

Il report finale deve contenere **commit distribuito, URL reale, perimetro accettato dal cliente, esiti del collaudo pubblico, backup/ripristino e blocchi residui**. Distingui il software pubblicato dai Wallet eventualmente ancora da attivare. Non dichiarare il servizio consegnato se esiste soltanto un clone locale o una pipeline verde.

Riferimenti: [attivazione](attivazione-agenzia.md), [operazioni](operations.md), [stato verifiche](acceptance.md), [Wallet](wallet-setup.md).
