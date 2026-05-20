import { useAuthStore } from "../../../store/useAuthStore";
import { EXISTING_ROLE_MAP } from "../utils/constants";

export function useCan(permission) {
  const user = useAuthStore((s) => s.user);
  const rolePermissions = useAuthStore((s) => s.rolePermissions);
  if (!user || !rolePermissions) return false;
  const rbacRole = EXISTING_ROLE_MAP[user.role] ?? user.role ?? "operator";
  const perms = rolePermissions[rbacRole];
  return Array.isArray(perms) ? perms.includes(permission) : false;
}

export function useRbacRole() {
  const user = useAuthStore((s) => s.user);
  if (!user) return "operator";
  return EXISTING_ROLE_MAP[user.role] ?? user.role ?? "operator";
}
