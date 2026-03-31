import { coreCloudClient } from './core-cloud-client';
import { convertImageToBase64 } from '@/lib/utils/image-to-base64';
import { Product, ProductCategory } from '@/types';

const NORTHERN_PRODUCT_FUNCTIONS = {
  createProductWithCategory: 'https://createnorthernproduct-q3rjv54uka-uc.a.run.app',
  updateProductWithCategory: 'https://updatenorthernproduct-q3rjv54uka-uc.a.run.app',
};

export interface CreateProductData {
  name: string;
  description?: string;
  price: number;
  compareAtPrice?: number;
  stock: number;
  sku?: string;
  category: ProductCategory;
  status?: 'active' | 'draft' | 'inactive';
  imageUrl?: string; // Deprecated - use imageUrls instead
  imageUrls?: string[]; // Array of image URLs (uploaded to Firebase Storage)
  videoUrl?: string; // Video URL (uploaded to Firebase Storage)
  audioDescription?: string; // Audio URL (uploaded to Firebase Storage)
  
  // Category-specific fields
  volume?: string;
  fragranceType?: string;
  containerType?: string;
  sizeType?: 'standard' | 'custom';
  abayaLength?: string;
  standardSize?: string;
  setIncludes?: string[];
  material?: string;
  packagingType?: string;
  quantity?: number;
  taste?: string;
  materialType?: string;
  customMaterialType?: string;
  fabricLength?: string;
  quality?: string;
  brand?: string;
  productType?: string;
  size?: string;
  hairCareType?: string;
  haircarePackageItems?: string[];
  islamicProductType?: string;
  model?: string;
}

export interface UpdateProductData {
  productId?: string;
  name?: string;
  description?: string;
  price?: number;
  compareAtPrice?: number;
  stock?: number;
  sku?: string;
  category?: ProductCategory;
  status?: 'active' | 'draft' | 'inactive';
  imageUrl?: string; // Deprecated - use imageUrls instead
  imageUrls?: string[]; // Array of image URLs (uploaded to Firebase Storage)
  videoUrl?: string; // Video URL (uploaded to Firebase Storage)
  audioDescription?: string; // Audio URL (uploaded to Firebase Storage)
  
  // Category-specific fields
  volume?: string;
  fragranceType?: string;
  container?: string;
  sizeType?: 'free-size' | 'abaya-length' | 'standard';
  abayaLength?: string;
  standardSize?: string;
  setIncludes?: string;
  material?: string;
  packaging?: string;
  quantity?: number;
  taste?: string;
  materialType?: string;
  customMaterialType?: string;
  fabricLength?: string;
  quality?: string;
  // Skincare fields
  skincareBrand?: string;
  skincareType?: string;
  skincareSize?: string;
  // Haircare fields
  haircareType?: string;
  haircareBrand?: string;
  haircareSize?: string;
  haircarePackageItems?: string[];
  // Islamic fields
  islamicType?: string;
  islamicSize?: string;
  islamicMaterial?: string;
  // Electronics fields
  brand?: string;
  model?: string;
  // Delivery settings
  deliveryFeePaidBy?: 'seller' | 'buyer';
  deliveryMethods?: {
    localDispatch?: { enabled: boolean };
    waybill?: { enabled: boolean };
    pickup?: { enabled: boolean; landmark?: string };
  };
}

export const productApi = {
  /**
   * Create a new product
   */
  create: async (data: CreateProductData): Promise<Product> => {
    try {
      // Convert image to base64 if provided
      let imageBase64: string | undefined;
      if (data.imageUrl) {
        imageBase64 = await convertImageToBase64(data.imageUrl);
      }

      const response = await coreCloudClient.request<any>(NORTHERN_PRODUCT_FUNCTIONS.createProductWithCategory, {
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
          imageBase64, // Legacy support
          imageUrls: data.imageUrls,
          videoUrl: data.videoUrl,
          audioDescription: data.audioDescription,
          
          // Category-specific fields
          volume: data.volume,
          fragranceType: data.fragranceType,
          container: (data as any).containerType || (data as any).container,
          sizeType: data.sizeType,
          abayaLength: data.abayaLength,
          standardSize: data.standardSize,
          setIncludes: data.setIncludes,
          material: data.material,
          packaging: (data as any).packagingType || (data as any).packaging,
          quantity: data.quantity,
          taste: data.taste,
          materialType: data.materialType,
          customMaterialType: data.customMaterialType,
          fabricLength: data.fabricLength,
          quality: data.quality,
          // Skincare fields
          skincareBrand: (data as any).skincareBrand,
          skincareType: (data as any).skincareType,
          skincareSize: (data as any).skincareSize,
          // Haircare fields
          haircareType: (data as any).hairCareType || (data as any).haircareType,
          haircareBrand: (data as any).haircareBrand,
          haircareSize: (data as any).size || (data as any).haircareSize,
          haircarePackageItems: data.haircarePackageItems,
          // Islamic fields
          islamicType: (data as any).islamicProductType || (data as any).islamicType,
          islamicSize: (data as any).islamicSize,
          islamicMaterial: (data as any).islamicMaterial,
          // Electronics fields
          brand: data.brand,
          model: data.model,
          // Delivery settings
          deliveryFeePaidBy: (data as any).deliveryFeePaidBy,
          deliveryMethods: (data as any).deliveryMethods,
        },
        requiresAuth: true,
      });

      if (!response.success) {
        throw new Error(response.message || 'Failed to create product');
      }

      return {
        id: response.productId,
        sellerId: '', // Will be set by backend
        name: data.name,
        description: data.description,
        price: data.price,
        compareAtPrice: data.compareAtPrice,
        stock: data.stock,
        sku: data.sku,
        category: data.category,
        productType: 'standard',
        status: data.status || 'draft',
      } as Product;
    } catch (error: any) {
      console.error('Error creating product:', error);
      throw new Error(error.message || 'Failed to create product');
    }
  },

  /**
   * Update an existing product
   */
  update: async (productId: string, data: UpdateProductData): Promise<Product> => {
    try {
      // Convert image to base64 if provided
      let imageBase64: string | undefined;
      if (data.imageUrl) {
        imageBase64 = await convertImageToBase64(data.imageUrl);
      }

      const response = await coreCloudClient.request<any>(NORTHERN_PRODUCT_FUNCTIONS.updateProductWithCategory, {
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
          imageBase64, // Legacy support
          imageUrls: data.imageUrls,
          videoUrl: data.videoUrl,
          audioDescription: data.audioDescription,
          
          // Category-specific fields
          volume: data.volume,
          fragranceType: data.fragranceType,
          container: data.container,
          sizeType: data.sizeType,
          abayaLength: data.abayaLength,
          standardSize: data.standardSize,
          setIncludes: data.setIncludes,
          material: data.material,
          packaging: data.packaging,
          quantity: data.quantity,
          taste: data.taste,
          materialType: data.materialType,
          customMaterialType: data.customMaterialType,
          fabricLength: data.fabricLength,
          quality: data.quality,
          // Skincare fields
          skincareBrand: data.skincareBrand,
          skincareType: data.skincareType,
          skincareSize: data.skincareSize,
          // Haircare fields
          haircareType: data.haircareType,
          haircareBrand: data.haircareBrand,
          haircareSize: data.haircareSize,
          haircarePackageItems: data.haircarePackageItems,
          // Islamic fields
          islamicType: data.islamicType,
          islamicSize: data.islamicSize,
          islamicMaterial: data.islamicMaterial,
          // Electronics fields
          brand: data.brand,
          model: data.model,
          // Delivery settings
          deliveryFeePaidBy: data.deliveryFeePaidBy,
          deliveryMethods: data.deliveryMethods,
        },
        requiresAuth: true,
      });

      if (!response.success) {
        throw new Error(response.message || 'Failed to update product');
      }

      return {
        id: productId,
        ...data,
        productType: 'standard',
      } as Product;
    } catch (error: any) {
      console.error('Error updating product:', error);
      throw new Error(error.message || 'Failed to update product');
    }
  },
};


