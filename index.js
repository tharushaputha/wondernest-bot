const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const express = require('express'); // <-- අලුතෙන් එකතු කලේ

const app = express(); // <-- අලුතෙන් එකතු කලේ
const PORT = process.env.PORT || 8000; // <-- අලුතෙන් එකතු කලේ

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('QR Code ලැබුනා, Render Logs වලින් scan කරන්න:');
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
        if (!msg.message) return;
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!messageText) return;
        console.log(`New message from ${msg.key.remoteJid}: "${messageText}"`);

        if (messageText.toLowerCase() === 'hi') {
            await sock.sendMessage(msg.key.remoteJid, { text: 'Hello from Render!' });
        }
    });
}

// Bot connection එක පටන් ගන්නවා
connectToWhatsApp();

// Render එකට "Healthy" කියලා පෙන්නන්න server එක run කරනවා
app.get('/', (req, res) => {
    res.send('WhatsApp Bot is running!');
});

app.listen(PORT, () => {
    console.log(`Server is running on port: ${PORT}`);
});