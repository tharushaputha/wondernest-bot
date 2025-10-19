const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ===================================================================================
// ❗️❗️❗️ API KEYS & SECRETS: මේ කොටස හරියටම පුරවන්න ❗️❗️❗️
// ===================================================================================
const SUPABASE_URL = "https://geahwtilgbxlviwnbrcz.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIINiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlYWh3dGlsZ2J4bHZpd25icmN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA4MTU4NzUsImV4cCI6MjA3NjM5MTg3NX0.eU5_re2SQNf_ysg5n-BiLORQimOOg5p-CX2uAaRbbrY";
const HCTI_API_USER_ID = "c55fa120-18bc-4c7b-9cd3-f2580f44441d";
const HCTI_API_KEY = "1d850262-610c-4af3-b27e-617506f87e28";
const GEMINI_API_KEY = "AIzaSyBQpw3aKpJzyQCAT2vUUCdDO4m3Loe9GeM"; // <-- මෙතනට ඔයාගේ අලුත් Gemini Key එක දාන්න
// ===================================================================================

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const app = express();
const PORT = process.env.PORT || 8000;
const SESSION_EXPIRY_MINUTES = 15;
const DELIVERY_CHARGE = 400;

console.log('Bot එක පටන් ගන්නවා...');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--single-process', '--disable-gpu'],
    },
});

client.on('qr', qr => {
    console.log('QR Code ලැබුනා, Replit Console එකෙන් scan කරන්න:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => console.log('Client සම්බන්ධයි! Bot වැඩ කරන්න ලෑස්තියි.'));

async function updateUserState(userId, state, orderDetails = {}) {
    const { error } = await supabase.from('conversations').upsert({ user_id: userId, state: state, order_details: orderDetails }, { onConflict: 'user_id' });
    if (error) console.error('Error updating user state:', error);
}

async function deleteUserState(userId) {
    const { error } = await supabase.from('conversations').delete().eq('user_id', userId);
    if (error) console.error('Error deleting user state:', error);
}

function generateBillHtml(orderDetails) {
    const { selected_product, customer_name, address, city } = orderDetails;
    const totalAmount = parseFloat(selected_product.price) + DELIVERY_CHARGE;
    const currentDate = new Date().toLocaleDateString('en-CA');
    return `<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap');body{font-family:'Poppins',sans-serif;margin:0;padding:25px;background-color:#f9f9f9;width:350px;}.invoice-box{background:white;padding:20px;border-radius:10px;box-shadow:0 0 15px rgba(0,0,0,0.08);}h1{font-size:24px;color:#333;text-align:center;margin-bottom:5px;}.shop-name{font-size:16px;color:#555;text-align:center;margin-bottom:20px;}.details{margin-bottom:20px;font-size:12px;}.details p{margin:2px 0;color:#444;}.item-table{width:100%;border-collapse:collapse;margin-bottom:15px;}.item-table th,.item-table td{padding:8px;font-size:12px;text-align:left;border-bottom:1px solid #eee;}.item-table th{background:#f2f2f2;font-weight:600;}.total-section{text-align:right;margin-top:15px;}.total-section p{margin:4px 0;font-size:13px;}.total-section .grand-total{font-weight:600;font-size:14px;color:#000;}.footer{text-align:center;margin-top:20px;font-size:11px;color:#888;}</style></head><body><div class="invoice-box"><h1>WonderNest</h1><p class="shop-name">Order Invoice</p><div class="details"><p><b>Billed To:</b> ${customer_name}</p><p><b>Address:</b> ${address}, ${city}</p><p><b>Date:</b> ${currentDate}</p></div><table class="item-table"><thead><tr><th>Item</th><th>Price</th></tr></thead><tbody><tr><td>${selected_product.name}</td><td>Rs. ${selected_product.price.toFixed(2)}</td></tr></tbody></table><div class="total-section"><p>Subtotal: Rs. ${selected_product.price.toFixed(2)}</p><p>Delivery Fee: Rs. ${DELIVERY_CHARGE.toFixed(2)}</p><p class="grand-total">TOTAL: Rs. ${totalAmount.toFixed(2)}</p></div><p class="footer">Thank you for your order!</p></div></body></html>`;
}

async function getProvinceFromGemini(city) {
    try {
        const prompt = `In which province of Sri Lanka is the city "${city}" located? Answer only with the province name in English (e.g., "Western", "Central", "Southern"). If you don't know, answer "Unknown".`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().toLowerCase();

        if (text.includes("western")) {
            return "Western";
        } else {
            return "Other";
        }
    } catch (error) {
        console.error("Gemini API Error:", error);
        return "Unknown"; // Return a default value on error
    }
}

client.on('message', async (message) => {
    const user_id = message.from;
    const messageText = message.body ? message.body.trim().toLowerCase() : '';
    const originalMessageText = message.body ? message.body.trim() : '';

    const { data: userData } = await supabase.from('conversations').select('*').eq('user_id', user_id).single();
    
    let currentState = 'main_menu';
    let currentOrderDetails = {};
    let sessionExpired = false;

    if (userData) {
        const lastUpdated = new Date(userData.updated_at);
        const diffMinutes = (new Date().getTime() - lastUpdated.getTime()) / 60000;
        if (diffMinutes >= SESSION_EXPIRY_MINUTES) {
            sessionExpired = true;
        } else {
            currentState = userData.state;
            currentOrderDetails = userData.order_details || {};
        }
    }

    console.log(`User: ${user_id}, State: ${currentState}, Expired: ${sessionExpired}, Message: "${originalMessageText}"`);

    const mainMenu = "1️⃣ *ඇණවුමක් කිරීමට*\n" +
                     "2️⃣ *බෙදාහැරීමේ දිනය දැනගැනීමට*\n" +
                     "3️⃣ *ගෙවීම් ක්‍රම*\n" +
                     "4️⃣ *වෙනත් තොරතුරු*\n" +
                     "5️⃣ *නියෝජිතයෙකු හා සම්බන්ධ වීමට*";
    
    async function sendMainMenu(isWelcome = false) {
        let header = "*ප්‍රධාන මෙනුව වෙත නැවත පැමිණියා.*\n\n";
        if (isWelcome) header = "👋 *WonderNest වෙත ඔබව සාදරයෙන් පිළිගනිමු!*\n\n";
        if (sessionExpired) header = "කාලය ඉකුත් වූ නිසා, අපි නැවත මුල සිට පටන් ගනිමු!\n\n";
        await client.sendMessage(user_id, `${header}ඔබට අවශ්‍ය සේවාව තේරීමට අදාළ අංකය අප වෙත type කර එවන්න.\n\n${mainMenu}`);
        await updateUserState(user_id, 'main_menu', {});
    }

    if (sessionExpired) return await sendMainMenu();
    if (['0', 'cancel', 'back'].includes(messageText)) return await sendMainMenu();
    const welcomeCommands = ['hi', 'hello', 'ආයුබෝවන්', 'menu', '/start', 'wondernest හා සම්බන්ධ වූවාට සුභ දවසක්'];
    if (welcomeCommands.includes(messageText)) return await sendMainMenu(true);
    
    switch (currentState) {
        case 'main_menu':
            switch (originalMessageText) {
                case '1':
                    const { data: products, error } = await supabase.from('products').select('*').order('id');
                    if (error || !products || products.length === 0) {
                        await client.sendMessage(user_id, "සමාවන්න, භාණ්ඩ ලැයිස්තුව ලබාගැනීමේදී දෝෂයක් ඇතිවිය.");
                        return await sendMainMenu();
                    }
                    let productListMsg = "✨ *WonderNest භාණ්ඩ ලැයිස්තුව* ✨\n\n";
                    products.forEach((p, i) => productListMsg += `*${i + 1}.* ${p.name}\n*මිල:* රු. ${p.price}.00\n\n`);
                    productListMsg += "ඔබට ඇණවුම් කිරීමට අවශ්‍ය භාණ්ඩයේ අංකය අප වෙත type කර එවන්න.\n\n*0.* ප්‍රධාන මෙනුවට යෑමට.";
                    await client.sendMessage(user_id, productListMsg);
                    await updateUserState(user_id, 'ordering_item', { products });
                    break;
                case '2':
                    await client.sendMessage(user_id, "බෙදාහැරීමේ දිනය දැනගැනීමට, කරුණාකර ඔබගේ නගරය (City) සඳහන් කරන්න.\n\n*0.* ප්‍රධාන මෙනුවට යෑමට.");
                    await updateUserState(user_id, 'awaiting_city_delivery');
                    break;
                case '3':
                    await client.sendMessage(user_id, "💳 *ගෙවීම් ක්‍රම*\n\n💵 *Cash on Delivery (COD):* භාණ්ඩය ලැබුණු පසු මුදල් ගෙවන්න.\n\n🏦 *Bank Transfer:* අපගේ බැංකු ගිණුමට මුදල් තැන්පත් කර රිසිට්පත එවන්න.");
                    await sendMainMenu();
                    break;
                case '4':
                    await client.sendMessage(user_id, "කරුණාකර ඔබගේ ප්‍රශ්නය මෙහි type කර එවන්න.\n\n*0.* ප්‍රධාන මෙනුවට යෑමට.");
                    await updateUserState(user_id, 'awaiting_agent_question');
                    break;
                case '5':
                    await client.sendMessage(user_id, "කරුණාකර මදක් රැඳී සිටින්න, අපගේ නියෝජිතයෙකු ඔබව දැන් සම්බන්ධ කරගනු ඇත.");
                    console.log(`AGENT ALERT: User ${user_id} requested an agent.`);
                    await deleteUserState(user_id);
                    break;
                default:
                    await client.sendMessage(user_id, "සමාවන්න, මට තේරුණේ නැත. කරුණාකර වලංගු විකල්පයක් (1-5) තෝරන්න.");
                    break;
            }
            break;

        case 'ordering_item':
            const itemNumber = parseInt(messageText) - 1;
            const products = currentOrderDetails.products;
            if (isNaN(itemNumber) || itemNumber < 0 || itemNumber >= products.length) {
                return await client.sendMessage(user_id, "කරුණාකර භාණ්ඩ ලැයිස්තුවෙන් නිවැරදි අංකයක් type කර එවන්න.\n\n*0.* ප්‍රධාන මෙනුවට යෑමට.");
            }
            const selectedProduct = products[itemNumber];
            currentOrderDetails.selected_product = selectedProduct;
            let detailsMsg = `*${selectedProduct.name}*\n\n*විස්තරය:* ${selectedProduct.description}\n\n*භාණ්ඩයේ මිල:* රු. ${selectedProduct.price}.00\n*බෙදාහැරීමේ ගාස්තුව:* රු. ${DELIVERY_CHARGE}.00\n---------------------------------\n*ගෙවිය යුතු මුළු මුදල:* රු. ${parseFloat(selectedProduct.price) + DELIVERY_CHARGE}.00\n\nමෙම භාණ්ඩය ඇණවුම් කිරීමට ඔබ කැමතිද? (ඔව් / නැහැ)\n\n*0.* ප්‍රධාන මෙනුවට යෑමට.`;
            await client.sendMessage(user_id, detailsMsg);
            await updateUserState(user_id, 'awaiting_confirmation', currentOrderDetails);
            break;

        case 'awaiting_confirmation':
            if (['ඔව්', 'ow'].includes(messageText)) {
                await client.sendMessage(user_id, "කරුණාකර ඔබට ගෙවීම් කිරීමට අවශ්‍ය ක්‍රමය තෝරන්න:\n\n1️⃣ *Cash on Delivery*\n2️⃣ *Bank Transfer*\n\n*0.* ප්‍රධාන මෙනුවට යෑමට.");
                await updateUserState(user_id, 'awaiting_payment_method', currentOrderDetails);
            } else if (['නැහැ', 'naha'].includes(messageText)) {
                await client.sendMessage(user_id, "ඇණවුම අවලංගු කරන ලදී.");
                await sendMainMenu();
            } else await client.sendMessage(user_id, "කරුණාකර 'ඔව්' හෝ 'නැහැ' ලෙස type කර එවන්න.\n\n*0.* ප්‍රධාන මෙනුවට යෑමට.");
            break;

        case 'awaiting_payment_method':
            if (messageText === '1' || messageText.includes('cash')) {
                currentOrderDetails.payment_method = 'Cash on Delivery';
                await client.sendMessage(user_id, "🚚 ඔබගේ ඇණවුම තහවුරු කිරීමට, කරුණාකර පහත විස්තර *එකම message එකකින්*, පේළි 5කින් ලබාදෙන්න:\n\nFull Name\nAddress\nMobile Number\nCity\nDistrict\n\n*උදාහරණයක්:*\nTharusha Dulshan\nNo.123, Main Street, Kandy\n0771234567\nKandy\nKandy\n\n*0.* ප්‍රධාන මෙනුවට යෑමට.");
                await updateUserState(user_id, 'awaiting_address', currentOrderDetails);
            } else if (messageText === '2' || messageText.includes('bank')) {
                await client.sendMessage(user_id, "🏦 *බැංකු ගෙවීම් විස්තර*\n\nBank: [Your Bank Name]\nAccount: [Your Account Number]\nName: WonderNest\n\nමුදල් තැන්පත් කර රිසිට්පතේ ඡායාරූපයක් එවන්න. අපගේ නියෝජිතයෙකු ඔබව සම්බන්ධ කරගනු ඇත.");
                await deleteUserState(user_id);
            } else await client.sendMessage(user_id, "කරුණාකර නිවැරදි ගෙවීම් ක්‍රමයක් තෝරන්න ('1' හෝ '2').\n\n*0.* ප්‍රධාන මෙනුවට යෑමට.");
            break;

        case 'awaiting_address':
            const addressLines = originalMessageText.split('\n');
            if (addressLines.length >= 5) {
                currentOrderDetails.customer_name = addressLines[0];
                currentOrderDetails.address = addressLines[1];
                currentOrderDetails.mobile_number = addressLines[2];
                currentOrderDetails.city = addressLines[3];
                currentOrderDetails.district = addressLines[4];
                let confirmationMsg = "*ඔබගේ විස්තර තහවුරු කරන්න*\n\n";
                confirmationMsg += `*නම:* ${addressLines[0]}\n*ලිපිනය:* ${addressLines[1]}\n*දුරකථන අංකය:* ${addressLines[2]}\n*නගරය:* ${addressLines[3]}\n*දිස්ත්‍රික්කය:* ${addressLines[4]}\n\n`;
                confirmationMsg += "ඉහත විස්තර නිවැරදි නම් 'ඔව්' ලෙස type කර එවන්න. වෙනස් කිරීමට අවශ්‍ය නම් 'නැහැ' ලෙස type කර එවන්න.";
                await client.sendMessage(user_id, confirmationMsg);
                await updateUserState(user_id, 'awaiting_final_confirmation', currentOrderDetails);
            } else await client.sendMessage(user_id, "කරුණාකර ඉහත ආකෘතියට අනුව සියලුම විස්තර (අවම වශයෙන් පේළි 5ක්) නිවැරදිව එකම message එකකින් type කර එවන්න.\n\n*0.* ප්‍රධාන මෙනුවට යෑමට.");
            break;
        
        case 'awaiting_final_confirmation':
            if (['ඔව්', 'ow'].includes(messageText)) {
                await client.sendMessage(user_id, "ඔබගේ ඇණවුම අප වෙත ලැබී ඇත. Billපත සකසමින් පවතී, කරුණාකර මොහොතක් රැඳී සිටින්න...");
                try {
                    const billHtml = generateBillHtml(currentOrderDetails);
                    const response = await axios.post('https://hcti.io/v1/image', { html: billHtml }, { auth: { username: HCTI_API_USER_ID, password: HCTI_API_KEY } });
                    const media = await MessageMedia.fromUrl(response.data.url);
                    await client.sendMessage(user_id, media, { caption: `✅ *ඇණවුම සාර්ථකයි!* ✅\n\nඔබගේ බිල්පත ඉහත දැක්වේ. බෙදාහැරීම දින 3-4ක් ඇතුළත සිදු වනු ඇත. අප හා සම්බන්ධ වූවාට ස්තූතියි!` });
                } catch (billError) {
                    console.error("Bill generation failed:", billError.response ? billError.response.data : billError.message);
                    await client.sendMessage(user_id, "සමාවන්න, බිල්පත සෑදීමේදී දෝෂයක් ඇතිවිය. නමුත් ඔබගේ ඇණවුම අප වෙත ලැබී ඇත. අපගේ නියෝජිතයෙකු ඔබව සම්බන්ධ කරගනු ඇත.");
                }
                await deleteUserState(user_id);
            } else if (['නැහැ', 'naha'].includes(messageText)) {
                await client.sendMessage(user_id, "කරුණාකර ඔබගේ විස්තර නැවත නිවැරදිව type කර එවන්න.\n\nFull Name\nAddress\nMobile Number\nCity\nDistrict\n\n*0.* ප්‍රධාන මෙනුවට යෑමට.");
                await updateUserState(user_id, 'awaiting_address', currentOrderDetails);
            } else await client.sendMessage(user_id, "කරුණාකර 'ඔව්' හෝ 'නැහැ' ලෙස type කර එවන්න.\n\n*0.* ප්‍රධාන මෙනුවට යෑමට.");
            break;
            
        case 'awaiting_city_delivery':
            const province = await getProvinceFromGemini(originalMessageText);
            let deliveryEstimate;
            if (province === 'Western') {
                deliveryEstimate = `*${originalMessageText}* නගරය බස්නාහිර පළාතට අයත් වේ.\n🚚 බස්නාහිර පළාත සඳහා දින 1-4ක් ඇතුළත බෙදාහැරීම සිදු වේ.`;
            } else {
                deliveryEstimate = `*${originalMessageText}* නගරය සඳහා, 🚚 සාමාන්‍යයෙන් දින 3-5ක් ඇතුළත බෙදාහැරීම සිදු වේ.`;
            }
            await client.sendMessage(user_id, deliveryEstimate);
            await sendMainMenu();
            break;

        case 'awaiting_agent_question':
            await client.sendMessage(user_id, "ඔබගේ ප්‍රශ්නය අප වෙත ලැබුණි. අපගේ නියෝජිතයෙකු ඔබව ඉක්මනින් සම්බන්ධ කරගනු ඇත. ස්තූතියි!");
            console.log(`AGENT ALERT: User ${user_id} asked: "${originalMessageText}"`);
            await deleteUserState(user_id);
            break;
    }
});

client.initialize();
app.get('/', (req, res) => res.send('WhatsApp Bot is running and ready!'));
app.listen(PORT, '0.0.0.0', () => console.log(`Server is running on port: ${PORT}`));
