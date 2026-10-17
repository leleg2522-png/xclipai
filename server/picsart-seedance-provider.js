const { createPicsartVideoProvider } = require('./picsart-wan-provider');

function seedanceParams(input, imageUrl, model) {
  return {
    model,
    content: [
      ...(imageUrl ? [{ type: 'image_url', image_url: { url: imageUrl }, role: 'reference_image' }] : []),
      { type: 'text', text: input.prompt },
    ],
    ratio: input.aspectRatio, duration: input.duration, resolution: '480p',
    generate_audio: input.audio,
  };
}

// Separate captured contract: content[] inputs and result.video_url, not Wan's media/url fields.
function createPicsartSeedanceProvider(pool, request) {
  return createPicsartVideoProvider(pool, {
    model: 'seedance-2.5', workflow: '/gw-v2/workflows/seedance',
    minimumCredits: 120, resultField: 'video_url',
    params: (input, imageUrl) => ({
      ...seedanceParams(input, imageUrl, 'seedance_2_5'),
      output_format: 'mp4_8bit', omni_reference_task_type: 'auto',
    }),
  }, request);
}

// The 2.0 capture uses 15s and does not send the 2.5-only output/task flags.
function createPicsartSeedance2Provider(pool, request) {
  return createPicsartVideoProvider(pool, {
    model: 'seedance-2.0', workflow: '/gw-v2/workflows/seedance',
    minimumCredits: 45, resultField: 'video_url',
    params: (input, imageUrl) => seedanceParams(input, imageUrl, 'seedance_2_0'),
  }, request);
}
module.exports = { createPicsartSeedanceProvider, createPicsartSeedance2Provider };
