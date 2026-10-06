# Apple Wallet e Google Wallet: integrazione proprietaria

La piattaforma genera pass Apple firmati e usa direttamente le API Google Wallet. Nessun servizio white-label gestisce tessere o dati. Il database della piattaforma rimane la fonte dei saldi, dei premi e dei riscatti; una tessera Wallet è una rappresentazione aggiornata di quei dati.

## Stato attuale e verifica reale

`getWalletStatus()` verifica configurazione locale, URL e materiale crittografico. **Configurato non significa approvato dal provider, pubblicato, aggiunto al telefono o consegnato.** L'accesso a produzione Google e il funzionamento sui telefoni richiedono verifiche negli account dell'agenzia. Senza credenziali valide le funzioni di emissione rifiutano la richiesta; non esiste un pass dimostrativo presentato come attivo.

Prima di consegnare un progetto commerciale: installare una tessera su iPhone e Android reali, provare accredito e riscatto, verificare aggiornamenti, disinstallazione/reinstallazione, gestione rete assente, scadenza e accesso a produzione Google. Il simulatore iOS non verifica le notifiche Wallet. Il nostro test automatico controlla payload, firma JWT, segreti, stati coupon e guardie di configurazione; non certifica consegna reale.

## Origine HTTPS e logo

Impostare `PUBLIC_BASE_URL=https://dominio-dell-agenzia.example`, senza percorso o query. Apple richiede HTTPS per i servizi di aggiornamento. Non si emettono pass di produzione per `localhost` o HTTP. L'origine deve essere effettivamente raggiungibile dal telefono e dai provider.

Il server espone `/api/wallet/icon.png`, simbolo originale generato localmente, come logo Google di riserva. Per Google è possibile specificare `program.logoUrl` con un'immagine HTTPS pubblica. Apple usa l'icona locale e il nome del negozio nel pass; non scarica immagini arbitrarie dal server, evitando una superficie SSRF. I link alla tessera usano `/card/:publicToken`.

## Apple

1. Iscrivere l'organizzazione all'Apple Developer Program. Il prezzo pubblicato è 99 USD/anno, con importi locali variabili. Per un'organizzazione Apple richiede la verifica dell'entità e normalmente un D‑U‑N‑S.
2. Creare un **Pass Type ID**, ad esempio `pass.it.agenzia.fidelity`, e il relativo certificato. Usare il Team ID dell'account che lo ha emesso.
3. Salvare certificato, chiave privata corrispondente e certificato intermedio WWDR corrente fuori dal repository, con accesso ristretto. La chiave deve essere PEM; i certificati PEM/DER vengono normalizzati in memoria. I file non devono trovarsi nella cartella pubblica.
4. Configurare:

```dotenv
APPLE_PASS_TYPE_ID=pass.it.agenzia.fidelity
APPLE_TEAM_ID=ABCDEFGHIJ
APPLE_SIGNER_CERT_PATH=/run/secrets/apple-pass-cert.pem
APPLE_SIGNER_KEY_PATH=/run/secrets/apple-pass-key.pem
APPLE_WWDR_CERT_PATH=/run/secrets/apple-wwdr.pem
# Solo se la chiave è cifrata:
APPLE_SIGNER_KEY_PASSPHRASE=
```

Le chiavi e i certificati non vengono loggati. Sono controllati corrispondenza chiave/certificato, periodo di validità e identificativi nel certificato. Questa verifica locale non sostituisce l'autenticità della catena Apple o un test sul dispositivo. Pianificare il rinnovo prima della scadenza e conservare una copia protetta dei segreti.

`buildApplePass` restituisce un `.pkpass` firmato (`application/vnd.apple.pkpass`). Ogni pass usa `member.id` come seriale, `member.appleAuthToken` stabile e indipendente come segreto del protocollo, e `member.publicToken` nel QR. Il QR identifica il cliente, **non autorizza** una modifica del saldo: ogni transazione deve essere effettuata dal personale autenticato e autorizzato nel negozio corretto. `sharingProhibited` non impedisce screenshot o condivisione di codici.

Il `webServiceURL` è `${PUBLIC_BASE_URL}/api/wallet/apple`. Le route Express implementano il protocollo `/v1/devices/...`, `/v1/passes/...` e `/v1/log`; il token `ApplePass` va confrontato in tempo costante e le registrazioni vanno collegate al pass corretto. Le liste aggiornamenti devono contenere solo i seriali registrati per quel dispositivo e un cursore monotono. Non cambiare seriale o authentication token durante la vita del pass.

`notifyAppleDevices` invia `{}` via APNs HTTP/2 all'endpoint produzione, usando lo stesso certificato del pass. Deduplica i token, limita a quattro invii contemporanei e ritenta una volta errori temporanei. Restituisce `invalidTokens`; in caso di fallimento parziale `ApplePushError` contiene anche i token da rimuovere. Il chiamante deve rimuovere le relative registrazioni. Un successo APNs significa accettazione della richiesta, non consegna al telefono. Gli aggiornamenti del database non vanno annullati se il Wallet è offline.

Le campagne aggiornano `offer` sul retro senza `changeMessage`: il codice non trasforma le offerte in notifiche marketing Apple. Le linee guida Apple limitano i change message alle informazioni urgenti; la presentazione del pass resta sotto controllo di Wallet e dell'utente.

## Google

1. Creare l'account **Google Wallet API Issuer** nella console Google Pay & Wallet e annotare l'Issuer ID numerico.
2. Creare un progetto Google Cloud e abilitare **Google Wallet API**.
3. Creare un service account con chiave RSA JSON; aggiungerne l'indirizzo come utente con ruolo Developer all'issuer nella console Wallet. Il ruolo IAM del progetto da solo non concede accesso all'issuer.
4. Salvare il JSON fuori dal repository e configurare:

```dotenv
GOOGLE_ISSUER_ID=1234567890123456789
GOOGLE_SERVICE_ACCOUNT_FILE=/run/secrets/google-wallet-service-account.json
```

5. Completare il profilo aziendale, creare una classe e richiedere accesso alla pubblicazione. I nuovi account iniziano in **demo mode**, dove solo amministratori, sviluppatori e account test possono aggiungere le tessere. La creazione API riuscita non prova che un normale cliente possa aggiungerle: provarlo con un account non di test dopo l'approvazione. La documentazione corrente non richiede più screenshot per presentare la richiesta di produzione.

`googleSaveUrl` crea/aggiorna la classe e l'oggetto tramite API reale prima di generare il JWT `RS256` per il link Add to Google Wallet. Il JWT contiene riferimenti agli oggetti già creati, non chiavi, token Apple o dati anagrafici. Una classe corrisponde al programma e un oggetto al cliente nel programma; identificativi deterministici evitano duplicati. Il service account deve poter accedere all'issuer utilizzato.

`updateGooglePass` aggiorna i saldi e i contenuti. `notify=true` aggiunge la preferenza di notifica solo alle carte fedeltà per i campi ammessi dal provider. `sendGoogleMessage` chiama `addMessage` con `TEXT_AND_NOTIFY`; il consenso e il conteggio di massimo tre notifiche per pass/24 ore competono all'applicazione. Non si ritentano automaticamente i messaggi dopo timeout, perché l'invio potrebbe essere stato accettato: questo evita di duplicare avvisi. Un errore 403 viene presentato come accesso rifiutato, un 429 come limite raggiunto; nessuno viene tradotto in consegna riuscita.

## Semantica dei programmi

- Timbri e punti: carte `storeCard` Apple e `loyalty` Google; il pass mostra saldo e premi disponibili. Il calcolo è effettuato dal backend transazionale.
- Coupon: pass `coupon` Apple e `offer` Google. Saldo maggiore di zero indica disponibilità; zero rende il coupon `voided` su Apple e `INACTIVE` su Google. È comunque il backend a impedire un secondo riscatto.
- `expiresAt`, se configurato, passa ai campi di scadenza dei provider; la scadenza va verificata anche dal backend al riscatto.
- Fino a dieci località valide per programma. Si usa `merchantLocations` su Google e `locations` su Apple. Non è una garanzia di alert a distanza esatta né una misura delle visite. Google richiede notifiche e posizione precisa sempre attive; raggio, permanenza e testo sono decisi da Google.
- NFC/VAS, Google Smart Tap e integrazioni POS non sono implementati. L'MVP usa QR e operatore autenticato; un normale lettore contactless non equivale a supporto dei pass Wallet.

## Fonti ufficiali

- [Apple: iscrizione](https://developer.apple.com/programs/enroll/), [identificativi e certificati](https://developer.apple.com/help/account/capabilities/create-wallet-identifiers-and-certificates).
- [Apple: protocollo aggiornamenti](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/PassKit_PG/Updating.html), [rilevanza posizione](https://developer.apple.com/documentation/walletpasses/showing-a-pass-on-the-lock-screen), [linee guida Wallet](https://developer.apple.com/design/human-interface-guidelines/wallet/).
- [Google: onboarding issuer](https://developers.google.com/wallet/generic/getting-started/issuer-onboarding), [publishing](https://developers.google.com/wallet/generic/test-and-go-live/request-publishing-access), [JWT](https://developers.google.com/wallet/reference/rest/v1/Jwt).
- [Google: loyalty classes](https://developers.google.com/wallet/reference/rest/v1/loyaltyclass), [offer classes](https://developers.google.com/wallet/reference/rest/v1/offerclass), [notifiche e prossimità](https://developers.google.com/wallet/retail/loyalty-cards/use-cases/trigger-push-notifications).

Documentazione verificata il 26 settembre 2026. Le policy dei provider e gli account vanno ricontrollati prima dell'attivazione commerciale.
