const multer = require('multer');

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed for field businessLogo'));
  }
});

/**
 * Parses multipart/form-data with optional single file `businessLogo`.
 * Text fields land on req.body; file on req.file.
 */
function businessLogoUploadMiddleware(req, res, next) {
  upload.single('businessLogo')(req, res, (err) => {
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
    next();
  });
}

module.exports = { businessLogoUploadMiddleware };
