require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const app = express();
const PORT = Number(process.env.PORT || 3000);

if (!process.env.SESSION_SECRET) console.warn('WARNING: Set SESSION_SECRET in .env before deployment.');
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(session({
  name: 'astra.sid',
  secret: process.env.SESSION_SECRET || 'local-development-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 25, standardHeaders: 'draft-7', legacyHeaders: false });

app.get('/api/status', (req, res) => res.json({ ok: true, aiConfigured: Boolean(process.env.AI_API_KEY), ownerLoggedIn: Boolean(req.session.owner) }));
app.post('/api/chat', apiLimiter, async (req, res) => {
  const { messages, mode } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 30) return res.status(400).json({ error: 'Please send a valid conversation (maximum 30 messages).' });
  const safeMessages = messages.filter(m => m && ['user','assistant'].includes(m.role) && typeof m.content === 'string').map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));
  if (!safeMessages.length || safeMessages[safeMessages.length - 1].role !== 'user') return res.status(400).json({ error: 'Your latest message is missing.' });
  if (!process.env.AI_API_KEY) return res.status(503).json({ error: 'Real AI is not configured yet. Add AI_API_KEY to your server .env file, then restart the app. No fake AI response was generated.' });
  const astrologyPrompt = 'You are Astra AI Astrology guide. Explain astrology as a traditional/cultural belief, not scientific certainty. Never claim guaranteed predictions. Ask for missing birth date, exact time, and birthplace when a chart calculation is requested. Do not invent precise planetary placements; say when reliable ephemeris/chart data is not connected. Reply in the language the user uses.';
  const generalPrompt = 'You are Astra AI, a helpful, clear assistant. Reply in the language the user uses, including Hindi and Hinglish. Be honest about uncertainty and capabilities.';
  try {
    const base = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${process.env.AI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.AI_MODEL || 'gpt-4o-mini', messages: [{ role: 'system', content: mode === 'astrology' ? astrologyPrompt : generalPrompt }, ...safeMessages], temperature: 0.7 })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(502).json({ error: data.error?.message || `AI provider returned HTTP ${response.status}. Check API settings.` });
    const answer = data.choices?.[0]?.message?.content;
    if (typeof answer !== 'string') return res.status(502).json({ error: 'AI provider returned an unexpected response.' });
    res.json({ answer });
  } catch (err) { console.error('AI request failed:', err.message); res.status(502).json({ error: 'Could not reach the AI provider. Check your server connection and API configuration.' }); }
});

app.post('/api/owner/login', apiLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const expectedUser = process.env.OWNER_USERNAME || 'owner';
  const expectedPassword = process.env.OWNER_PASSWORD;
  if (!expectedPassword) return res.status(503).json({ error: 'Set OWNER_PASSWORD in .env before using owner login.' });
  if (typeof username !== 'string' || typeof password !== 'string' || username !== expectedUser || password !== expectedPassword) return res.status(401).json({ error: 'Username or password is incorrect.' });
  req.session.owner = true;
  req.session.save(err => err ? res.status(500).json({ error: 'Could not create a secure session.' }) : res.json({ ok: true }));
});
app.get('/api/owner/me', (req, res) => res.json({ authenticated: Boolean(req.session.owner) }));
app.post('/api/owner/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/owner/overview', (req, res) => {
  if (!req.session.owner) return res.status(401).json({ error: 'Owner login required.' });
  res.json({ aiConfigured: Boolean(process.env.AI_API_KEY), model: process.env.AI_MODEL || 'gpt-4o-mini', plans: [
    { name: 'Free', price: 0, limit: 10 }, { name: 'Starter', price: 99, limit: 50 }, { name: 'Pro', price: 299, limit: 200 }, { name: 'Premium', price: 599, limit: 500 }
  ], note: 'Starter dashboard: plan data is illustrative and not yet connected to a payment provider or per-user quota database.' });
});
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Astra AI running at http://localhost:${PORT}`));
