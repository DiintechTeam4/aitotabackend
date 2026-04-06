const multer = require('multer');

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      return cb(null, true);
    }
    // Ignore non-image file parts (extra attachments) without failing the request
    cb(null, false);
  },
});

/**
 * Parses multipart/form-data with optional single image.
 * Uses .any() so any field name works (avoids MulterError: Unexpected field).
 * Sets `req.file` to the first uploaded image, or undefined if none.
 * Skips parsing when body is not multipart (e.g. JSON-only register).
 */
function businessLogoUploadMiddleware(req, res, next) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('multipart/form-data')) {
    return next();
  }
  upload.any()(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res
            .status(400)
            .json({ success: false, message: 'Image must be 10MB or smaller' });
        }
        return res.status(400).json({ success: false, message: err.message });
      }
      return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
    }
    const images = (req.files || []).filter(
      (f) => f.mimetype && f.mimetype.startsWith('image/')
    );
    req.file = images[0] || undefined;
    next();
  });
}

module.exports = { businessLogoUploadMiddleware };
