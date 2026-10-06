# Dati da fornire alla fine dello sviluppo

Aggiornato il 26 settembre 2026.

Come concordato, account, servizi esterni e pubblicazione vengono affrontati dopo lo sviluppo. Questo documento raccoglie ciò che servirà in un solo posto. Non occorre fornire adesso questi dati. Gli account Apple Developer e Google Wallet sono entrambi ancora da creare.

Il software gestisce direttamente attività, clienti, programmi, saldi, premi, operatori e campagne. Codice e database restano sotto il controllo dell’agenzia. Le integrazioni Wallet usano le API ufficiali Apple e Google; non serve acquistare una piattaforma loyalty o Wallet white label.

## 1. Identità dell’agenzia e del prodotto

| Da fornire | A cosa serve |
| --- | --- |
| Ragione sociale, forma giuridica e paese | Intestare correttamente account e infrastruttura. La forma giuridica determina il percorso Apple appropriato. |
| Sede legale e contatti aziendali | Compilare i profili richiesti dai provider. |
| Nome del referente autorizzato a rappresentare l’agenzia | Verifica dell’iscrizione Apple. |
| Sito aziendale pubblico e funzionante | Verifica dell’organizzazione. |
| Email aziendale amministrativa sul dominio dell’agenzia | Controllo degli account e ricezione delle comunicazioni. |
| D‑U‑N‑S, se già disponibile | Apple lo richiede per l’iscrizione come organizzazione; altrimenti va verificato o richiesto. |
| Nome definitivo del servizio, logo e colori | Sostituire l’identità provvisoria «Fidelity Studio». |
| Email del primo amministratore | Creare l’accesso iniziale sul database di produzione. |

Non servono password, codici di verifica o documenti d’identità in chat. Accessi, verifiche d’identità e dati di pagamento si inseriscono nelle pagine ufficiali quando richiesti.

## 2. Dominio, server e backup

| Da fornire o scegliere | Uso previsto |
| --- | --- |
| Dominio o sottodominio definitivo, per esempio `fidelity.dominioagenzia.it` | Unico indirizzo HTTPS per pannello, iscrizioni, carte e aggiornamenti Wallet. |
| Accesso alla gestione DNS | Collegare il dominio al server. |
| Server o account hosting controllato dall’agenzia | Installazione dell’applicazione Node.js 24 o Docker, HTTPS e processo persistente. |
| Accesso tecnico al server tramite canale sicuro | Configurazione e rilascio; evitare credenziali condivise in chat. |
| Spazio di backup separato dal server e periodo di conservazione | Conservare e ripristinare il database. Il comando di backup è già disponibile. |
| Numero indicativo di attività, clienti e operatori simultanei al lancio | Dimensionare l’infrastruttura sul carico previsto, senza acquistare capacità inutilizzata. |

La versione corrente usa una singola istanza con SQLite su disco locale persistente. Non richiede un abbonamento a un database gestito. Il costo di hosting dipenderà dalla soluzione scelta; non è stato acquistato alcun servizio.

## 3. Apple Wallet — account da creare

1. Usare o creare un Apple Account del referente autorizzato, con autenticazione a due fattori.
2. Iscrivere l’agenzia all’Apple Developer Program nel percorso adatto alla sua forma giuridica. Per un’organizzazione servono entità giuridica verificabile, D‑U‑N‑S, sito e contatti aziendali.
3. Completare verifica e iscrizione. Apple pubblica un costo di **99 USD/anno**, con importi locali variabili; il pagamento si valuterà nella procedura ufficiale.
4. Creare il Pass Type ID e il relativo certificato, mantenendo chiave e account sotto il controllo dell’agenzia.

Al momento della configurazione serviranno **Team ID, Pass Type ID, certificato del pass, chiave privata corrispondente e certificato intermedio WWDR**. Eventuali passphrase e file segreti vanno collocati sul server in un percorso protetto, mai nel repository o nel frontend.

[Iscrizione Apple](https://developer.apple.com/programs/enroll/) · [Requisiti e costi](https://developer.apple.com/help/account/membership/program-enrollment) · [D‑U‑N‑S](https://developer.apple.com/support/D-U-N-S/)

## 4. Google Wallet — account da creare

1. Usare un Google Account amministrativo controllato dall’agenzia.
2. Creare il **Google Wallet API Issuer** nella console Google Pay & Wallet con il nome dell’attività.
3. Creare un progetto Google Cloud e abilitare Google Wallet API.
4. Creare un service account; autorizzarlo come Developer nell’account issuer e configurare la chiave JSON sul server.
5. Completare il profilo aziendale e le verifiche richieste dalla console, creare la prima classe di carte e richiedere l’accesso alla pubblicazione.

Serviranno **Issuer ID, identificativo del progetto e file JSON del service account**, custodito come segreto sul server. Il progetto Cloud da solo non concede accesso all’issuer.

Gli account nuovi partono in modalità demo: prima dell’approvazione le carte sono riservate agli account autorizzati di test. Creazione dell’account e autorizzazione alla pubblicazione sono passaggi distinti. La richiesta di pubblicazione corrente non richiede più screenshot.

[Console Google Pay & Wallet](https://pay.google.com/business/console/) · [Creazione issuer](https://developers.google.com/wallet/retail/loyalty-cards/getting-started/issuer-onboarding) · [Pubblicazione](https://developers.google.com/wallet/retail/loyalty-cards/getting-started/request-publishing-access)

## 5. Materiali delle prime attività

Per ogni attività pilota servono:

- Nome, indirizzo, logo, colore e referente operativo.
- Nomi ed email di titolare e personale autorizzato.
- Programmi desiderati: timbri, punti o coupon; soglia, premio, eventuale conversione euro/punti e scadenza.
- Eventuali coordinate dei punti vendita per i suggerimenti di prossimità dei Wallet.
- URL pubblico dell’informativa privacy, testo del regolamento e condizioni dei premi approvati dall’attività.
- Decisioni su gestione e conservazione dei dati, referenti per le richieste dei clienti e consenso marketing.
- Testi delle prime campagne, eventuale data di invio e regola di richiamo dei clienti inattivi.

Loghi, programmi, utenti, documenti e campagne si configurano nel pannello. L’iscrizione pubblica in produzione richiede informativa e termini compilati. L’invio di campagne reali sarà una scelta esplicita dell’attività.

## 6. Verifica conclusiva dopo la configurazione

Serviranno un iPhone, un telefono Android con Google Wallet e il dispositivo che verrà usato al banco. La verifica sarà mirata a un’attività e a clienti di prova:

1. Iscrizione e salvataggio di una carta su ciascun Wallet.
2. Lettura del QR con la fotocamera, accredito e riscatto; riscontro del saldo aggiornato sul telefono.
3. Aggiornamento del programma, sospensione/riattivazione dell’attività e revoca della carta.
4. Prova di una campagna a destinatari di test con consenso; controllo dell’esito tecnico.
5. Dopo l’approvazione Google, salvataggio con un account normale, non incluso tra i tester.

Queste prove dipendono dagli account e dai dispositivi reali e restano da fare. I test locali già eseguiti sono elencati in [stato delle verifiche](acceptance.md).

## 7. Servizi che non occorre procurare per questo rilascio

Il prodotto attuale non richiede fornitori loyalty, app native, servizi SMS/WhatsApp, piattaforme email marketing o lettori NFC. Le campagne utilizzano i canali Wallet implementati: Apple aggiorna il contenuto della carta, mentre Google può richiedere una notifica secondo i suoi limiti. La comparsa e la lettura degli avvisi non sono garantite dal software.

Integrazioni con casse/POS specifici, NFC e riscatti offline sono estensioni separate: serviranno requisiti e hardware concreti solo se si deciderà di aggiungerle.

## Scheda da compilare quando saremo pronti

```text
Ragione sociale e forma giuridica:
Paese e sede:
Referente autorizzato:
Sito ed email aziendale:
D‑U‑N‑S, se disponibile:
Nome e materiali del servizio:
Email amministratore iniziale:
Dominio/sottodominio scelto:
Server/hosting scelto, oppure da scegliere:
Destinazione backup e conservazione:
Attività/clienti/operatori previsti al lancio:
Prima attività pilota e referente:
Programmi e premi del pilota:
Informativa e regolamento:
Dispositivi disponibili per la prova:
```

Gli identificativi e i segreti tecnici verranno raccolti durante la configurazione degli account; non occorre crearli o copiarli in questa scheda. Le variabili corrispondenti sono documentate in [configurazione Wallet](wallet-setup.md) e [operazioni](operations.md).
