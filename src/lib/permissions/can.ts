import { Membership } from "@/types/membership";

export function can(membership: Membership | null | undefined, permission: string): boolean {
  if (!membership) return false;
  return membership.permissions.includes(permission);
}

export function canAny(membership: Membership | null | undefined, permissions: string[]): boolean {
  if (!membership) return false;
  return permissions.some(p => membership.permissions.includes(p));
}

export function canAll(membership: Membership | null | undefined, permissions: string[]): boolean {
  if (!membership) return false;
  return permissions.every(p => membership.permissions.includes(p));
}