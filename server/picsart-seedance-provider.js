const { createPicsartVideoProvider } = require('./picsart-wan-provider');

// Separate captured contract: content[] inputs and result.video_url, not Wan's media/url fields.
function createPicsartSeedanceProvider(pool, request) {
  return createPicsartVideoProvider(pool, {
    model: 'seedance-2.5', workflow: '/gw-v2/workflows/seedance',
    minimumCredits: 120, resultField: 'video_url',
    params: (input, imageUrl) => ({
      model: 'seedance_2_5',
      content: [
        ...(imageUrl ? [{ type: 'image_url', image_url: { url: imageUrl }, role: 'reference_image' }] : []),
        { type: 'text', text: input.prompt },
      ],
      ratio: input.aspectRatio, duration: input.duration, resolution: input.resolution,
      generate_audio: input.audio, output_format: 'mp4_8bit', omni_reference_task_type: 'auto',
    }),
  }, request);
}
module.exports = { createPicsartSeedanceProvider };
