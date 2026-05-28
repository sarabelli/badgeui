# Totem GUI

Interfaccia minimale per il totem presenze che si collega a due servizi websocket:

- `badgesvc` per la lettura reale dei badge
- `mock-verification` per associare il codice letto a nome, cognome e classe

## Struttura

- `index.html`: pagina del totem
- `style.css`: stile del totem
- `script.js`: logica client lato browser
- `server.js`: piccolo server HTTP locale che serve la pagina e la configurazione runtime
- `mock-verification/server.js`: mock websocket del servizio di verifica
- `mock-verification/data/records.json`: database JSON con token autorizzati e anagrafica badge

## Architettura

Il browser fa da orchestratore.

1. Si collega al reader websocket esposto da `badgesvc`
2. Si collega al websocket di verifica
3. Appena la connessione di verifica si apre, invia un messaggio di autenticazione con token
4. Solo dopo autenticazione riuscita il browser invia richieste `verify`
5. Se la verifica va a buon fine, il totem mostra nome, classe e ora
6. Se la verifica fallisce, il totem mostra solo l'errore restituito

Il codice del badge non viene mostrato nella UI.

## Avvio

### 1. Avvia il reader reale

Nel repository `badgesvc`:

```bash
npm run start:reader
```

Per default espone:

- HTTP health: `http://127.0.0.1:25585/health`
- WebSocket: `ws://127.0.0.1:25585/ws`

### 2. Avvia il mock di verifica

In questo repository:

```bash
npm run start:verify
```

Per default espone:

- HTTP health: `http://127.0.0.1:25587/health`
- WebSocket: `ws://127.0.0.1:25587/ws`

### 3. Avvia la web UI

In questo repository:

```bash
npm run start:web
```

La UI sara disponibile su:

```text
http://127.0.0.1:25586/
```

## Configurazione deploy

La configurazione lato UI viene servita da `server.js` tramite `/config.json`.

Variabili ambiente disponibili:

- `HOST`: host del server UI. Default `127.0.0.1`
- `PORT`: porta del server UI. Default `25586`
- `READER_WS_URL`: websocket del reader. Default `ws://127.0.0.1:25585/ws`
- `VERIFICATION_WS_URL`: websocket del servizio verifica. Default `ws://127.0.0.1:25587/ws`
- `VERIFICATION_TOKEN`: token usato dalla UI per autenticarsi al websocket di verifica. Default `totem-device-01`

Esempio:

```bash
VERIFICATION_TOKEN="totem-device-01" npm run start:web
```

## Database mock verification

Il file `mock-verification/data/records.json` ha questa forma:

```json
{
  "authorizedTokens": [
    "totem-device-01",
    "totem-device-02"
  ],
  "records": {
    "CIE-977884595015": {
      "name": "Sara",
      "surname": "Belli",
      "class": "4 A Informatica"
    }
  }
}
```

### authorizedTokens

Lista dei token ammessi dal servizio websocket di verifica.

Se il token del client non e presente:

1. il server risponde con errore di autenticazione
2. chiude immediatamente la connessione websocket

### records

Mappa esatta tra codice badge letto e persona associata.

La chiave deve coincidere esattamente con il `uuid` inviato da `badgesvc`.

## Protocollo websocket verification

### Messaggio di ready

Appena il client si collega, il mock risponde con:

```json
{
  "type": "ready",
  "timestamp": "2026-05-28T10:00:00.000Z",
  "service": "mock-verification",
  "recordCount": 5,
  "authorizedTokenCount": 2,
  "dbPath": "/path/to/records.json"
}
```

### Auth request

Il client invia:

```json
{
  "type": "auth",
  "token": "totem-device-01"
}
```

### Auth response ok

```json
{
  "type": "auth",
  "timestamp": "2026-05-28T10:00:00.000Z",
  "success": true
}
```

### Auth response errore

```json
{
  "type": "auth",
  "timestamp": "2026-05-28T10:00:00.000Z",
  "success": false,
  "error": "Unauthorized token"
}
```

Dopo questa risposta il server chiude la connessione.

### Verify request

Solo dopo auth riuscita, il client invia:

```json
{
  "type": "verify",
  "requestId": "0f7a...",
  "code": "CIE-977884595015"
}
```

### Verify response ok

```json
{
  "type": "verification",
  "timestamp": "2026-05-28T10:00:00.000Z",
  "success": true,
  "requestId": "0f7a...",
  "code": "CIE-977884595015",
  "person": {
    "name": "Sara",
    "surname": "Belli",
    "class": "4 A Informatica"
  }
}
```

### Verify response errore

```json
{
  "type": "verification",
  "timestamp": "2026-05-28T10:00:00.000Z",
  "success": false,
  "requestId": "0f7a...",
  "code": "CIE-977884595015",
  "error": "Code not found"
}
```

## Stati UI

La pagina mostra solo:

- logo
- orologio con secondi
- invito a presentare il badge
- stato reader in basso
- stato verify in basso
- overlay di successo con nome, classe e ora
- overlay di errore con solo messaggio errore

Il codice del badge non viene mai mostrato sullo schermo.

## Health checks

### UI

```bash
curl http://127.0.0.1:25586/health
```

### Mock verification

```bash
curl http://127.0.0.1:25587/health
```

## Dipendenze

Installa le dipendenze una sola volta:

```bash
npm install
```

Dipendenza usata:

- `ws`

## Note operative

- Se cambi `authorizedTokens`, il token configurato nella UI deve corrispondere
- Se cambi i record, la chiave deve essere identica al codice prodotto da `badgesvc`
- Se il token e sbagliato, la UI non riesce a usare il servizio di verifica
