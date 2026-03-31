import { coreCloudClient } from './core-cloud-client';

const DASHBOARD_FUNCTIONS = {
  getDashboardStats: 'https://getdashboardstats-q3rjv54uka-uc.a.run.app',
  getSellerAnalytics: 'https://getselleranalytics-q3rjv54uka-uc.a.run.app',
};

export interface DashboardStats {
  totalSales: number;
  totalOrders: number;
  totalCustomers: number;
  totalProducts: number;
  recentOrders: any[];
  salesByDay: { date: string; amount: number }[];
  topProducts: any[];
}

export interface AnalyticsStats {
  views: number;
  conversionRate: number;
  averageOrderValue: number;
  returningCustomerRate: number;
  salesByChannel: Record<string, number>;
  topCategories: { category: string; count: number; sales: number }[];
}

export const dashboardApi = {
  /**
   * Get seller dashboard statistics
   */
  getStats: async (sellerId?: string): Promise<DashboardStats> => {
    const response = await coreCloudClient.request<any>(DASHBOARD_FUNCTIONS.getDashboardStats, {
      method: 'POST',
      body: { sellerId },
      requiresAuth: true,
    });

    if (!response.success) {
      throw new Error(response.message || 'Failed to fetch dashboard stats');
    }

    return response.stats as DashboardStats;
  },

  /**
   * Get seller analytics data
   */
  getAnalytics: async (data?: {
    sellerId?: string;
    startDate?: string;
    endDate?: string;
    period?: 'day' | 'week' | 'month' | 'year';
  }): Promise<AnalyticsStats> => {
    const response = await coreCloudClient.request<any>(DASHBOARD_FUNCTIONS.getSellerAnalytics, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });

    if (!response.success) {
      throw new Error(response.message || 'Failed to fetch seller analytics');
    }

    return response.analytics as AnalyticsStats;
  },
};
