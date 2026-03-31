// Product API endpoints - Uses Cloud Functions
// 
// NOTE: Firestore rules expect 'initialPrice' field, not 'price'.
// The Cloud Function MUST convert 'price' → 'initialPrice' when writing to Firestore.
// Client-side code uses 'price' for consistency with TypeScript types.
//
import { coreCloudClient } from './core-cloud-client';
import { Product } from '@/types';
import { convertImageToBase64 } from '@/lib/utils/image-to-base64';

const PRODUCT_FUNCTIONS = {
  getSellerProducts: 'https://getsellerproducts-q3rjv54uka-uc.a.run.app',
  getProduct: 'https://getproduct-q3rjv54uka-uc.a.run.app',
  createProduct: 'https://createproduct-q3rjv54uka-uc.a.run.app',
  updateProduct: 'https://updateproduct-q3rjv54uka-uc.a.run.app',
  deleteProduct: 'https://deleteproduct-q3rjv54uka-uc.a.run.app',
};

export interface CreateProductData {
  name: string;
  description?: string;
  price: number; 
  compareAtPrice?: number;
  stock: number;
  sku?: string;
  imageUrl?: string;
  category?: string;
  status?: 'active' | 'draft' | 'inactive';
  variants?: Array<{
    id?: string;
    name: string;
    options: Array<{
      value: string;
      priceModifier: number;
      stock: number;
      sku?: string;
    }>;
  }>;
}

export interface UpdateProductData {
  name?: string;
  description?: string;
  price?: number;
  compareAtPrice?: number;
  stock?: number;
  sku?: string;
  imageUrl?: string;
  category?: string;
  status?: 'active' | 'draft' | 'inactive';
  variants?: Array<{
    id?: string;
    name: string;
    options: Array<{
      value: string;
      priceModifier: number;
      stock: number;
      sku?: string;
    }>;
  }>;
  isFeatured?: boolean;
}

export const productApi = {
  // Create product
  create: async (data: CreateProductData): Promise<Product> => {
    let imageBase64: string | undefined;
    if (data.imageUrl && (data.imageUrl.startsWith('file://') || data.imageUrl.startsWith('asset://'))) {
      try {
        imageBase64 = await convertImageToBase64(data.imageUrl);
      } catch (error: any) {
        console.error('Failed to convert image to base64:', error);
        throw new Error(`Failed to process image: ${error.message}`);
      }
    } else if (data.imageUrl && data.imageUrl.startsWith('data:')) {
      imageBase64 = data.imageUrl;
    }

    const variants = data.variants?.map(v => ({
      name: v.name,
      options: v.options.map(opt => ({
        value: opt.value,
        priceModifier: opt.priceModifier,
        stock: opt.stock,
        sku: opt.sku,
      })),
    }));

    const response = await coreCloudClient.request<{
      success: boolean;
      productId: string;
      product: any;
    }>(PRODUCT_FUNCTIONS.createProduct, {
      method: 'POST',
      body: {
        name: data.name,
        description: data.description,
        price: data.price,
        compareAtPrice: data.compareAtPrice,
        stock: data.stock,
        sku: data.sku,
        category: data.category,
        status: data.status || 'draft',
        allowShipping: true,
        imageBase64,
        variants,
      },
      requiresAuth: true,
    });

    return response.product as Product;
  },

  // Update product
  update: async (productId: string, data: UpdateProductData): Promise<Product> => {
    let imageBase64: string | undefined;
    if (data.imageUrl && (data.imageUrl.startsWith('file://') || data.imageUrl.startsWith('asset://'))) {
      try {
        imageBase64 = await convertImageToBase64(data.imageUrl);
      } catch (error: any) {
        console.error('Failed to convert image to base64:', error);
        throw new Error(`Failed to process image: ${error.message}`);
      }
    } else if (data.imageUrl && data.imageUrl.startsWith('data:')) {
      imageBase64 = data.imageUrl;
    }

    const variants = data.variants?.map(v => ({
      name: v.name,
      options: v.options.map(opt => ({
        value: opt.value,
        priceModifier: opt.priceModifier,
        stock: opt.stock,
        sku: opt.sku,
      })),
    }));

    await coreCloudClient.request(PRODUCT_FUNCTIONS.updateProduct, {
      method: 'POST',
      body: {
        productId,
        name: data.name,
        description: data.description,
        price: data.price,
        compareAtPrice: data.compareAtPrice,
        stock: data.stock,
        sku: data.sku,
        category: data.category,
        status: data.status,
        imageBase64,
        variants,
      },
      requiresAuth: true,
    });

    return {
      id: productId,
      sellerId: '',
      name: data.name || '',
      price: data.price || 0,
      stock: data.stock || 0,
      ...data,
    } as Product;
  },

  // Delete product
  delete: async (productId: string): Promise<void> => {
    await coreCloudClient.request(PRODUCT_FUNCTIONS.deleteProduct, {
      method: 'POST',
      body: { productId },
      requiresAuth: true,
    });
  },

  // Get seller products
  getSellerProducts: async (data?: {
    sellerId?: string;
    limit?: number;
    startAfter?: string;
    status?: 'active' | 'draft' | 'inactive';
  }): Promise<{ products: Product[]; hasMore: boolean }> => {
    const response = await coreCloudClient.request<{
      success: boolean;
      products: any[];
      hasMore: boolean;
    }>(PRODUCT_FUNCTIONS.getSellerProducts, {
      method: 'POST',
      body: data || {},
      requiresAuth: true,
    });
    return {
      products: response.products as Product[],
      hasMore: response.hasMore,
    };
  },

  // Get single product
  getProduct: async (productId: string): Promise<Product> => {
    const response = await coreCloudClient.request<{
      success: boolean;
      product: any;
    }>(PRODUCT_FUNCTIONS.getProduct, {
      method: 'POST',
      body: { productId },
      requiresAuth: false,
    });
    return response.product as Product;
  },
};


