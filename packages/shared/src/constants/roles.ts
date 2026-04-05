export const ROLES = ["owner", "member", "viewer"] as const;
export const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 0,
  member: 1,
  owner: 2,
};
