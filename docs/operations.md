# Esecuzione e gestione

## Requisiti

- Node.js 24, npm e OpenSSL; oppure Docker Engine con Compose.
- Un disco persistente locale per SQLite e spazio separato per copie di sicurezza.
- Per l'emissione wallet reale: dominio HTTPS pubblico e credenziali descritte in [wallet-setup.md](wallet-setup.md).

I comandi vanno eseguiti dalla radice del repository. I comandi Node devono usare il runtime 24: Node 12/14 non sono compatibili. Le credenziali wallet non sono necessarie per utilizzare la carta web o provare le operazioni del gestionale.

## Consegna al primo cliente: 6 ottobre 2026

L’obiettivo attuale è pubblicare il servizio per un pilot gratuito con un cliente reale. Il collega incaricato configura hosting, dominio e integrazioni: il [prompt di consegna](consegna-collega.md) descrive attività e collaudo. La pubblicazione non è più rimandata alla fine di un futuro sviluppo.

Il codice è predisposto per una singola istanza persistente, bootstrap amministratore, attività separate e accessi titolare/personale. Per il pilot non serve un modulo di pagamento. Il fatto che il test sia gratuito non cambia la configurazione: database nuovo, password dedicate, HTTPS e documenti dell’attività.

Prima di consegnare il link al cliente, verificare sul dominio reale login, creazione dell’attività e del programma concordato, iscrizione, accredito, riscatto, persistenza dopo un riavvio e backup. Per una carta punti di prova con 1,5 punti/euro e premio da 10 punti: 10 € devono produrre 15 punti; dopo il riscatto ne rimangono 5.

Chiarire con l’agenzia quali canali rientrano nel test: se include Apple/Google Wallet, servono anche account, autorizzazioni e prove reali sui dispositivi. Un pilot iniziale con carta web/QR è tecnicamente possibile, ma non deve essere presentato come equivalente ai Wallet attivati senza averlo concordato.

## Sviluppo e dimostrazione

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

Aprire `http://localhost:5173`. Il database dimostrativo si crea solo tramite il comando esplicito di seed. Le credenziali di dimostrazione sono pubbliche e servono esclusivamente su un ambiente locale isolato; il seed non è una procedura di bootstrap per clienti reali.

## Installazione su un server proprio

1. Copiare `.env.example` in `.env`, impostare `NODE_ENV=production` e i valori dell'installazione; proteggerlo con permessi `600`. Usare un database nuovo, distinto dal demo.
2. Impostare `PUBLIC_BASE_URL` sul dominio HTTPS pubblico. Se un reverse proxy è presente, configurare la fiducia nel proxy solo per gli hop effettivamente controllati dall'agenzia.
3. Eseguire `docker compose build`. Aggiungere temporaneamente a `.env` `FIDELITY_ADMIN_EMAIL`, `FIDELITY_ADMIN_PASSWORD` (almeno 12 caratteri) e, facoltativamente, `FIDELITY_ADMIN_NAME`; creare il primo amministratore con `docker compose run --rm --no-deps app node dist/scripts/bootstrap.js`. Rimuovere la password di bootstrap da `.env` al termine.
4. Avviare `docker compose up -d`. Il servizio è esposto solo su `127.0.0.1:3001` per impostazione predefinita; `HOST_PORT` cambia la porta esterna. Configurare un reverse proxy HTTPS davanti a questa porta.
5. Verificare `docker compose ps`, `docker compose logs --tail=100 app` e `curl --fail http://127.0.0.1:3001/api/health`, quindi l'accesso attraverso il dominio HTTPS.

Il Dockerfile avvia direttamente `node dist/server/index.js`, la stessa applicazione di `npm start`, per inoltrare i segnali al processo. Il frontend è servito da `dist/client`; Vite non viene eseguito in produzione. Il volume `fidelity_data` conserva il database tra aggiornamenti del container. **Non eseguire `docker compose down -v` su un ambiente da conservare:** eliminerebbe il volume.

Su un hosting gestito che esegue il Dockerfile, configurare un volume persistente per `/app/data`, una sola replica, la porta interna `3001` e il dominio HTTPS. Un filesystem effimero perderebbe il database al successivo rilascio. Eseguire il bootstrap con lo stesso ambiente e lo stesso volume dell’applicazione, poi togliere la password di bootstrap. Il progetto non richiede un database esterno per questo rilascio.

L'healthcheck verifica che l'API risponda, non che le carte possano essere emesse né che backup e notifiche funzionino. Impostare monitoraggio esterno, allarmi su spazio disco, errori di integrazione e scadenza dei certificati.

### Certificati e chiavi

La directory opzionale `./certs` può essere montata in `/app/certs:ro`, decommentando la riga indicata nel Compose. Una directory vuota non deve impedire l'avvio del gestionale: le funzionalità wallet restano non configurate. Usare i percorsi interni `/app/certs/...` nelle variabili di ambiente. Il processo ha utente `node` (UID 1000 nell'immagine ufficiale); consentirgli lettura dei soli file necessari, senza renderli pubblici o scrivibili dal container.

Non aggiungere `.env`, certificati, chiavi o dati al repository o all'immagine. `.dockerignore` esclude le directory e le estensioni più comuni, ma non sostituisce il controllo di ciò che viene copiato. Le chiavi Google JSON devono stare nella directory `certs` esclusa dal build context. Conservare una copia cifrata delle chiavi e documentare rinnovo e rotazione.

### Installazione senza Docker

```sh
npm ci
NODE_ENV=production npm run build
NODE_ENV=production npm start
```

Usare un utente di sistema dedicato e un gestore di processo con riavvio e log. Avviare una sola istanza applicativa. Prima di esporre il servizio, impostare le variabili `FIDELITY_ADMIN_*` descritte sopra ed eseguire `npm run bootstrap`; rimuovere poi la password di bootstrap e verificare le impostazioni HTTPS. I dettagli del reverse proxy e del firewall dipendono dal server scelto e non sono installati automaticamente da questo repository.

## Backup consistente

Non copiare soltanto il file `.sqlite` mentre il server è in esecuzione: dati confermati potrebbero essere ancora nel WAL. Lo script usa l'API online di SQLite, controlla integrità e riferimenti, produce un file autonomo con permessi `600` e rifiuta di sovrascrivere una destinazione già presente. Backup e restore leggono `.env` se esiste, senza sostituire variabili già esportate nell'ambiente.

Con Node 24 locale:

```sh
node --env-file=.env scripts/backup.ts
```

Oppure scegliere esplicitamente la destinazione:

```sh
DATABASE_PATH=data/fidelity.sqlite node scripts/backup.ts /percorso/backups/fidelity-2026-09-26.sqlite
```

Nel container in esecuzione:

```sh
docker compose exec app node scripts/backup.ts
```

La destinazione predefinita è `backups/` accanto al database; nel container è `/app/data/backups`. Lo script stampa il percorso del file effettivamente creato. Esportare la copia su un archivio separato e cifrato: una copia sullo stesso volume non protegge dalla perdita del server. Pianificare frequenza e conservazione coerenti con la perdita dati accettabile; il repository non crea automaticamente un backup periodico.

Un backup contiene dati personali, hash delle password, token e sessioni. Trattarlo come il database di produzione. Le chiavi wallet e la configurazione non sono incluse nel backup del database e richiedono conservazione separata.

## Ripristino, solo a servizio fermo

Lo script richiede `--offline`, verifica la sorgente e crea **soltanto una destinazione assente**. Rifiuta file esistenti, collegamenti simbolici come sorgente e sidecar WAL/SHM/journal presenti. Non esiste un'opzione di sovrascrittura. Il flag dichiara che l'operatore ha arrestato l'applicazione: lo script non può identificare ogni processo su un altro host.

1. Fermare l'applicazione e i worker, inclusi eventuali processi di sviluppo. In Docker usare `docker compose stop app`.
2. Conservare insieme il database precedente e gli eventuali file con suffissi `-wal`, `-shm`, `-journal`. Non cancellare singoli sidecar per aggirare un errore. Preferire una nuova directory o un nuovo volume per la prova.
3. Eseguire il ripristino verso una nuova destinazione; ad esempio:

   ```sh
   DATABASE_PATH=data-restored/fidelity.sqlite node scripts/restore.ts --offline /percorso/backups/fidelity-2026-09-26.sqlite
   ```

   Con Docker, a servizio fermo, ripristinare in una sottodirectory nuova del volume:

   ```sh
   docker compose run --rm --no-deps -e DATABASE_PATH=/app/data/recovery/fidelity.sqlite app node scripts/restore.ts --offline /app/data/backups/NOME-REALE-DEL-BACKUP.sqlite
   ```

4. Verificare il file, i permessi e alcuni saldi/operazioni in un'istanza isolata. Lo script accetta gli schemi 1–3, controlla le tabelle principali e i campi delle migrazioni, e rifiuta versioni future. I database precedenti vengono migrati dall'applicazione al successivo avvio. Questi controlli e quelli di SQLite non sostituiscono una prova funzionale sui dati recuperati.
5. Configurare l'applicazione per il percorso recuperato oppure effettuare uno scambio controllato dei file a processi fermi, conservando l'originale. Il Compose imposta esplicitamente `DATABASE_PATH`: modificarlo in un override se cambia la destinazione.
6. Riavviare una sola istanza, verificare accessi, dati e coda. Dopo un rollback di database, le carte sui dispositivi possono mostrare saldi più recenti: riconciliare gli aggiornamenti wallet prima di riaprire le operazioni.

Provare periodicamente il ripristino su una copia separata. Registrare durata, esito e punto temporale recuperato. Nessuna verifica di questa procedura implica che un backup futuro verrà eseguito senza monitoraggio.

## Aggiornamenti e incidenti

Prima di un aggiornamento: eseguire un backup verificato, leggere le modifiche di schema, costruire la nuova immagine e provarla su una copia del database. Conservare la versione precedente dell'immagine. Un rollback del codice non annulla automaticamente le migrazioni del database.

Se un wallet non si aggiorna: controllare configurazione e coda nel gestionale, risolvere credenziali o errori provider, poi ritentare i job bloccati. Gli invii Google segnalati come incerti richiedono una verifica nella console del provider: l'azione generica di riprova li esclude. Non modificare manualmente i saldi per correggere un problema di visualizzazione. Consultare i limiti in [wallet-setup.md](wallet-setup.md).

Per una cancellazione cliente, verificare anche il job di revoca wallet. Il token web viene invalidato subito, ma Google e i dispositivi Apple ricevono l'aggiornamento successivamente. La conservazione temporanea delle registrazioni Apple termina dopo sette giorni, con pulizia eseguita dal worker; tenere il worker attivo. Un dispositivo offline può conservare la vecchia rappresentazione fino al successivo aggiornamento e il servizio non elimina fisicamente la carta dal telefono.

Prima dell'apertura a clienti reali completare le verifiche pertinenti di [acceptance.md](acceptance.md), configurare informativa e regolamento dell’attività, backup esterni e prova di ripristino. Per i canali Wallet inclusi nella consegna, verificare emissione e aggiornamento su dispositivi reali; distinguere esplicitamente gli eventuali canali ancora in attesa di approvazione.
