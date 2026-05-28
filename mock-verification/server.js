const fs = require('fs');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const HOST = process.env.VERIFICATION_HOST || '127.0.0.1';
const PORT = Number(process.env.VERIFICATION_PORT || 25587);
const WS_PATH = '/ws';
const DB_PATH = path.join(__dirname, 'data', 'records.json');

function createErrorPayload(payload, error) {
    return buildMessage('verification', {
        success: false,
        requestId: payload?.requestId || null,
        code: payload?.code || null,
        error,
    });
}

function buildMessage(type, payload) {
    return {
        type,
        timestamp: new Date().toISOString(),
        ...payload,
    };
}

function sendJson(ws, payload) {
    if (ws.readyState === 1) {
        ws.send(JSON.stringify(payload));
    }
}

function loadDatabase() {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Verification database must be an object');
    }

    if (!Array.isArray(parsed.authorizedTokens)) {
        throw new Error('Verification database must include authorizedTokens array');
    }

    if (!parsed.records || typeof parsed.records !== 'object' || Array.isArray(parsed.records)) {
        throw new Error('Verification database must include records object');
    }

    return parsed;
}

function lookupRecord(code) {
    const database = loadDatabase();
    const record = database.records[code];

    if (!record) {
        return null;
    }

    if (!record.name || !record.surname || !record.class) {
        throw new Error(`Invalid record for code ${code}`);
    }

    return {
        name: String(record.name),
        surname: String(record.surname),
        class: String(record.class),
    };
}

const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        try {
            const database = loadDatabase();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(
                JSON.stringify({
                    ok: true,
                    service: 'mock-verification',
                    records: Object.keys(database.records).length,
                    authorizedTokens: database.authorizedTokens.length,
                    dbPath: DB_PATH,
                }),
            );
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(
                JSON.stringify({
                    ok: false,
                    error: error.message,
                }),
            );
        }
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
    if (req.url !== WS_PATH) {
        socket.destroy();
        return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws);
    });
});

wss.on('connection', (ws) => {
    let recordCount = 0;
    let authorizedTokenCount = 0;
    ws.isAuthenticated = false;

    try {
        const database = loadDatabase();
        recordCount = Object.keys(database.records).length;
        authorizedTokenCount = database.authorizedTokens.length;
    } catch (_error) {
        recordCount = 0;
        authorizedTokenCount = 0;
    }

    sendJson(
        ws,
        buildMessage('ready', {
            service: 'mock-verification',
            recordCount,
            authorizedTokenCount,
            dbPath: DB_PATH,
        }),
    );

    ws.on('message', (raw) => {
        let payload;

        try {
            payload = JSON.parse(String(raw));
        } catch (_error) {
            sendJson(ws, createErrorPayload(null, 'Invalid JSON payload'));
            return;
        }

        if (payload.type === 'auth') {
            const database = loadDatabase();
            const token = typeof payload.token === 'string' ? payload.token : '';

            if (!token) {
                sendJson(
                    ws,
                    buildMessage('auth', {
                        success: false,
                        error: 'Missing authentication token',
                    }),
                );
                ws.close(4001, 'Missing authentication token');
                return;
            }

            if (!database.authorizedTokens.includes(token)) {
                sendJson(
                    ws,
                    buildMessage('auth', {
                        success: false,
                        error: 'Unauthorized token',
                    }),
                );
                ws.close(4003, 'Unauthorized token');
                return;
            }

            ws.isAuthenticated = true;
            sendJson(
                ws,
                buildMessage('auth', {
                    success: true,
                }),
            );
            return;
        }

        if (!ws.isAuthenticated) {
            sendJson(ws, createErrorPayload(payload, 'Authentication required'));
            ws.close(4003, 'Authentication required');
            return;
        }

        if (payload.type !== 'verify') {
            sendJson(ws, createErrorPayload(payload, 'Unsupported message type'));
            return;
        }

        if (!payload.code || typeof payload.code !== 'string') {
            sendJson(ws, createErrorPayload(payload, 'Missing exact code'));
            return;
        }

        try {
            const person = lookupRecord(payload.code);

            if (!person) {
                sendJson(ws, createErrorPayload(payload, 'Code not found'));
                return;
            }

            sendJson(
                ws,
                buildMessage('verification', {
                    success: true,
                    requestId: payload.requestId || null,
                    code: payload.code,
                    person,
                }),
            );
        } catch (error) {
            sendJson(ws, createErrorPayload(payload, error.message));
        }
    });
});

server.listen(PORT, HOST, () => {
    console.log(`[verification] HTTP health: http://${HOST}:${PORT}/health`);
    console.log(`[verification] WebSocket: ws://${HOST}:${PORT}${WS_PATH}`);
    console.log(`[verification] Database: ${DB_PATH}`);
});
