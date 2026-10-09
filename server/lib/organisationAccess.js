export const ORGANISATION_ROLES = Object.freeze([
  "owner", "admin", "event_manager", "finance_manager", "volunteer_manager", "checkin_staff", "read_only",
]);

const ROLE_PERMISSIONS = Object.freeze({
  owner: ["profile.manage", "members.view", "members.manage", "events.view", "events.manage", "finance.view", "finance.manage", "volunteers.manage", "checkin.manage", "supporters.view", "supporters.manage"],
  admin: ["profile.manage", "members.view", "members.manage", "events.view", "events.manage", "finance.view", "finance.manage", "volunteers.manage", "checkin.manage", "supporters.view", "supporters.manage"],
  event_manager: ["events.view", "events.manage", "checkin.manage", "supporters.view"],
  finance_manager: ["finance.view", "finance.manage", "events.view", "supporters.view"],
  volunteer_manager: ["volunteers.manage", "events.view"],
  checkin_staff: ["events.view", "checkin.manage"],
  read_only: ["members.view", "events.view", "finance.view"],
  platform_admin: ["*"],
});

export function hasOrganisationPermission(role, permission) {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes("*") || permissions.includes(permission);
}

export function isOrganisationRole(role) {
  return ORGANISATION_ROLES.includes(role);
}

export function membershipMatchesScope(membership, organisationId, adminUserId) {
  return Boolean(
    membership && membership.is_active !== false &&
    Number(membership.organisation_id) === Number(organisationId) &&
    Number(membership.admin_user_id) === Number(adminUserId)
  );
}
