// Deployment-time settings for a prebuilt frontend image. The nginx image
// rewrites this file at container start from LATTICE_* environment variables
// (see frontend/docker-entrypoint.d/40-runtime-config.sh). Empty here, so
// local dev and build-time VITE_* values behave as before.
window.__LATTICE_RUNTIME_CONFIG__ = {}
