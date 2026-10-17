const { MODELS } = require('./video-models');

// Public submission policy is separate from historical polling/refunds.
module.exports = function rejectRetiredModel(req, res, next) {
  if (req.method !== 'POST') return next();
  const id = typeof req.body?.model === 'string' ? req.body.model.trim().toLowerCase() : '';
  if (MODELS[id]?.retired) {
    return res.status(410).json({
      error: 'Model ini sudah dihentikan. Pilih model lain dari katalog Xclip.',
      code: 'MODEL_RETIRED',
    });
  }
  return next();
};
