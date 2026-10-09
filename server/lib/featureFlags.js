/**
 * Small server-side rollout switch for KutumbLink additions.
 *
 * Flags are opt-in, allow-listed, and disabled unless the matching environment
 * variable is exactly "true". Keep authorization checks independent: a flag
 * controls availability, never access rights.
 */
export const KUTUMBLINK_FEATURES = Object.freeze([
  "organisations",
  "supporter_identity",
]);

export function isFeatureEnabled(name, env = process.env) {
  if (!KUTUMBLINK_FEATURES.includes(name)) return false;
  const key = `KUTUMBLINK_FEATURE_${name.toUpperCase()}`;
  const defaultValue = name === "organisations";
  return String(env[key] ?? defaultValue).trim().toLowerCase() === "true";
}
