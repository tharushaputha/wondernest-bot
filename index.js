const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('QR Code ලැබුනා, Koyeb Logs වලින් හෝ المحليව scan කරන්න:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection එක වැසුනා: ', lastDisconnect.error, ', නැවත සම්බන්ධ වෙනවාද: ', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('WhatsApp සාර්ථකව සම්බන්ධ විය!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message) return; // Message එකක් නැත්නම් මුකුත් කරන්න එපා

        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!messageText) return; // Message එකේ text එකක් නැත්නම් මුකුත් කරන්න එපා

        console.log(`New message from ${msg.key.remoteJid}: "${messageText}"`);

        // මෙතන තමයි අපි bot ගේ menu එක හදන්න පටන් ගන්නේ
        if (messageText.toLowerCase() === 'hi') {
            await sock.sendMessage(msg.key.remoteJid, { text: 'Hello there!' });
        }
    });
}

connectToWhatsApp();