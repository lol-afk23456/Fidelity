# Attivazione del pilot gratuito con il primo cliente

Aggiornato il **6 ottobre 2026**.

L'obiettivo è **pubblicare oggi e consegnare gratuitamente il servizio a un cliente reale per provarlo insieme**. Il collega incaricato deve configurare i servizi esterni e fare il deploy con le risorse dell'agenzia. Le precedenti indicazioni di rimandare pubblicazione e account sono superate. Hosting/server e dominio non sono ancora indicati nel repository; gli account Apple Developer e Google Wallet sono entrambi ancora da creare.

Il software gestisce attività, clienti, programmi, saldi, premi e operatori sotto il controllo dell'agenzia. Non serve una piattaforma loyalty esterna. La gratuità per il cliente non implica assenza di costi infrastrutturali.

## 1. Dati da dare al collega per pubblicare oggi

| Da fornire o scegliere con il collega | Uso |
| --- | --- |
| Dominio o sottodominio e gestione DNS | Indirizzo HTTPS pubblico per pannello, iscrizioni e carte; valore di `PUBLIC_BASE_URL`. |
| Server/hosting controllato dall'agenzia e accesso tecnico sicuro | Node.js 24 oppure Docker, processo persistente, HTTPS e disco locale persistente. |
| Email e nome del primo amministratore | Bootstrap di un database nuovo, con password dedicata. |
| Destinazione di backup separata, frequenza e conservazione | Copie consistenti e prova di ripristino prima della consegna. |
| Nome del servizio, logo, colori e contatto di assistenza | Identità presentata al cliente e gestione dei problemi del pilot. |
| Nome, indirizzo, logo, colore e referente dell'attività pilota | Configurazione dell'attività reale. |
| Email di Titolare ed eventuali operatori | Accessi dedicati, senza condividere l'account agenzia. |
| Programma e premi concordati | Punti/timbri/coupon, soglie, conversione euro/punti ed eventuale scadenza. |
| Informativa privacy pubblica e regolamento approvati dall'attività | Documenti richiesti dall'iscrizione in produzione; non sostituirli con testi dimostrativi o inventati. |
| Dispositivo del banco e telefoni di prova | Collaudo di QR, iscrizione, credito e riscatto nel contesto d'uso reale. |

La versione corrente richiede **una sola istanza applicativa/worker con SQLite su disco locale persistente**. Il database pubblico va creato con bootstrap, senza il seed e le credenziali dimostrative. La procedura di deploy, HTTPS, backup e ripristino è in [operations.md](operations.md).

Accessi, password e file segreti si trasferiscono tramite canali sicuri e si conservano sul server; non vanno inseriti in questa scheda, nel repository o in chat. Per le iscrizioni reali servono anche le decisioni dell'attività su conservazione dei dati, richieste dei clienti e consenso marketing. I testi e le condizioni devono essere forniti e approvati dall'attività.

## 2. Perimetro da concordare con il cliente

La carta web con QR può funzionare senza credenziali Wallet. **Non è ancora stabilito che questo basti per il pilot.**

- Se agenzia e cliente accettano esplicitamente un avvio con carta web, si può consegnare quel perimetro dopo il collaudo sul dominio reale, dichiarando Apple e Google Wallet non attivi.
- Se entrambi i Wallet sono un requisito iniziale, la consegna completa richiede creazione/configurazione degli account, eventuali approvazioni e prove sui telefoni. Non è possibile prometterne il completamento oggi in base ai soli test del software.

Campagne e automazioni vanno presentate secondo i canali realmente attivi. Il prodotto non include SMS, WhatsApp, email marketing, integrazioni POS/NFC o riscatti offline.

## 3. Account Wallet da creare e collegare

Il collega deve avviare questi passaggi con il referente autorizzato dell'agenzia. Per intestare gli account servono identità e forma giuridica dell'agenzia, paese, sede, referente, sito ed email aziendale; per Apple come organizzazione anche i dati richiesti dal relativo percorso di verifica, incluso D‑U‑N‑S quando applicabile. Costi, requisiti e tempi si verificano nella procedura ufficiale.

### Apple Wallet

1. Usare o creare l'Apple Account del referente e completare l'iscrizione all'Apple Developer Program nel percorso adatto all'agenzia.
2. Completare le verifiche richieste da Apple e recuperare il **Team ID**.
3. Creare il **Pass Type ID** e il relativo **certificato del pass**, conservando la **chiave privata corrispondente**.
4. Configurare anche il **certificato intermedio WWDR** e le variabili `APPLE_*` documentate in [wallet-setup.md](wallet-setup.md).

Riferimenti: [iscrizione Apple](https://developer.apple.com/programs/enroll/) e [requisiti dell'iscrizione](https://developer.apple.com/help/account/membership/program-enrollment).

### Google Wallet

1. Creare l'account **Google Wallet API Issuer** nella console Google Pay & Wallet con un account amministrativo dell'agenzia.
2. Creare un progetto **Google Cloud** e abilitare **Google Wallet API**.
3. Creare un **service account** e aggiungerlo come **Developer nell'issuer**. Il progetto Cloud da solo non concede accesso all'issuer.
4. Conservare la **chiave JSON** sul server e configurare **Issuer ID**, `GOOGLE_ISSUER_ID` e `GOOGLE_SERVICE_ACCOUNT_FILE`.
5. Completare profilo, classe di carte e richiesta di **publishing access**. Prima dell'approvazione, la modalità demo permette prove solo con gli account di test autorizzati.

Riferimenti: [console Google Wallet](https://pay.google.com/business/console/), [onboarding issuer](https://developers.google.com/wallet/retail/loyalty-cards/getting-started/issuer-onboarding) e [pubblicazione](https://developers.google.com/wallet/retail/loyalty-cards/getting-started/request-publishing-access).

Per entrambi, le chiavi restano sul server in percorsi protetti e fuori dal repository. Dopo la configurazione, provare aggiunta della carta, credito/riscatto, aggiornamento, sospensione/riattivazione e revoca su iPhone e Android reali. Una configurazione verde o un invio accettato dal provider non dimostrano che la carta si aggiorni sul dispositivo. Le campagne Apple aggiornano il contenuto del pass; gli avvisi Google dipendono dai limiti del provider. Non promettere la visualizzazione o lettura di una notifica.

## 4. Condizioni operative di consegna

Prima della consegna, verificare sul dominio reale HTTPS, `/api/health`, login dedicato, isolamento dell'attività, iscrizione con documenti approvati, scansione sul dispositivo del banco, accredito e riscatto con riscontro del saldo. Verificare persistenza dopo riavvio, backup esterno e ripristino su copia isolata. I Wallet richiedono inoltre i collaudi del punto precedente quando inclusi nel perimetro iniziale.

Consegnare URL, accesso Titolare in modo sicuro, QR d'iscrizione e istruzioni brevi; provare i passaggi insieme al cliente. Registrare commit, esiti, limitazioni accettate e referente di assistenza. Il prompt operativo completo è in [consegna-collega.md](consegna-collega.md); le verifiche software già svolte sono in [acceptance.md](acceptance.md).

## Scheda per il rilascio di oggi

```text
Dominio/sottodominio:
Server/hosting e referente tecnico:
Email amministratore iniziale:
Destinazione backup, frequenza e conservazione:
Nome e materiali del servizio:
Attività pilota e referente:
Email Titolare e operatori:
Programma, conversione, premio, soglia e scadenza:
Informativa pubblica e regolamento approvati:
Perimetro accettato: carta web iniziale oppure Wallet indispensabili:
Referente agenzia per account Apple e Google:
Dispositivi per la prova:
Referente assistenza e modalità di raccolta feedback:
```
