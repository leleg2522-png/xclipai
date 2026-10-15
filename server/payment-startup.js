// Payment readiness must not wait for unrelated legacy feature migrations.
// Retry initialization failures without starting duplicate reconciliation timers.
function startPaymentStorage({ payments, wallet, onReady, logger = console, schedule = setTimeout }) {
  let stopped = false, timer, attempts = 0;
  async function initialize() {
    attempts += 1;
    try {
      await payments.initialize();
      await wallet.initialize();
    } catch (error) {
      if (stopped) return;
      logger.error('[STARTUP] KlikQRIS payment storage unavailable:', error.code || error.name,
        `attempt=${attempts}; retrying in 5s`);
      timer = schedule(initialize, 5000);
      timer?.unref?.();
      return;
    }
    if (stopped) return;
    logger.log('[STARTUP] KlikQRIS payment storage ready');
    onReady();
  }
  void initialize();
  return () => { stopped = true; clearTimeout(timer); };
}
module.exports = { startPaymentStorage };
