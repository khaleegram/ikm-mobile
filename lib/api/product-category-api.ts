// Products API client
// Handles creation and updates of products with category-specific fields
import { cloudFunctions } from './cloud-functions';
import { convertImageToBase64 } from '@/lib/utils/image-to-base64';
import { Product, ProductCategory } from '@/types';

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
  imageBase64?: string; // Base64 encoded image (cloud function will upload to storage)
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
  imageBase64?: string; // Base64 encoded image (cloud function will upload to storage)
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
      // Convert image to base64 if provided (legacy support for imageUrl)
      // If imageBase64 is already provided, use it directly
      let imageBase64: string | undefined = data.imageBase64;
      if (!imageBase64 && data.imageUrl) {
        imageBase64 = await convertImageToBase64(data.imageUrl);
      }

      const response = await cloudFunctions.createProductWithCategory({
        name: data.name,
        description: data.description,
        price: data.price,
        compareAtPrice: data.compareAtPrice,
        stock: data.stock,
        sku: data.sku,
        category: data.category,
        status: data.status || 'draft',
        imageBase64, // Send base64 image (cloud function will upload to storage)
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
      });

      if (!response.success) {
        throw new Error(response.message || 'Failed to create product');
      }

      // Return the created product (you may need to fetch it separately)
      // For now, return a partial product with the ID
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
      // Convert image to base64 if provided (legacy support for imageUrl)
      // If imageBase64 is already provided, use it directly
      let imageBase64: string | undefined = data.imageBase64;
      if (!imageBase64 && data.imageUrl) {
        imageBase64 = await convertImageToBase64(data.imageUrl);
      }

      const response = await cloudFunctions.updateProductWithCategory({
        productId,
        name: data.name,
        description: data.description,
        price: data.price,
        compareAtPrice: data.compareAtPrice,
        stock: data.stock,
        sku: data.sku,
        category: data.category,
        status: data.status,
        imageBase64, // Send base64 image if provided (cloud function will upload to storage)
        imageUrls: data.imageUrls, // Existing + new URLs (cloud function will merge)
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
      });

      if (!response.success) {
        throw new Error(response.message || 'Failed to update product');
      }

      // Return updated product (you may need to fetch it separately)
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

