function shouldCreateRendererWindow(smokeTestMode) {
  return smokeTestMode !== true;
}

function buildSmokeReceipt({
  version,
  backendUrl,
  frontendUrl,
  databaseExists,
  integrityValid,
}) {
  return {
    completed: true,
    version,
    backendUrl,
    frontendUrl,
    databaseExists: Boolean(databaseExists),
    integrityValid: Boolean(integrityValid),
  };
}

module.exports = {
  buildSmokeReceipt,
  shouldCreateRendererWindow,
};
