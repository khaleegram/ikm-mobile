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

/**
 * Check if user can access Market Street
 * Returns true for guests (null user) or any logged-in user
 */
export function canAccessMarketStreet(user: AuthUser | null): boolean {
  // Guests can browse Market Street
  if (!user) return true;
  // Any logged-in user can access Market Street
  return true;
}

/**
 * Check if user can post to Market Street
 * Returns true if logged in (customer, street seller, or both)
 */
export function canPostToMarketStreet(user: AuthUser | null): boolean {
  // Must be logged in to post
  if (!user) return false;
  // Any logged-in user can post (customer, street seller, or business seller)
  return true;
}
