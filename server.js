
// Spark Portfolio server
// Start with: npm start

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.ADMIN_PASSWORD || 'sparko';


// =====================================================
// CLOUDINARY CONFIGURATION
// =====================================================

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});


// =====================================================
// PORTFOLIO DATA
// =====================================================

const defaults = {
  name: 'AKAWUNG SYLVESTER',
  tagline: 'Graphic Designer · Yaoundé, Cameroon',
  cover: '',
  coverPublicId: '',
  profile: '',
  profilePublicId: '',
  designs: []
};

const DATA = path.join(__dirname, 'data.json');

function load() {
  try {
    const saved = JSON.parse(
      fs.readFileSync(DATA, 'utf8')
    );

    return {
      ...defaults,
      ...saved
    };
  } catch {
    return {
      ...defaults
    };
  }
}

function save(data) {
  try {
    fs.writeFileSync(
      DATA,
      JSON.stringify(data, null, 2)
    );

    return true;
  } catch (error) {
    console.error(
      'Could not save data:',
      error.message
    );

    return false;
  }
}


// =====================================================
// CLOUDINARY IMAGE STORAGE
// =====================================================

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,

  params: {
    folder: 'spark-portfolio',

    allowed_formats: [
      'jpg',
      'jpeg',
      'png',
      'webp',
      'gif'
    ],

    resource_type: 'image'
  }
});

const upload = multer({
  storage: storage,

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
      callback(null, true);
    } else {
      callback(
        new Error(
          'Only JPG, PNG, WEBP or GIF images are allowed.'
        )
      );
    }
  }
}).single('p');


// =====================================================
// UPLOAD MIDDLEWARE
// =====================================================

function up(req, res, next) {

  upload(req, res, error => {

    if (error) {

      console.error(
        'Upload error:',
        error.message
      );

      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: 'Image is larger than 8 MB.'
        });
      }

      return res.status(400).json({
        error: error.message
      });
    }

    next();
  });
}


// =====================================================
// CLOUDINARY DELETE
// =====================================================

async function deleteCloudinaryImage(publicId) {

  if (!publicId) {
    return;
  }

  try {

    await cloudinary.uploader.destroy(
      publicId,
      {
        resource_type: 'image'
      }
    );

    console.log(
      'Cloudinary image deleted:',
      publicId
    );

  } catch (error) {

    console.error(
      'Cloudinary delete error:',
      error.message
    );
  }
}


// =====================================================
// AUTHENTICATION
// =====================================================

const sessions = new Set();

function getCookie(req) {

  const cookies =
    req.headers.cookie || '';

  return cookies
    .split(';')
    .map(item => item.trim())
    .find(
      item => item.startsWith('sid=')
    )
    ?.slice(4);
}

function isAuthenticated(req) {

  const sid = getCookie(req);

  return sid
    ? sessions.has(sid)
    : false;
}

function auth(req, res, next) {

  if (isAuthenticated(req)) {
    return next();
  }

  return res.status(401).json({
    error: 'Please log in again.'
  });
}


function passwordMatches(a, b) {

  const hash = value =>
    crypto
      .createHash('sha256')
      .update(String(value))
      .digest();

  return crypto.timingSafeEqual(
    hash(a),
    hash(b)
  );
}


// =====================================================
// EXPRESS SETUP
// =====================================================

app.use(express.json());

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);


// =====================================================
// PUBLIC PORTFOLIO DATA
// =====================================================

app.get('/api/data', (req, res) => {

  res.json(load());

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

  const password =
    req.body.password || '';

  if (!passwordMatches(
    password,
    PASSWORD
  )) {

    return res.status(401).json({
      error: 'Wrong password.'
    });
  }

  const sid =
    crypto.randomBytes(24).toString('hex');

  sessions.add(sid);

  res.setHeader(
    'Set-Cookie',
    'sid=' +
      sid +
      '; HttpOnly; SameSite=Strict; Path=/'
  );

  res.json({
    ok: true
  });

});


// =====================================================
// LOGOUT
// =====================================================

app.post('/api/logout', (req, res) => {

  const sid = getCookie(req);

  if (sid) {
    sessions.delete(sid);
  }

  res.json({
    ok: true
  });

});


// =====================================================
// SAVE NAME + TAGLINE
// =====================================================

app.post('/api/text', auth, (req, res) => {

  const data = load();

  const name =
    String(
      req.body.name || data.name
    ).trim();

  const tagline =
    String(
      req.body.tagline || ''
    ).trim();

  data.name = name;
  data.tagline = tagline;

  if (!save(data)) {

    return res.status(500).json({
      error: 'Could not save portfolio details.'
    });
  }

  res.json({
    ok: true
  });

});


// =====================================================
// COVER + PROFILE UPLOAD
// =====================================================

['cover', 'profile'].forEach(type => {

  app.post(
    '/api/' + type,
    auth,
    up,
    async (req, res) => {

      if (!req.file) {

        return res.status(400).json({
          error: 'Choose an image first.'
        });
      }

      const data = load();

      // Delete previous image from Cloudinary
      const oldPublicId =
        data[type + 'PublicId'];

      if (oldPublicId) {

        await deleteCloudinaryImage(
          oldPublicId
        );
      }


      // Cloudinary gives us the URL
      const imageUrl =
        req.file.path ||
        req.file.secure_url ||
        '';


      // Cloudinary public ID
      const publicId =
        req.file.filename ||
        req.file.public_id ||
        '';


      data[type] = imageUrl;

      data[type + 'PublicId'] =
        publicId;


      if (!save(data)) {

        return res.status(500).json({
          error: 'Image uploaded but could not save portfolio data.'
        });
      }


      res.json({
        ok: true,
        url: imageUrl
      });

    }
  );

});


// =====================================================
// ADD DESIGN
// =====================================================

app.post(
  '/api/design',
  auth,
  up,
  (req, res) => {

    if (!req.file) {

      return res.status(400).json({
        error: 'Choose an image first.'
      });
    }


    const data = load();


    const design = {

      id:
        crypto
          .randomBytes(4)
          .toString('hex'),

      file:
        req.file.path ||
        req.file.secure_url ||
        '',

      publicId:
        req.file.filename ||
        req.file.public_id ||
        '',

      title:
        String(
          req.body.title || ''
        ).trim() ||
        'Untitled',

      category:
        String(
          req.body.category || ''
        ).trim() ||
        'Design'

    };


    data.designs.push(design);


    if (!save(data)) {

      return res.status(500).json({
        error: 'Design uploaded but could not save portfolio data.'
      });
    }


    res.json({
      ok: true
    });

  }
);


// =====================================================
// DELETE DESIGN
// =====================================================

app.delete(
  '/api/design/:id',
  auth,
  async (req, res) => {

    const data = load();


    const design =
      data.designs.find(
        item =>
          item.id === req.params.id
      );


    if (!design) {

      return res.status(404).json({
        error: 'Design not found.'
      });
    }


    // Delete image from Cloudinary
    if (design.publicId) {

      await deleteCloudinaryImage(
        design.publicId
      );
    }


    data.designs =
      data.designs.filter(
        item =>
          item.id !== req.params.id
      );


    if (!save(data)) {

      return res.status(500).json({
        error: 'Could not save the deletion.'
      });
    }


    res.json({
      ok: true
    });

  }
);


// =====================================================
// ADMIN PAGE
// =====================================================

app.get('/admin', (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      'public',
      'admin.html'
    )
  );

});


// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {

  console.log('');
  console.log(
    'Website: http://localhost:' +
    PORT
  );

  console.log(
    'Admin:   http://localhost:' +
    PORT +
    '/admin'
  );

  console.log(
    '(Close this window to stop the site)'
  );

  console.log('');

});
