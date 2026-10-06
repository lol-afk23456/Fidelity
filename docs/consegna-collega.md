# Prompt per il collega — collaudo e attivazione Fidelity

Puoi inoltrare il testo seguente. Il repository è privato: il collega deve avere accesso GitHub prima del clone.

---

Devi collaudare **Fidelity Studio**, la piattaforma proprietaria dell’agenzia per carte fedeltà. Il progetto è separato da BigAnt Book e usa Node.js 24, React/Vite, Express e SQLite. Non integrare il codice nel repository BigAnt e non usare il suo ambiente Node 22.

Repository: **https://github.com/lol-afk23456/Fidelity**

## 1. Clona e prepara l’ambiente locale

Da un terminale, con accesso al repository privato:

```sh
git clone https://github.com/lol-afk23456/Fidelity.git
cd Fidelity
```

Usa **Node.js 24 con npm aggiornato**. Se utilizzi nvm:

```sh
nvm install
nvm use
```

Su questo clone nuovo:

```sh
npm ci
cp .env.example .env
```

Nel file `.env` imposta questi valori per la prova locale; lascia vuote le credenziali Wallet:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3137
PUBLIC_BASE_URL=http://localhost:5173
DATABASE_PATH=./data/fidelity.sqlite
```

La porta API 3137 evita la porta 3001, spesso già utilizzata da BigAnt. Se scegli un’altra porta, Vite la legge da `.env`; riavvia entrambi i processi dopo la modifica. Apri il frontend esattamente su `http://localhost:5173`, coerente con `PUBLIC_BASE_URL`.

```sh
npm run seed:demo
npm run dev
```

In un secondo terminale, nella stessa cartella e con Node 24:

```sh
npm run dev:client
```

Apri **http://localhost:5173**. Il seed si esegue una sola volta su un database vuoto e rifiuta di sovrascrivere dati esistenti. Non cancellare un database usato per risolvere un errore di seed.

| Ruolo | Email demo | Password demo |
| --- | --- | --- |
| Agenzia | `admin@fidelity.local` | `FidelityDemo!2026` |
| Titolare | `negozio@fidelity.local` | `FidelityDemo!2026` |
| Personale al banco | `banco@fidelity.local` | `FidelityDemo!2026` |

Usa solo dati fittizi, per esempio indirizzi `@example.test`.

## 2. Verifica il software con controlli mirati

Esegui una volta:

```sh
npm test
npm run build
```

La build comprende già i controlli TypeScript. La suite corrente contiene 40 test su API, isolamento tra attività, autorizzazioni, punti/timbri/coupon, riscatti, consensi, loghi, coda e payload Wallet. Questi test non inviano carte o notifiche reali.

Se trovi un difetto, correggilo e ripeti prima il test del flusso coinvolto. Evita di rieseguire tutta la suite dopo semplici modifiche ai documenti. Segnala errori, warning e limiti separatamente; una build riuscita non prova il funzionamento sui telefoni.

Prova questi percorsi nell’interfaccia:

| Percorso | Azioni e risultato atteso |
| --- | --- |
| Carta punti | Da Programmi fedeltà crea un programma Punti: **1,5 punti/euro**, premio a **10 punti**. Iscrivi un cliente di prova dal link pubblico. Nello Scanner incolla il link della sua carta e accredita **10 €** tramite il metodo «Importo della spesa»: il saldo deve diventare **15 punti**. Riscatta il premio: saldo **5 punti**, un premio riscattato. Ricarica la carta pubblica e verifica il saldo. |
| Carta timbri | Crea una carta con soglia 10; aggiungi 10 timbri e riscatta. Il saldo diventa 0 e un secondo riscatto non deve essere consentito. |
| Coupon | Iscrivi un cliente a un programma Coupon: parte da un utilizzo. Riscattalo; un secondo utilizzo e la ricarica devono essere rifiutati. |
| Ruoli e attività | L’agenzia vede le attività; titolare e banco operano nella propria. Il banco può accreditare/riscattare ma non gestire campagne, programmi o utenti. Cambiando attività, non devono comparire clienti o movimenti dell’altra. |
| Storno | Come titolare, storna un’operazione con una motivazione. Verifica il movimento di storno e il saldo; non si deve poter stornare due volte lo stesso movimento. |
| Iscrizione e privacy | L’accettazione delle regole è necessaria; il consenso marketing è facoltativo. Una seconda iscrizione della stessa email allo stesso programma non deve rivelare il link della carta esistente. |
| Personalizzazione | Cambia nome, colore e logo del programma, controlla l’anteprima e la carta web. Prova la pausa e la riattivazione. |
| Campagne | Crea una bozza e prova segmenti e pianificazione con dati fittizi. Revoca il consenso dalla carta. Senza account Wallet non aspettarti consegne reali: controlla gli stati e le spiegazioni del sistema. |
| Automazioni | Verifica la regola per clienti inattivi, il periodo minimo tra due contatti e l’esclusione dei clienti senza consenso. |
| Cancellazione | Elimina un cliente di prova: il vecchio link pubblico non deve più funzionare e i dati personali locali devono essere rimossi/anonimizzati. Il registro residuo delle operazioni non equivale alla cancellazione fisica di una carta dal telefono. |

Lo Scanner accetta il QR tramite fotocamera oppure il link/codice manuale. La prova manuale verifica il flusso applicativo; la fotocamera richiede anche una prova sul dispositivo scelto per il banco, con HTTPS e permessi corretti.

### Demo personalizzata per un cliente

La piattaforma consente di configurarla dal pannello agenzia; non esiste una generazione automatica della demo a partire da un brief.

1. Accedi come agenzia, apri **Attività** e crea l’attività dimostrativa del cliente, con nome, colore e indirizzo concordati.
2. Seleziona la nuova attività e crea i programmi richiesti in **Programmi fedeltà**: punti, timbri o coupon, logo, premi, soglie, conversione spesa/punti ed eventuale scadenza.
3. Nelle **Impostazioni**, crea un accesso Titolare dedicato al cliente. Non condividere l’account dell’agenzia.
4. Usa il link/QR d’iscrizione per creare clienti fittizi e mostrare carta, accredito e riscatto. Le altre attività restano separate.
5. Mostra campagne e automazioni con dati di prova, chiarendo che l’invio Wallet richiederà la configurazione dei provider.

Per una prova a distanza serve un ambiente dimostrativo raggiungibile tramite HTTPS, da concordare dopo il collaudo locale. Non esporre su Internet il seed standard con le credenziali pubblicate qui: per una demo esterna prepara un database nuovo, account dedicati, password proprie e i documenti dell’attività. I requisiti specifici che superano le impostazioni disponibili vanno raccolti separatamente, senza promettere che siano già implementati.

Per una verifica facoltativa di backup/ripristino, usando solo il database demo:

```sh
npm run backup -- ./backups/collaudo.sqlite
```

Ferma backend e frontend. Ripristina in un **nuovo percorso**, senza sovrascrivere l’originale; in una shell POSIX:

```sh
DATABASE_PATH=./data/collaudo-ripristinato.sqlite npm run restore -- --offline ./backups/collaudo.sqlite
```

Il file di destinazione deve essere assente. Verifica il database ripristinato separatamente prima di usarlo. Su Windows imposta `DATABASE_PATH` secondo la sintassi della shell.

## 3. Servizi da collegare dopo il collaudo locale

**Non creare account, acquistare servizi o pubblicare il progetto durante questa prima prova.** L’agenzia ha chiesto di rimandare questi passaggi; raccogli ciò che manca in un’unica lista finale. Il dettaglio è in `docs/attivazione-agenzia.md`.

| Collegamento | Dati e configurazione necessari |
| --- | --- |
| Dominio e hosting | Server controllato dall’agenzia, Node 24 o Docker, disco persistente, dominio HTTPS, DNS, `PUBLIC_BASE_URL` e proxy coerenti. La versione corrente richiede una sola istanza applicativa/worker con SQLite su disco locale. |
| Backup | Destinazione esterna al server, periodicità e conservazione concordate; prova di ripristino. |
| Apple Wallet | Account Apple Developer **ancora da creare**, verifica dell’organizzazione, Team ID, Pass Type ID, certificato del pass, relativa chiave privata e certificato intermedio WWDR. Configurazione tramite le variabili `APPLE_*` in `.env.example`. |
| Google Wallet | Account Google Wallet API Issuer **ancora da creare**, progetto Google Cloud con Wallet API abilitata, service account autorizzato come Developer nell’issuer, chiave JSON e Issuer ID. Configurazione `GOOGLE_ISSUER_ID` e `GOOGLE_SERVICE_ACCOUNT_FILE`. Serve anche l’approvazione per pubblicare fuori dagli account di test. |
| Attività pilota | Logo, nome, programmi/premi, utenti, informativa privacy pubblica e regolamento. L’iscrizione pubblica in produzione richiede i documenti compilati. |

Le chiavi vanno sul server in percorsi protetti. Non vanno committate, incollate nel prompt, inserite nel frontend o condivise in chat. Il database demo non può essere avviato in produzione: il rilascio reale usa un database nuovo e `npm run bootstrap`, secondo `docs/operations.md`.

Non occorrono fornitori white label o piattaforme loyalty esterne. SMS, WhatsApp, email marketing, POS/NFC e operazioni offline non fanno parte di questo rilascio. Le campagne Apple aggiornano il contenuto del pass; non sono push promozionali garantite. Google applica limiti e proprie regole alle notifiche. «Accettato dal provider» non significa «letto sul telefono».

## 4. Prove Wallet da fare solo dopo la configurazione

Su un iPhone e un Android reali: aggiunta carta, accredito punti, riscatto, aggiornamento, scadenza, sospensione/riattivazione e revoca. Prova la campagna solo con destinatari di test consenzienti. Dopo l’approvazione Google, verifica il salvataggio con un utente normale, non aggiunto tra i tester.

Queste prove sono ancora pendenti: non dichiarare i Wallet operativi solo perché i test automatici o lo stato configurazione sono verdi.

## 5. Cosa restituire al termine

Un report breve con commit provato, comandi eseguiti ed esiti, percorsi browser verificati, difetti riproducibili con passaggi precisi, eventuali correzioni e un’unica lista di dati/servizi mancanti. Distingui software locale verificato, configurazione esterna e prove fisiche ancora pendenti. Non riportare password, chiavi o dati personali nei log allegati.

Documenti di riferimento: `README.md`, `docs/acceptance.md`, `docs/attivazione-agenzia.md`, `docs/wallet-setup.md`, `docs/operations.md`.
