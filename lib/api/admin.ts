// Admin API endpoints - Uses Cloud Functions
// 
// NOTE: Platform settings writes MUST go through Cloud Functions.
// Firestore rules: allow write: if false (no direct client writes allowed)
// All platform_settings writes must be server-side only.
//
import { cloudFunctions } from './cloud-functions';
import { User, Order, OrderStatus } from '@/types';

export interface UpdateUserRoleData {
  role?: 'user' | 'customer' | 'seller' | 'admin';
  isAdmin?: boolean;
}

export interface PlatformSettings {
  commissionRate?: number;
  minPayoutAmount?: number;
  autoReleaseDays?: number;
  platformFee?: number;
  currency?: string;
}

export const adminApi = {
  // Get all users (paginated) - Uses Cloud Function
  getAllUsers: async (data?: {
    limit?: number;
    startAfter?: string;
    role?: 'user' | 'customer' | 'seller' | 'admin';
  }): Promise<{
    users: User[];
    hasMore: boolean;
  }> => {
    const response = await cloudFunctions.getAllUsers(data);
    return {
      users: response.users as User[],
      hasMore: response.hasMore,
    };
  },

  // Update user role - Uses grantAdminRole/revokeAdminRole Cloud Functions
  updateUserRole: async (userId: string, data: UpdateUserRoleData): Promise<User> => {
    if (data.isAdmin === true || data.role === 'admin') {
      // Grant admin role
      await cloudFunctions.grantAdminRole(userId);
    } else if (data.isAdmin === false) {
      // Revoke admin role (only if explicitly set to false)
      await cloudFunctions.revokeAdminRole(userId);
    }
    
    // For role changes (seller/user), we might need a separate Cloud Function
    // For now, if you have a Cloud Function for this, add it here
    // Otherwise, return a placeholder - the role change will be reflected in Firestore
    
    return {} as User; // Return will be updated when role changes are reflected
  },

  // Grant admin role - Uses Cloud Function
  grantAdminRole: async (userId: string): Promise<void> => {
    await cloudFunctions.grantAdminRole(userId);
  },

  // Revoke admin role - Uses Cloud Function
  revokeAdminRole: async (userId: string): Promise<void> => {
    await cloudFunctions.revokeAdminRole(userId);
  },

  // Get platform settings - Uses Cloud Function
  getPlatformSettings: async (): Promise<PlatformSettings> => {
    const response = await cloudFunctions.getPlatformSettings();
    return {
      commissionRate: response.settings.platformCommissionRate,
      minPayoutAmount: response.settings.minimumPayoutAmount,
      platformFee: response.settings.platformFee,
      currency: response.settings.currency,
    };
  },

  // Update platform settings - Uses Cloud Function
  updatePlatformSettings: async (settings: PlatformSettings): Promise<PlatformSettings> => {
    await cloudFunctions.updatePlatformSettings({
      platformCommissionRate: settings.commissionRate,
      minimumPayoutAmount: settings.minPayoutAmount,
      platformFee: settings.platformFee,
      currency: settings.currency,
    });
    // Return updated settings
    return settings;
  },

  // Get all orders - Uses Cloud Function
  getAllOrders: async (data?: {
    limit?: number;
    startAfter?: string;
    status?: string;
  }): Promise<{
    orders: Order[];
    hasMore: boolean;
  }> => {
    const response = await cloudFunctions.getAllOrders(data);
    return {
      orders: response.orders as Order[],
      hasMore: response.hasMore,
    };
  },

  // Resolve dispute - Uses Cloud Function
  resolveDispute: async (data: {
    orderId: string;
    resolution: 'refund' | 'release';
    refundAmount?: number;
  }): Promise<void> => {
    await cloudFunctions.resolveDispute(data);
  },

  // Update order status (admin override) - Uses Cloud Function
  updateOrderStatus: async (orderId: string, status: OrderStatus): Promise<Order> => {
    return cloudFunctions.updateOrderStatus({ orderId, status });
  },
};

