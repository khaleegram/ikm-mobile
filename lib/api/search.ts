import { coreCloudClient } from './core-cloud-client';
import { Product } from '@/types';

const SEARCH_FUNCTIONS = {
  searchProducts: 'https://searchproducts-q3rjv54uka-uc.a.run.app',
};

export interface SearchOptions {
  query?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  state?: string;
  city?: string;
  sortBy?: 'price_asc' | 'price_desc' | 'created_at_desc' | 'relevance';
  limit?: number;
  page?: number;
}

export interface SearchResult {
  products: Product[];
  total: number;
  page: number;
  totalPages: number;
}

export const searchApi = {
  /**
   * Search for products with filters
   */
  search: async (options: SearchOptions): Promise<SearchResult> => {
    const response = await coreCloudClient.request<any>(SEARCH_FUNCTIONS.searchProducts, {
      method: 'POST',
      body: options,
      requiresAuth: false, // Search is usually public
    });

    if (!response.success) {
      throw new Error(response.message || 'Search failed');
    }

    return {
      products: response.products as Product[],
      total: response.total || 0,
      page: response.page || 1,
      totalPages: response.totalPages || 1,
    };
  },
};
