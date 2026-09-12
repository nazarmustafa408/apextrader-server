 const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ACCESS_KEY = "apextrader_secret_2025";
const ADMIN_KEY  = "apextrader_admin_2025";

let settings = {
  zaincash: '0781 278 7307',
  mastercard: '7110 591 729',
  whatsapp: '+964 781 278 7307',
  adminKey: ADMIN_KEY,
  plans: {
    monthly:    { nameAr: 'شهري',       days: 30,    price: 100000,  maxAccounts: 1, enabled: true },
    quarterly:  { nameAr: 'ربع سنوي',   days: 90,    price: 280000,  maxAccounts: 1, enabled: true },
    semiannual: { nameAr: 'نصف سنوي',   days: 180,   price: 550000,  maxAccounts: 2, enabled: true },
    yearly:     { nameAr: 'سنوي',       days: 365,   price: 1000000, maxAccounts: 3, enabled: true },
    lifetime:   { nameAr: 'مدى الحياة', days: 36500, price: 2500000, maxAccounts: 5, enabled: true }
  }
};

let data = { account: null, orders: [], history: [], events: [], equityHistory: [], lastUpdate: null };
let licenses = {};
let payments = {};
let chats = {};
let paymentTokens = {};
let verificationCodes = {};
const rateLimit = {};

function checkRateLimit(ip, limit = 10, windowMs = 60000) {
  const now = Date.now();
  if (!rateLimit[ip]) rateLimit[ip] = [];
  rateLimit[ip] = rateLimit[ip].filter(t => now - t < windowMs);
  if (rateLimit[ip].length >= limit) return false;
  rateLimit[ip].push(now);
  return true;
}

setInterval(() => {
  const now = Date.now();
  Object.keys(paymentTokens).forEach(t => { if (paymentTokens[t].expiresAt < now) delete paymentTokens[t]; });
  Object.keys(verificationCodes).forEach(c => { if (verificationCodes[c].expiresAt < now) delete verificationCodes[c]; });
}, 2 * 60 * 1000);

function broadcast(msg) {
  const str = JSON.stringify(msg);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(str); });
}

function addEvent(type, message) {
  const event = { type, message, time: new Date().toISOString() };
  data.events.unshift(event);
  if (data.events.length > 50) data.events.pop();
  broadcast({ type: 'event', data: event });
}

app.post('/api/mt4/account', (req, res) => {
  if (req.body.key !== ACCESS_KEY) return res.status(403).json({ error: 'Invalid key' });
  data.account = req.body;
  data.lastUpdate = new Date().toISOString();
  if (req.body.equity && req.body.balance) {
    data.equityHistory.push({ time: Date.now(), equity: parseFloat(req.body.equity), balance: parseFloat(req.body.balance) });
    if (data.equityHistory.length > 200) data.equityHistory.shift();
  }
  broadcast({ type: 'account', data: data.account });
  res.status(200).json({ status: 'success' });
});

app.post('/api/mt4/orders', (req, res) => {
  if (req.body.key !== ACCESS_KEY) return res.status(403).json({ error: 'Invalid key' });
  const newOrders = req.body.orders || [];
  const prevTickets = new Set(data.orders.map(o => o.ticket));
  const newTickets = new Set(newOrders.map(o => o.ticket));
  newOrders.forEach(o => { if (!prevTickets.has(o.ticket)) addEvent('trade_open', o.type + ' ' + o.symbol + ' - ' + o.lots + ' lot'); });
  data.orders.forEach(o => {
    if (!newTickets.has(o.ticket)) {
      addEvent('trade_close', o.symbol + ' closed');
      data.history.unshift(Object.assign({}, o, { closeTime: new Date().toISOString() }));
      if (data.history.length > 100) data.history.pop();
    }
  });
  data.orders = newOrders;
  data.lastUpdate = new Date().toISOString();
  broadcast({ type: 'orders', data: data.orders });
  res.status(200).json({ status: 'success' });
});

app.get('/api/data', (req, res) => { res.json(data); });
[9/13/2026 12:13 AM] mustafa: app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), clients: wss.clients.size, account: data.account ? 'connected' : 'waiting', orders: data.orders.length });
});

app.get('/api/plans', (req, res) => {
  const activePlans = {};
  Object.entries(settings.plans).forEach(([key, plan]) => {
    if (plan.enabled) activePlans[key] = { nameAr: plan.nameAr, days: plan.days, price: plan.price, maxAccounts: plan.maxAccounts };
  });
  res.json(activePlans);
});

app.post('/api/subscribe', (req, res) => {
  const ip = req.ip;
  if (!checkRateLimit(ip, 5, 60000)) return res.status(429).json({ error: 'Too many requests' });
  const { plan, email, name, phone } = req.body;
  if (!settings.plans[plan] || !settings.plans[plan].enabled) return res.status(400).json({ error: 'Invalid plan' });
  if (!email  !name  !phone) return res.status(400).json({ error: 'Missing data' });

  const orderId = 'ORD-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const planData = settings.plans[plan];

  const order = {
    id: orderId, plan: plan, planName: planData.nameAr, email: email, name: name, phone: phone,
    amount: planData.price, days: planData.days, maxAccounts: planData.maxAccounts,
    status: 'pending', token: token, tokenExpiresAt: expiresAt, ip: ip,
    createdAt: new Date().toISOString()
  };
  payments[orderId] = order;
  paymentTokens[token] = { orderId: orderId, expiresAt: expiresAt, ip: ip, verified: false };
  res.json({ success: true, orderId: order.id, amount: order.amount, token: token });
});

app.post('/api/payment/request-code/:token', (req, res) => {
  const ip = req.ip;
  if (!checkRateLimit(ip, 3, 60000)) return res.status(429).json({ error: 'Too many requests' });
  const token = req.params.token;
  const info = paymentTokens[token];
  if (!info) return res.status(404).json({ error: 'Invalid link' });
  if (Date.now() > info.expiresAt) { delete paymentTokens[token]; return res.status(410).json({ error: 'Expired' }); }
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  verificationCodes[token] = { code: code, expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0 };
  console.log('Verification code: ' + code);
  res.json({ success: true, message: 'Code sent', expiresIn: 300 });
});

app.post('/api/payment/verify/:token', (req, res) => {
  const ip = req.ip;
  if (!checkRateLimit(ip, 10, 60000)) return res.status(429).json({ error: 'Too many attempts' });
  const token = req.params.token;
  const code = req.body.code;
  const tokenInfo = paymentTokens[token];
  if (!tokenInfo) return res.status(404).json({ error: 'Invalid link' });
  if (Date.now() > tokenInfo.expiresAt) return res.status(410).json({ error: 'Expired' });
  const codeInfo = verificationCodes[token];
  if (!codeInfo) return res.status(400).json({ error: 'Request code first' });
  if (Date.now() > codeInfo.expiresAt) { delete verificationCodes[token]; return res.status(410).json({ error: 'Code expired' }); }
  codeInfo.attempts++;
  if (codeInfo.attempts > 5) { delete verificationCodes[token]; delete paymentTokens[token]; return res.status(429).json({ error: 'Too many attempts' }); }
  if (codeInfo.code !== code) return res.status(400).json({ error: 'Wrong code', attemptsLeft: 5 - codeInfo.attempts });
  delete verificationCodes[token];
  tokenInfo.verified = true;
  const order = payments[tokenInfo.orderId];
  res.json({
    success: true,
    zaincash: settings.zaincash,
    mastercard: settings.mastercard,
    whatsapp: settings.whatsapp,
    amount: order.amount, orderId: order.id, customerName: order.name,
    expiresIn: Math.floor((tokenInfo.expiresAt - Date.now()) / 1000)
  });
});
[9/13/2026 12:13 AM] mustafa: app.post('/api/chat/start', (req, res) => {
  const ip = req.ip;
  if (!checkRateLimit(ip, 5, 60000)) return res.status(429).json({ error: 'Too many requests' });
  const { name, email, message } = req.body;
  const chatId = 'CHAT-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  chats[chatId] = { id: chatId, user: { name: name, email: email }, messages: [], status: 'open', createdAt: new Date().toISOString(), lastUpdate: new Date().toISOString() };
  if (message) addChatMessage(chatId, 'user', message);
  res.json({ success: true, chatId: chatId });
});

app.post('/api/chat/send', (req, res) => {
  const ip = req.ip;
  if (!checkRateLimit(ip, 30, 60000)) return res.status(429).json({ error: 'Too many requests' });
  const { chatId, message } = req.body;
  if (!chats[chatId]) return res.status(404).json({ error: 'Not found' });
  addChatMessage(chatId, 'user', message);
  res.json({ success: true });
});

app.get('/api/chat/:chatId', (req, res) => {
  const chat = chats[req.params.chatId];
  if (!chat) return res.status(404).json({ error: 'Not found' });
  res.json(chat);
});

app.post('/api/chat/admin/reply', (req, res) => {
  const { chatId, message, adminKey } = req.body;
  if (adminKey !== settings.adminKey) return res.status(403).json({ error: 'Invalid' });
  if (!chats[chatId]) return res.status(404).json({ error: 'Not found' });
  addChatMessage(chatId, 'admin', message);
  broadcast({ type: 'chat_message', chatId: chatId, message: { sender: 'admin', text: message, time: new Date().toISOString() } });
  res.json({ success: true });
});

app.get('/api/chat/admin/list', (req, res) => {
  const list = Object.values(chats).map(c => ({
    id: c.id, user: c.user, status: c.status,
    lastMessage: c.messages.length > 0 ? c.messages[c.messages.length - 1].text : '',
    lastUpdate: c.lastUpdate,
    unread: c.messages.filter(m => m.sender === 'user' && !m.read).length
  })).sort((a, b) => new Date(b.lastUpdate) - new Date(a.lastUpdate));
  res.json(list);
});

function addChatMessage(chatId, sender, text) {
  if (!chats[chatId]) return;
  const message = { id: crypto.randomBytes(4).toString('hex'), sender: sender, text: text, time: new Date().toISOString(), read: false };
  chats[chatId].messages.push(message);
  chats[chatId].lastUpdate = new Date().toISOString();
  broadcast({ type: 'chat_message', chatId: chatId, message: message });
}

app.post('/api/admin/activate', (req, res) => {
  const { orderId, adminKey, customPlan } = req.body;
  if (adminKey !== settings.adminKey) return res.status(403).json({ error: 'Invalid admin key' });
  const order = payments[orderId];
  const planKey = customPlan || (order ? order.plan : null);
  if (!planKey || !settings.plans[planKey]) return res.status(400).json({ error: 'Invalid plan' });
  const plan = settings.plans[planKey];
  const key = 'EXP-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
  const now = new Date();
  const expires = new Date(now.getTime() + plan.days * 86400000);
  licenses[key] = {
    key: key, plan: planKey, planName: plan.nameAr,
    orderId: orderId || null,
    customerName: order ? order.name : 'Admin',
    customerEmail: order ? order.email : '',
    customerPhone: order ? order.phone : '',
    createdAt: now.toISOString(), activatedAt: now.toISOString(),
    expiresAt: expires.toISOString(), status: 'active',
    mtAccount: null, maxAccounts: plan.maxAccounts
  };
  if (order) { order.status = 'paid'; order.paidAt = now.toISOString(); order.licenseKey = key; }
  res.json({ success: true, key: key, planName: plan.nameAr, expiresAt: licenses[key].expiresAt, customer: order ? order.name : 'Admin' });
});

app.post('/api/license/validate', (req, res) => {
  const { key, account } = req.body;
[9/13/2026 12:13 AM] mustafa: if (!key) return res.json({ valid: false, reason: 'No key' });
  const lic = licenses[key];
  if (!lic) return res.json({ valid: false, reason: 'Invalid key' });
  if (lic.status === 'banned') return res.json({ valid: false, reason: 'Banned' });
  if (new Date(lic.expiresAt) < new Date()) { lic.status = 'expired'; return res.json({ valid: false, reason: 'Expired' }); }
  if (!lic.mtAccount) lic.mtAccount = account;
  else if (lic.mtAccount !== account) return res.json({ valid: false, reason: 'Account mismatch' });
  const daysLeft = Math.ceil((new Date(lic.expiresAt) - new Date()) / 86400000);
  res.json({ valid: true, plan: lic.plan, planName: lic.planName, expiresAt: lic.expiresAt, daysLeft: daysLeft });
});

app.get('/api/admin/licenses', (req, res) => { res.json(Object.values(licenses)); });
app.get('/api/admin/orders', (req, res) => { res.json(Object.values(payments)); });

app.get('/api/admin/stats', (req, res) => {
  const all = Object.values(licenses);
  const allOrders = Object.values(payments);
  const totalRevenue = allOrders.filter(o => o.status === 'paid').reduce((s, o) => s + o.amount, 0);
  res.json({
    totalLicenses: all.length,
    activeLicenses: all.filter(l => l.status === 'active').length,
    expiredLicenses: all.filter(l => l.status === 'expired').length,
    bannedLicenses: all.filter(l => l.status === 'banned').length,
    totalOrders: allOrders.length,
    paidOrders: allOrders.filter(o => o.status === 'paid').length,
    pendingOrders: allOrders.filter(o => o.status === 'pending').length,
    totalRevenue: totalRevenue, totalRevenueFormatted: totalRevenue.toLocaleString() + ' IQD'
  });
});

app.get('/api/admin/settings', (req, res) => {
  const adminKey = req.query.adminKey;
  if (adminKey !== settings.adminKey) return res.status(403).json({ error: 'Invalid admin key' });
  res.json(settings);
});

app.post('/api/admin/settings/update', (req, res) => {
  const { adminKey, zaincash, mastercard, whatsapp, plans, newAdminKey } = req.body;
  if (adminKey !== settings.adminKey) return res.status(403).json({ error: 'Invalid admin key' });
  if (zaincash) settings.zaincash = zaincash;
  if (mastercard) settings.mastercard = mastercard;
  if (whatsapp) settings.whatsapp = whatsapp;
  if (plans) settings.plans = plans;
  if (newAdminKey) settings.adminKey = newAdminKey;
  res.json({ success: true, message: 'Settings saved' });
});

app.post('/api/admin/ban', (req, res) => {
  const { key, adminKey, action } = req.body;
  if (adminKey !== settings.adminKey) return res.status(403).json({ error: 'Invalid' });
  if (licenses[key]) { licenses[key].status = action === 'unban' ? 'active' : 'banned'; res.json({ success: true }); }
  else res.status(404).json({ error: 'Not found' });
});

app.post('/api/admin/extend', (req, res) => {
  const { key, adminKey, days } = req.body;
  if (adminKey !== settings.adminKey) return res.status(403).json({ error: 'Invalid' });
  if (licenses[key]) {
    const newDate = new Date(new Date(licenses[key].expiresAt).getTime() + days * 86400000);
    licenses[key].expiresAt = newDate.toISOString();
    licenses[key].status = 'active';
    res.json({ success: true, expiresAt: licenses[key].expiresAt });
  } else res.status(404).json({ error: 'Not found' });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/subscribe', (req, res) => res.sendFile(path.join(__dirname, 'public', 'subscribe.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));
app.get('/admin-chats', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-chats.html')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
 console.log('====================================');
  console.log('  ApexTrader Server v3.0');
  console.log('====================================');
  console.log('Port: ' + PORT);
  console.log('Access Key: ' + ACCESS_KEY);
  console.log('Admin Key: ' + settings.adminKey);
});
