// Admin API endpoints - Uses Cloud Functions
// 
// NOTE: Platform settings writes MUST go through Cloud Functions.
// Firestore rules: allow write: if false (no direct client writes allowed)
// All platform_settings writes must be server-side only.
//
import { coreCloudClient } from './core-cloud-client';
import { cloudFunctionUrl } from './cloud-functions-base';
import { User, Order, OrderStatus } from '@/types';

const ADMIN_FUNCTIONS = {
  getAllUsers: cloudFunctionUrl('getAllUsers'),
  grantAdminRole: cloudFunctionUrl('grantAdminRole'),
  revokeAdminRole: cloudFunctionUrl('revokeAdminRole'),
  getPlatformSettings: cloudFunctionUrl('getPlatformSettings'),
  updatePlatformSettings: cloudFunctionUrl('updatePlatformSettings'),
  getAllOrders: cloudFunctionUrl('getAllOrders'),
  resolveDispute: cloudFunctionUrl('resolveDispute'),
  retryOrderRefund: cloudFunctionUrl('retryOrderRefund'),
  getAllPayouts: cloudFunctionUrl('getAllPayouts'),
  updateOrderStatus: cloudFunctionUrl('updateOrderStatus'),
  getAccessLogs: cloudFunctionUrl('getAccessLogs'),
  getFailedLogins: cloudFunctionUrl('getFailedLogins'),
  getApiKeys: cloudFunctionUrl('getApiKeys'),
  createApiKey: cloudFunctionUrl('createApiKey'),
  revokeApiKey: cloudFunctionUrl('revokeApiKey'),
  getSecuritySettings: cloudFunctionUrl('getSecuritySettings'),
  updateSecuritySettings: cloudFunctionUrl('updateSecuritySettings'),
  getAuditTrail: cloudFunctionUrl('getAuditTrail'),
  getFirestoreRules: cloudFunctionUrl('getFirestoreRules'),
};

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

export interface SecuritySettings {
  twoFactorEnabled: boolean;
  passwordPolicy: 'standard' | 'strict';
  sessionTimeout: number;
  ipWhitelist?: string[];
}

export interface AccessLog {
  id: string;
  userId: string;
  action: string;
  status: 'success' | 'failure';
  ip: string;
  userAgent: string;
  timestamp: string;
}

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  permissions: string[];
  lastUsedAt?: string;
  createdAt: string;
}

export const adminApi = {
  // Get all users (paginated)
  getAllUsers: async (data?: {
    limit?: number;
    startAfter?: string;
    role?: 'user' | 'customer' | 'seller' | 'admin';
  }): Promise<{
    users: User[];
    hasMore: boolean;
  }> => {
    const response = await coreCloudClient.request<{
      success: boolean;
      users: any[];
      hasMore: boolean;
    }>(ADMIN_FUNCTIONS.getAllUsers, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
    return {
      users: response.users as User[],
      hasMore: response.hasMore,
    };
  },

  // Update user role
  updateUserRole: async (userId: string, data: UpdateUserRoleData): Promise<User> => {
    if (data.isAdmin === true || data.role === 'admin') {
      await coreCloudClient.request(ADMIN_FUNCTIONS.grantAdminRole, {
        method: 'POST',
        body: { userId },
        requiresAuth: true,
      });
    } else if (data.isAdmin === false) {
      await coreCloudClient.request(ADMIN_FUNCTIONS.revokeAdminRole, {
        method: 'POST',
        body: { userId },
        requiresAuth: true,
      });
    }
    return {} as User;
  },

  // Grant admin role
  grantAdminRole: async (userId: string): Promise<void> => {
    await coreCloudClient.request(ADMIN_FUNCTIONS.grantAdminRole, {
      method: 'POST',
      body: { userId },
      requiresAuth: true,
    });
  },

  // Revoke admin role
  revokeAdminRole: async (userId: string): Promise<void> => {
    await coreCloudClient.request(ADMIN_FUNCTIONS.revokeAdminRole, {
      method: 'POST',
      body: { userId },
      requiresAuth: true,
    });
  },

  // Get platform settings
  getPlatformSettings: async (): Promise<PlatformSettings> => {
    const response = await coreCloudClient.request<{
      success: boolean;
      settings: {
        platformCommissionRate: number;
        minimumPayoutAmount: number;
        platformFee: number;
        currency: string;
      };
    }>(ADMIN_FUNCTIONS.getPlatformSettings, {
      method: 'POST',
      body: {},
      requiresAuth: true,
    });
    return {
      commissionRate: response.settings.platformCommissionRate,
      minPayoutAmount: response.settings.minimumPayoutAmount,
      platformFee: response.settings.platformFee,
      currency: response.settings.currency,
    };
  },

  // Update platform settings
  updatePlatformSettings: async (settings: PlatformSettings): Promise<PlatformSettings> => {
    await coreCloudClient.request(ADMIN_FUNCTIONS.updatePlatformSettings, {
      method: 'POST',
      body: { 
        settings: {
          platformCommissionRate: settings.commissionRate,
          minimumPayoutAmount: settings.minPayoutAmount,
          platformFee: settings.platformFee,
          currency: settings.currency,
        }
      },
      requiresAuth: true,
    });
    return settings;
  },

  // Get all orders (paginated)
  getAllOrders: async (data?: {
    limit?: number;
    startAfter?: string;
    status?: string;
  }): Promise<{
    orders: Order[];
    hasMore: boolean;
  }> => {
    const response = await coreCloudClient.request<{
      success: boolean;
      orders: any[];
      hasMore: boolean;
    }>(ADMIN_FUNCTIONS.getAllOrders, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
    return {
      orders: response.orders as Order[],
      hasMore: response.hasMore,
    };
  },

  // Resolve dispute
  resolveDispute: async (data: {
    orderId: string;
    resolution: 'refund' | 'release';
    refundAmount?: number;
  }): Promise<void> => {
    await coreCloudClient.request(ADMIN_FUNCTIONS.resolveDispute, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  },

  retryOrderRefund: async (data: {
    orderId: string;
    amountNgn?: number;
    reason?: string;
  }): Promise<void> => {
    await coreCloudClient.request(ADMIN_FUNCTIONS.retryOrderRefund, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });
  },

  // Update order status (admin override)
  updateOrderStatus: async (orderId: string, status: OrderStatus): Promise<Order> => {
    return coreCloudClient.request<Order>(ADMIN_FUNCTIONS.updateOrderStatus, {
      method: 'POST',
      body: { orderId, status },
      requiresAuth: true,
    });
  },

  // Security & Logs
  getAccessLogs: async (limit: number = 100): Promise<AccessLog[]> => {
    const response = await coreCloudClient.request<any>(ADMIN_FUNCTIONS.getAccessLogs, {
      method: 'POST',
      body: { limit },
      requiresAuth: true,
    });
    return response.logs as AccessLog[];
  },

  getFailedLogins: async (limit: number = 100): Promise<AccessLog[]> => {
    const response = await coreCloudClient.request<any>(ADMIN_FUNCTIONS.getFailedLogins, {
      method: 'POST',
      body: { limit },
      requiresAuth: true,
    });
    return response.logs as AccessLog[];
  },

  getApiKeys: async (): Promise<ApiKey[]> => {
    const response = await coreCloudClient.request<any>(ADMIN_FUNCTIONS.getApiKeys, {
      method: 'POST',
      body: {},
      requiresAuth: true,
    });
    return response.keys as ApiKey[];
  },

  createApiKey: async (name: string, permissions: string[]): Promise<ApiKey> => {
    const response = await coreCloudClient.request<any>(ADMIN_FUNCTIONS.createApiKey, {
      method: 'POST',
      body: { name, permissions },
      requiresAuth: true,
    });
    return response.key as ApiKey;
  },

  revokeApiKey: async (keyId: string): Promise<void> => {
    await coreCloudClient.request(ADMIN_FUNCTIONS.revokeApiKey, {
      method: 'POST',
      body: { keyId },
      requiresAuth: true,
    });
  },

  getSecuritySettings: async (): Promise<SecuritySettings> => {
    const response = await coreCloudClient.request<any>(ADMIN_FUNCTIONS.getSecuritySettings, {
      method: 'POST',
      body: {},
      requiresAuth: true,
    });
    return response.settings as SecuritySettings;
  },

  updateSecuritySettings: async (settings: Partial<SecuritySettings>): Promise<void> => {
    await coreCloudClient.request(ADMIN_FUNCTIONS.updateSecuritySettings, {
      method: 'POST',
      body: { settings },
      requiresAuth: true,
    });
  },

  getAuditTrail: async (data?: { limit?: number, action?: string, userId?: string }): Promise<any[]> => {
    const response = await coreCloudClient.request<any>(ADMIN_FUNCTIONS.getAuditTrail, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
    return response.trail as any[];
  },

  getFirestoreRules: async (): Promise<string> => {
    const response = await coreCloudClient.request<any>(ADMIN_FUNCTIONS.getFirestoreRules, {
      method: 'POST',
      body: {},
      requiresAuth: true,
    });
    return response.rules as string;
  },
};

