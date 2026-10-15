// Public product definitions. Routing and upstream account details are deliberately separate.
const MODELS = Object.freeze({
  'wan-3.0-uncensored': Object.freeze({
    id: 'wan-3.0-uncensored', name: 'Wan 3.0 Uncensored', category: 'Video · Uncensored',
    pricePerVideo: 6000, minDuration: 2, maxDuration: 30,
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
  }),
  'wan-3.0': Object.freeze({
    id: 'wan-3.0', name: 'Wan 3.0', category: 'Video',
    pricePerVideo: 6500, minDuration: 30, maxDuration: 30, aspectRatios: ['16:9', '9:16'],
  }),
});
const MODEL_IDS = Object.keys(MODELS);
const modelPrices = Object.fromEntries(MODEL_IDS.map(id => [id, MODELS[id].pricePerVideo]));
const isManagedVideoModel = id => Object.hasOwn(MODELS, id);
module.exports = { MODELS, MODEL_IDS, modelPrices, isManagedVideoModel };
