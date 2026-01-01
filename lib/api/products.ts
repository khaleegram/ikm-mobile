// Product API endpoints - Uses Cloud Functions
// 
// NOTE: Firestore rules expect 'initialPrice' field, not 'price'.
// The Cloud Function MUST convert 'price' → 'initialPrice' when writing to Firestore.
// Client-side code uses 'price' for consistency with TypeScript types.
//
import { Product } from '@/types';
import { cloudFunctions } from './cloud-functions';
import { convertImageToBase64 } from '@/lib/utils/image-to-base64';

export interface CreateProductData {
  name: string;
  description?: string;
  price: number; // Cloud Function converts this to 'initialPrice' for Firestore
  compareAtPrice?: number;
  stock: number;
  sku?: string;
  imageUrl?: string; // Local URI - will be converted to base64
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
  price?: number; // Cloud Function converts this to 'initialPrice' for Firestore if provided
  compareAtPrice?: number;
  stock?: number;
  sku?: string;
  imageUrl?: string; // Local URI - will be converted to base64 if provided
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
  // Create product (uses Cloud Function)
  create: async (data: CreateProductData): Promise<Product> => {
    // Convert image URI to base64 if provided
    let imageBase64: string | undefined;
    if (data.imageUrl && (data.imageUrl.startsWith('file://') || data.imageUrl.startsWith('asset://'))) {
      try {
        imageBase64 = await convertImageToBase64(data.imageUrl);
      } catch (error: any) {
        console.error('Failed to convert image to base64:', error);
        throw new Error(`Failed to process image: ${error.message}`);
      }
    } else if (data.imageUrl && data.imageUrl.startsWith('data:')) {
      // Already base64
      imageBase64 = data.imageUrl;
    }

    // Prepare variants (remove id field if present)
    const variants = data.variants?.map(v => ({
      name: v.name,
      options: v.options.map(opt => ({
        value: opt.value,
        priceModifier: opt.priceModifier,
        stock: opt.stock,
        sku: opt.sku,
      })),
    }));

    const response = await cloudFunctions.createProduct({
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
    });

    // Return the product from response
    return response.product as Product;
  },

  // Update product (uses Cloud Function)
  update: async (productId: string, data: UpdateProductData): Promise<Product> => {
    // Convert image URI to base64 if provided and it's a local file
    let imageBase64: string | undefined;
    if (data.imageUrl && (data.imageUrl.startsWith('file://') || data.imageUrl.startsWith('asset://'))) {
      try {
        imageBase64 = await convertImageToBase64(data.imageUrl);
      } catch (error: any) {
        console.error('Failed to convert image to base64:', error);
        throw new Error(`Failed to process image: ${error.message}`);
      }
    } else if (data.imageUrl && data.imageUrl.startsWith('data:')) {
      // Already base64
      imageBase64 = data.imageUrl;
    }

    // Prepare variants (remove id field if present)
    const variants = data.variants?.map(v => ({
      name: v.name,
      options: v.options.map(opt => ({
        value: opt.value,
        priceModifier: opt.priceModifier,
        stock: opt.stock,
        sku: opt.sku,
      })),
    }));

    const response = await cloudFunctions.updateProduct({
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
    });

    // Return updated product (might need to fetch it separately or return from response)
    // For now, return a minimal Product object - you might want to fetch it from Firestore
    return {
      id: productId,
      sellerId: '',
      name: data.name || '',
      price: data.price || 0,
      stock: data.stock || 0,
      ...data,
    } as Product;
  },

  // Delete product (uses Cloud Function)
  delete: async (productId: string): Promise<void> => {
    await cloudFunctions.deleteProduct(productId);
  },
};

