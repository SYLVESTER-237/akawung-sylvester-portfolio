
 // Spark Portfolio server
// Start locally with: npm start

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.ADMIN_PASSWORD || 'sparko';
const IS_PRODUCTION =
  process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
const DATA_FILE = path.join(__dirname, 'data.json');

// =====================================================
// POSTGRESQL DATABASE
// Neon on Vercel; JSON file fallback for local development
// =====================================================

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost')
        ? false
        : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000
    })
  : null;

const defaults = {
  name: 'AKAWUNG SYLVESTER',
  tagline: 'Graphic Designer · Yaoundé, Cameroon',
  cover: '',
  coverPublicId: '',
  profile: '',
  profilePublicId: '',
  designs: []
};

let databaseReady;

async function ensureDatabase() {
  if (!pool) return;

  if (!databaseReady) {
    databaseReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS portfolio_data (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      let initialData = { ...defaults };

      try {
        const localData = JSON.parse(
          fs.readFileSync(DATA_FILE, 'utf8')
        );

        initialData = { ...defaults, ...localData };
      } catch (_) {
        // If data.json does not exist, use the defaults.
      }

      await pool.query(
        `INSERT INTO portfolio_data (id, data)
         VALUES (1, $1::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [JSON.stringify(initialData)]
      );
    })().catch(error => {
      databaseReady = null;
      throw error;
    });
  }

  await databaseReady;
}

async function loadData() {
  if (pool) {
    await ensureDatabase();

    const result = await pool.query(
      'SELECT data FROM portfolio_data WHERE id = 1'
    );

    return {
      ...defaults,
      ...(result.rows[0]?.data || {})
    };
  }

  try {
    const saved = JSON.parse(
      fs.readFileSync(DATA_FILE, 'utf8')
    );

    return { ...defaults, ...saved };
  } catch (_) {
    return { ...defaults };
  }
}

async function saveData(data) {
  if (pool) {
    await ensureDatabase();

    await pool.query(
      `INSERT INTO portfolio_data (id, data, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id)
       DO UPDATE SET
         data = EXCLUDED.data,
         updated_at = NOW()`,
      [JSON.stringify(data)]
    );

    return true;
  }

  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(data, null, 2)
    );

    return true;
  } catch (error) {
    console.error('Could not save data:', error.message);
    return false;
  }
}

// =====================================================
// CLOUDINARY CONFIGURATION
// =====================================================

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'spark-portfolio',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    resource_type: 'image'
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024
  },
  fileFilter: (req, file, callback) => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      return callback(null, true);
    }

    return callback(
      new Error('Only JPG, PNG, WEBP or GIF images are allowed.')
    );
  }
}).single('p');

function up(req, res, next) {
  upload(req, res, error => {
    if (!error) return next();

    console.error('Upload error:', error.message || error);

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'Image is larger than 8 MB.'
      });
    }

    return res.status(400).json({
      error: error.message || 'Image upload failed. Check Cloudinary settings.'
    });
  });
}

async function deleteCloudinaryImage(publicId) {
  if (!publicId) return;

  try {
    const result = await cloudinary.uploader.destroy(
      publicId,
      { resource_type: 'image' }
    );

    console.log(
      'Cloudinary delete result:',
      publicId,
      result?.result || 'completed'
    );
  } catch (error) {
    console.error('Cloudinary delete error:', error.message);
  }
}

// =====================================================
// AUTHENTICATION
// Stateless signed cookies work across Vercel instances
// =====================================================

const SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET || PASSWORD;

function signSession(token) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(token)
    .digest('hex');
}

function getCookie(req) {
  const cookies = req.headers.cookie || '';

  const entry = cookies
    .split(';')
    .map(item => item.trim())
    .find(item => item.startsWith('sid='));

  if (!entry) return '';

  try {
    return decodeURIComponent(entry.slice(4));
  } catch (_) {
    return '';
  }
}

function isAuthenticated(req) {
  const value = getCookie(req);

  if (!value) return false;

  const parts = value.split('.');

  if (parts.length !== 2) return false;

  const [token, signature] = parts;

  if (!token || !signature) return false;

  const expected = signSession(token);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function auth(req, res, next) {
  if (isAuthenticated(req)) return next();

  return res.status(401).json({
    error: 'Please log in again.'
  });
}

function passwordMatches(a, b) {
  const hash = value =>
    crypto.createHash('sha256').update(String(value)).digest();

  return crypto.timingSafeEqual(hash(a), hash(b));
}

function setSessionCookie(res, value, maxAge) {
  const secure = IS_PRODUCTION ? '; Secure' : '';

  res.setHeader(
    'Set-Cookie',
    `sid=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`
  );
}

// =====================================================
// EXPRESS SETUP
// =====================================================

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use(express.static(path.join(__dirname, 'public')));

// =====================================================
// PUBLIC PORTFOLIO DATA
// =====================================================

app.get('/api/data', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await loadData());
  } catch (error) {
    next(error);
  }
});

// =====================================================
// CHECK LOGIN
// =====================================================

app.get('/api/me', (req, res) => {
  res.json({
    in: isAuthenticated(req)
  });
});

// =====================================================
// LOGIN
// =====================================================

app.post('/api/login', (req, res) => {
  const password = req.body?.password || '';

  if (!passwordMatches(password, PASSWORD)) {
    return res.status(401).json({
      error: 'Wrong password.'
    });
  }

  const token = crypto.randomBytes(24).toString('hex');

  setSessionCookie(
    res,
    `${token}.${signSession(token)}`,
    60 * 60 * 12
  );

  return res.json({ ok: true });
});

// =====================================================
// LOGOUT
// =====================================================

app.post('/api/logout', (req, res) => {
  setSessionCookie(res, '', 0);

  res.json({ ok: true });
});

// =====================================================
// SAVE NAME AND TAGLINE
// =====================================================

app.post('/api/text', auth, async (req, res, next) => {
  try {
    const data = await loadData();

    data.name = String(
      req.body?.name ?? data.name
    ).trim();

    data.tagline = String(
      req.body?.tagline ?? data.tagline
    ).trim();

    if (!(await saveData(data))) {
      return res.status(500).json({
        error: 'Could not save portfolio details.'
      });
    }

    return res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// =====================================================
// COVER AND PROFILE IMAGE UPLOAD
// =====================================================

['cover', 'profile'].forEach(type => {
  app.post(
    '/api/' + type,
    auth,
    up,
    async (req, res, next) => {
      try {
        if (!req.file) {
          return res.status(400).json({
            error: 'Choose an image first.'
          });
        }

        const imageUrl =
          req.file.path ||
          req.file.secure_url ||
          req.file.url ||
          '';

        const publicId =
          req.file.filename ||
          req.file.public_id ||
          '';

        if (!imageUrl || !publicId) {
          console.error(
            'Incomplete Cloudinary file object:',
            Object.keys(req.file)
          );

          return res.status(502).json({
            error: 'Cloudinary did not return the image URL. Check Cloudinary configuration.'
          });
        }

        const data = await loadData();
        const oldPublicId = data[type + 'PublicId'];

        data[type] = imageUrl;
        data[type + 'PublicId'] = publicId;

        if (!(await saveData(data))) {
          return res.status(500).json({
            error: 'Image uploaded but could not save portfolio data.'
          });
        }

        if (oldPublicId && oldPublicId !== publicId) {
          await deleteCloudinaryImage(oldPublicId);
        }

        return res.json({
          ok: true,
          url: imageUrl
        });
      } catch (error) {
        next(error);
      }
    }
  );
});

// =====================================================
// ADD DESIGN
// =====================================================

app.post('/api/design', auth, up, async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Choose an image first.'
      });
    }

    const imageUrl =
      req.file.path ||
      req.file.secure_url ||
      req.file.url ||
      '';

    const publicId =
      req.file.filename ||
      req.file.public_id ||
      '';

    if (!imageUrl || !publicId) {
      console.error(
        'Incomplete Cloudinary file object:',
        Object.keys(req.file)
      );

      return res.status(502).json({
        error: 'Cloudinary did not return the image URL. Check Cloudinary configuration.'
      });
    }

    const data = await loadData();

    const design = {
      id: crypto.randomBytes(4).toString('hex'),
      file: imageUrl,
      publicId,
      title: String(req.body?.title || '').trim() || 'Untitled',
      category: String(req.body?.category || '').trim() || 'Design'
    };

    data.designs = Array.isArray(data.designs)
      ? data.designs
      : [];

    data.designs.push(design);

    if (!(await saveData(data))) {
      return res.status(500).json({
        error: 'Design uploaded but could not save portfolio data.'
      });
    }

    return res.json({
      ok: true,
      design
    });
  } catch (error) {
    next(error);
  }
});

// =====================================================
// DELETE DESIGN
// =====================================================

app.delete('/api/design/:id', auth, async (req, res, next) => {
  try {
    const data = await loadData();

    data.designs = Array.isArray(data.designs)
      ? data.designs
      : [];

    const design = data.designs.find(
      item => item.id === req.params.id
    );

    if (!design) {
      return res.status(404).json({
        error: 'Design not found.'
      });
    }

    data.designs = data.designs.filter(
      item => item.id !== req.params.id
    );

    if (!(await saveData(data))) {
      return res.status(500).json({
        error: 'Could not save the deletion.'
      });
    }

    if (design.publicId) {
      await deleteCloudinaryImage(design.publicId);
    }

    return res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// =====================================================
// ADMIN PAGE
// =====================================================

app.get('/admin', (req, res) => {
  res.sendFile(
    path.join(__dirname, 'public', 'admin.html')
  );
});

// =====================================================
// ERROR HANDLER
// =====================================================

app.use((error, req, res, next) => {
  console.error('Request error:', error?.stack || error);

  if (res.headersSent) return next(error);

  const message = IS_PRODUCTION
    ? 'Something went wrong. Please check the server logs.'
    : (error.message || 'Something went wrong.');

  return res.status(500).json({
    error: message
  });
});

// =====================================================
// START SERVER
// =====================================================

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Website: http://localhost:${PORT}`);
    console.log(`Admin:   http://localhost:${PORT}/admin`);
    console.log(
      `Database: ${pool ? 'PostgreSQL enabled' : 'local data.json fallback'}`
    );
  });
}

module.exports = app;
