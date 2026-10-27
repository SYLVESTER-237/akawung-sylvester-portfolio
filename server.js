// Spark Portfolio server. Start with: npm start   (then open http://localhost:3000)
const express = require('express'), multer = require('multer'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PASSWORD = process.env.ADMIN_PASSWORD || 'sparko';   // <-- CHANGE THIS
const PORT = process.env.PORT || 3000;
const UP = path.join(__dirname, 'uploads'), DATA = path.join(__dirname, 'data.json');
fs.mkdirSync(UP, { recursive: true });

const defaults = { name: 'AKAWUNG SYLVESTER', tagline: 'Graphic Designer · Yaoundé, Cameroon', cover: '', profile: '', designs: [] };
const load = () => { try { return { ...defaults, ...JSON.parse(fs.readFileSync(DATA, 'utf8')) }; } catch { return { ...defaults }; } };
const save = d => fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
const rm = f => { if (f && path.basename(f) === f) fs.unlink(path.join(UP, f), () => {}); };

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const upload = multer({
  storage: multer.diskStorage({ destination: UP, filename: (r, f, cb) => cb(null, crypto.randomBytes(8).toString('hex') + EXT[f.mimetype]) }),
  fileFilter: (r, f, cb) => EXT[f.mimetype] ? cb(null, true) : cb(new Error('Only JPG, PNG, WEBP or GIF images are allowed.')),
  limits: { fileSize: 8 * 1024 * 1024 }
}).single('p');
const up = (req, res, next) => upload(req, res, e => e ? res.status(400).json({ error: e.code === 'LIMIT_FILE_SIZE' ? 'Image is larger than 8 MB.' : e.message }) : next());

const sessions = new Set();
const cookie = req => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sid='))?.slice(4);
const authed = req => sessions.has(cookie(req));
const auth = (req, res, next) => authed(req) ? next() : res.status(401).json({ error: 'Please log in again.' });
const same = (a, b) => { const h = x => crypto.createHash('sha256').update(String(x)).digest(); return crypto.timingSafeEqual(h(a), h(b)); };

const app = express();
app.use(express.json());
app.use('/uploads', express.static(UP));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/data', (req, res) => res.json(load()));
app.get('/api/me', (req, res) => res.json({ in: authed(req) }));
app.post('/api/login', (req, res) => {
  if (!same(req.body.password || '', PASSWORD)) return res.status(401).json({ error: 'Wrong password.' });
  const sid = crypto.randomBytes(24).toString('hex'); sessions.add(sid);
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Strict; Path=/`); res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { sessions.delete(cookie(req)); res.json({ ok: true }); });

app.post('/api/text', auth, (req, res) => {
  const d = load(); d.name = String(req.body.name || d.name).trim(); d.tagline = String(req.body.tagline || '').trim(); save(d); res.json({ ok: true });
});
['cover', 'profile'].forEach(k => app.post('/api/' + k, auth, up, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an image first.' });
  const d = load(); rm(d[k]); d[k] = req.file.filename; save(d); res.json({ ok: true });
}));
app.post('/api/design', auth, up, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an image first.' });
  const d = load();
  d.designs.push({ id: crypto.randomBytes(4).toString('hex'), file: req.file.filename, title: (req.body.title || '').trim() || 'Untitled', category: (req.body.category || '').trim() || 'Design' });
  save(d); res.json({ ok: true });
});
app.delete('/api/design/:id', auth, (req, res) => {
  const d = load(), x = d.designs.find(v => v.id === req.params.id);
  if (x) { rm(x.file); d.designs = d.designs.filter(v => v !== x); save(d); }
  res.json({ ok: true });
});
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.listen(PORT, () => console.log(`\nWebsite: http://localhost:${PORT}\nAdmin:   http://localhost:${PORT}/admin\n(Close this window to stop the site)\n`));
