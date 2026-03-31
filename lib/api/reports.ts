import { coreCloudClient } from './core-cloud-client';

const REPORT_FUNCTIONS = {
  generateSalesReport: 'https://generatesalesreport-q3rjv54uka-uc.a.run.app',
  generateCustomerReport: 'https://generatecustomerreport-q3rjv54uka-uc.a.run.app',
};

export interface SalesReport {
  totalSales: number;
  totalOrders: number;
  totalItemsSold: number;
  averageOrderValue: number;
  salesByDate: { date: string; sales: number; orders: number }[];
  salesByCategory: { category: string; sales: number; percentage: number }[];
  topSellingProducts: { id: string; name: string; sales: number; quantity: number }[];
}

export interface CustomerReport {
  totalCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  topCustomers: { id: string; name: string; totalSpent: number; totalOrders: number; lastOrderAt: string }[];
}

export const reportsApi = {
  /**
   * Generate sales report for a specific period
   */
  generateSales: async (data: {
    sellerId?: string;
    startDate: string;
    endDate: string;
  }): Promise<SalesReport> => {
    const response = await coreCloudClient.request<any>(REPORT_FUNCTIONS.generateSalesReport, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });

    if (!response.success) {
      throw new Error(response.message || 'Failed to generate sales report');
    }

    return response.report as SalesReport;
  },

  /**
   * Generate customer report for a specific period
   */
  generateCustomers: async (data: {
    sellerId?: string;
    startDate: string;
    endDate: string;
  }): Promise<CustomerReport> => {
    const response = await coreCloudClient.request<any>(REPORT_FUNCTIONS.generateCustomerReport, {
      method: 'POST',
      body: data,
      requiresAuth: true,
    });

    if (!response.success) {
      throw new Error(response.message || 'Failed to generate customer report');
    }

    return response.report as CustomerReport;
  },
};
