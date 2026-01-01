// Authentication helper utilities
import { AuthUser } from '../firebase/auth/use-user';

/**
 * Check if user has access to the mobile app
 * Only sellers and admins can access the mobile app
 */
export function hasAppAccess(user: AuthUser | null): boolean {
  if (!user) return false;
  return user.isAdmin || user.isSeller;
}

/**
 * Check if user is admin
 */
export function isAdmin(user: AuthUser | null): boolean {
  return user?.isAdmin === true;
}

/**
 * Check if user is seller
 */
export function isSeller(user: AuthUser | null): boolean {
  return user?.isSeller === true;
}

/**
 * Check if user can perform admin actions
 */
export function canPerformAdminAction(user: AuthUser | null): boolean {
  return user?.isAdmin === true;
}

/**
 * Check if user can manage a resource (owner or admin)
 */
export function canManageResource(
  user: AuthUser | null,
  resourceOwnerId: string
): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  return user.uid === resourceOwnerId;
}

