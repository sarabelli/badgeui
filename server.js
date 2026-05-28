const fs = require('fs');
const http = require('http');
const path = require('path');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 25586);
const ROOT = __dirname;
const READER_WS_URL = process.env.READER_WS_URL || 'ws://127.0.0.1:25585/ws';
const VERIFICATION_WS_URL =
    process.env.VERIFICATION_WS_URL || 'ws://127.0.0.1:25587/ws';
const VERIFICATION_TOKEN = process.env.VERIFICATION_TOKEN || 'totem-device-01';

const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8',
};

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

function resolveFilePath(urlPath) {
    const requestedPath = urlPath === '/' ? '/index.html' : urlPath;
    const safePath = path.normalize(requestedPath).replace(/^\.+/, '');
    return path.join(ROOT, safePath);
}

function serveStatic(req, res) {
    const filePath = resolveFilePath(req.url || '/');

    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (error, data) => {
        if (error) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }

        const type = MIME_TYPES[path.extname(filePath)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type });
        res.end(data);
    });
}

const server = http.createServer((req, res) => {
    if (!req.url) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad request');
        return;
    }

    if (req.url === '/health') {
        sendJson(res, 200, { ok: true, service: 'totemgui-web' });
        return;
    }

    if (req.url === '/config.json') {
        sendJson(res, 200, {
            readerWsUrl: READER_WS_URL,
            verificationWsUrl: VERIFICATION_WS_URL,
            verificationToken: VERIFICATION_TOKEN,
        });
        return;
    }

    if (req.url === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
    }

    serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
    console.log(`[totemgui] Web UI: http://${HOST}:${PORT}/`);
    console.log(`[totemgui] Reader WS: ${READER_WS_URL}`);
    console.log(`[totemgui] Verification WS: ${VERIFICATION_WS_URL}`);
    console.log('[totemgui] Verification token source: VERIFICATION_TOKEN env');
});
