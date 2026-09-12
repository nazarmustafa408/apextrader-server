if (!lic) return res.json({ valid: false, reason: 'Invalid key' });
  if (lic.status === 'banned') return res.json({ valid: false, reason: 'Banned' });
  if (new Date(lic.expiresAt) < new Date()) { lic.status = 'expired'; return res.json({ valid: false, reason: 'Expired' }); }
  if (!lic.mtAccount) lic.mtAccount = account;
  else if (lic.mtAccount !== account) return res.json({ valid: false, reason: 'Account mismatch' });
  const daysLeft = Math.ceil((new Date(lic.expiresAt) - new Date()) / 86400000);
  res.json({ valid: true, plan: lic.plan, planName: lic.planName, expiresAt: lic.expiresAt, daysLeft });
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
    totalRevenue, totalRevenueFormatted: totalRevenue.toLocaleString() + ' IQD'
  });
});

app.get('/api/admin/settings', (req, res) => {
  const { adminKey } = req.query;
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
  res.json({ success: true, message: 'تم حفظ الإعدادات' });
});

app.post('/api/admin/ban', (req, res) => {
  const { key, adminKey, action } = req.body;
  if (adminKey !== settings.adminKey) return res.status(403).json({ error: 'Invalid' });
  if (licenses[key]) {
    licenses[key].status = action === 'unban' ? 'active' : 'banned';
    res.json({ success: true });
  } else res.status(404).json({ error: 'Not found' });
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
server.listen(PORT, () => {
  console.log('════════════════════════════════════════════');
  console.log('   ⚡ ApexTrader Server v3.0');
  console.log('════════════════════════════════════════════');
  console.log(🚀 Port: ${PORT});
  console.log(🔑 Access Key: ${ACCESS_KEY});
  console.log(👑 Admin Key: ${settings.adminKey});
  console.log('');
});
