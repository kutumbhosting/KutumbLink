import path from "path";

// Single source of truth for where media/data files live on disk, shared
// between server.js and any route module that needs it (filemanager.js in
// particular used to compute this independently with a Docker-only
// fallback path that doesn't exist in local/Windows setups — that drift
// is exactly the kind of bug importing one shared value prevents).
// Writable application data is created at runtime and is not bundled with the
// source package. Deployments can override this with a persistent volume.
export const DATA_ROOT = process.env.DATA_ROOT || path.join(process.cwd(), "server/runtime-data");
