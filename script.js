const months = [
    'gennaio',
    'febbraio',
    'marzo',
    'aprile',
    'maggio',
    'giugno',
    'luglio',
    'agosto',
    'settembre',
    'ottobre',
    'novembre',
    'dicembre',
];

const state = {
    config: null,
    sockets: {
        reader: null,
        verify: null,
    },
    connection: {
        reader: false,
        verify: false,
    },
    verificationAuthReady: false,
    overlayTimer: null,
    pendingByRequestId: new Map(),
};

const elements = {
    hh: document.getElementById('hh'),
    mm: document.getElementById('mm'),
    ss: document.getElementById('ss'),
    date: document.getElementById('dt'),
    scanHeadline: document.getElementById('scanHeadline'),
    scanSubline: document.getElementById('scanSubline'),
    readerStatus: document.getElementById('readerStatus'),
    verifyStatus: document.getElementById('verifyStatus'),
    ov: document.getElementById('ov'),
    successView: document.getElementById('successView'),
    errorView: document.getElementById('errorView'),
    sn: document.getElementById('sn'),
    sc: document.getElementById('sc'),
    so: document.getElementById('so'),
    errorMessage: document.getElementById('errorMessage'),
};

function pad(value) {
    return String(value).padStart(2, '0');
}

function tick() {
    const now = new Date();

    elements.hh.textContent = pad(now.getHours());
    elements.mm.textContent = pad(now.getMinutes());
    elements.ss.textContent = pad(now.getSeconds());
    elements.date.textContent = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
}

function formatClock(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(date.getTime())) {
        return '--:--:--';
    }

    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function clearOverlay() {
    clearTimeout(state.overlayTimer);
    elements.ov.classList.remove('show', 'success', 'error');
}

function showSuccess(person, timestamp) {
    clearTimeout(state.overlayTimer);
    elements.ov.classList.remove('error');
    elements.ov.classList.add('show', 'success');
    elements.sn.textContent = `${person.name} ${person.surname}`;
    elements.sc.textContent = person.class;
    elements.so.textContent = formatClock(timestamp);

    state.overlayTimer = window.setTimeout(clearOverlay, 2000);
}

function showError(message) {
    clearTimeout(state.overlayTimer);
    elements.ov.classList.remove('success');
    elements.ov.classList.add('show', 'error');
    elements.errorMessage.textContent = message || 'Errore sconosciuto';

    state.overlayTimer = window.setTimeout(clearOverlay, 2200);
}

function setServiceStatus(element, label, stateName) {
    element.className = 'service-status';

    if (stateName) {
        element.classList.add(stateName);
    }

    element.innerHTML = '<span class="dot"></span>' + label;
}

function updateIdleText() {
    if (!state.connection.reader && !state.connection.verify) {
        elements.scanHeadline.textContent = 'Connessione ai servizi in corso';
        elements.scanSubline.textContent = 'Il totem si attivera quando reader e verification saranno online';
        return;
    }

    if (!state.connection.reader) {
        elements.scanHeadline.textContent = 'Reader offline';
        elements.scanSubline.textContent = 'Il servizio verifica e pronto, ma il lettore non sta inviando scansioni';
        return;
    }

    if (!state.connection.verify) {
        elements.scanHeadline.textContent = 'Lettore attivo, verifica offline';
        elements.scanSubline.textContent = 'Le scansioni non possono essere verificate finche il servizio non torna online';
        return;
    }

    if (!state.verificationAuthReady) {
        elements.scanHeadline.textContent = 'Verifica in autenticazione';
        elements.scanSubline.textContent = 'Il servizio di verifica e connesso ma non ancora autorizzato';
        return;
    }

    elements.scanHeadline.textContent = 'Avvicina il documento al lettore';
    elements.scanSubline.textContent = 'CIE · Tessera sanitaria · Badge';
}

function setConnectionState(service, isConnected) {
    state.connection[service] = isConnected;

    if (service === 'verify' && !isConnected) {
        state.verificationAuthReady = false;
    }

    if (service === 'reader') {
        setServiceStatus(
            elements.readerStatus,
            isConnected ? 'Reader online' : 'Reader offline',
            isConnected ? 'online' : 'error',
        );
    } else {
        setServiceStatus(
            elements.verifyStatus,
            isConnected ? 'Verify online' : 'Verify offline',
            isConnected ? 'online' : 'error',
        );
    }

    updateIdleText();
}

function buildRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }

    return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function handleReaderEvent(payload) {
    if (payload.type === 'ready') {
        setConnectionState('reader', true);
        return;
    }

    if (payload.type !== 'scan') {
        return;
    }

    if (!payload.success) {
        showError(payload.error || 'Errore di lettura');
        return;
    }

    if (
        !state.connection.verify ||
        !state.verificationAuthReady ||
        !state.sockets.verify ||
        state.sockets.verify.readyState !== WebSocket.OPEN
    ) {
        showError('Servizio di verifica non disponibile');
        return;
    }

    const requestId = buildRequestId();
    state.pendingByRequestId.set(requestId, payload);

    state.sockets.verify.send(
        JSON.stringify({
            type: 'verify',
            requestId,
            code: payload.uuid,
        }),
    );
}

function handleVerificationEvent(payload) {
    if (payload.type === 'ready') {
        return;
    }

    if (payload.type === 'auth') {
        if (payload.success) {
            state.verificationAuthReady = true;
            setConnectionState('verify', true);
            return;
        }

        state.verificationAuthReady = false;
        setConnectionState('verify', false);
        showError(payload.error || 'Autenticazione verification fallita');
        return;
    }

    if (payload.type !== 'verification') {
        return;
    }

    const scanPayload = state.pendingByRequestId.get(payload.requestId);
    state.pendingByRequestId.delete(payload.requestId);

    if (!scanPayload) {
        return;
    }

    if (payload.success) {
        showSuccess(payload.person, payload.timestamp);
        return;
    }

    showError(payload.error || 'Codice non trovato');
}

function attachSocket(name, url, onMessage) {
    const socket = new WebSocket(url);
    state.sockets[name] = socket;

    socket.addEventListener('open', () => {
        if (name === 'verify') {
            state.verificationAuthReady = false;
            updateIdleText();
            socket.send(
                JSON.stringify({
                    type: 'auth',
                    token: state.config?.verificationToken || '',
                }),
            );
            return;
        }

        setConnectionState(name, true);
    });

    socket.addEventListener('message', (event) => {
        let payload;

        try {
            payload = JSON.parse(event.data);
        } catch (_error) {
            return;
        }

        onMessage(payload);
    });

    socket.addEventListener('close', () => {
        setConnectionState(name, false);
        window.setTimeout(() => attachSocket(name, url, onMessage), 1200);
    });

    socket.addEventListener('error', () => {
        setConnectionState(name, false);
    });
}

async function loadConfig() {
    const response = await fetch('/config.json', { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Config load failed (${response.status})`);
    }

    return response.json();
}

async function boot() {
    tick();
    window.setInterval(tick, 1000);

    setServiceStatus(elements.readerStatus, 'Reader offline', 'error');
    setServiceStatus(elements.verifyStatus, 'Verify offline', 'error');
    updateIdleText();

    try {
        state.config = await loadConfig();
    } catch (_error) {
        showError('Configurazione non disponibile');
        return;
    }

    attachSocket('reader', state.config.readerWsUrl, handleReaderEvent);
    attachSocket('verify', state.config.verificationWsUrl, handleVerificationEvent);
}

boot();
