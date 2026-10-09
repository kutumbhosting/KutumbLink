// Only existing Kutumb administrators and explicit platform administrators
// can use the legacy global admin/check-in surfaces. Charity users must use
// organisation-scoped APIs.
export function hasLegacyAdminAccess(role) {
  return ["admin", "platform_admin", "superadmin"].includes(role);
}

export function hasPlatformAdminAccess(role) {
  return ["platform_admin", "superadmin"].includes(role);
}
