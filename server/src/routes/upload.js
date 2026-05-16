const router     = require('express').Router();
const multer     = require('multer');
const cloudinary = require('../utils/cloudinary');

// Keep files in memory — stream buffer straight to Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|webp|gif|heic|heif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}. Only JPEG, PNG, WEBP, GIF, HEIC are allowed.`));
  },
});

function streamUpload(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'a1groups', transformation: [{ width: 1200, crop: 'limit', quality: 'auto' }] },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

// ── POST /api/upload ──────────────────────────────────────────────────────────
// Field: image (single file)
// Returns: { url, publicId }
router.post('/', (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      // Multer errors (file type rejected, size exceeded, etc.)
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file received. Make sure the field name is "image".' });
    const result = await streamUpload(req.file.buffer);
    res.json({ url: result.secure_url, publicId: result.public_id });
  } catch (err) { next(err); }
});

// ── DELETE /api/upload?publicId= ──────────────────────────────────────────────
router.delete('/', async (req, res, next) => {
  try {
    const publicId = req.query.publicId || req.body.publicId;
    if (!publicId) return res.status(400).json({ error: 'publicId required' });
    await cloudinary.uploader.destroy(publicId);
    res.json({ message: 'Deleted from Cloudinary' });
  } catch (err) { next(err); }
});

module.exports = router;
