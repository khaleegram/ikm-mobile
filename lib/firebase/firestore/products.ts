// Client-side hooks for reading product data (read-only)
import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Unsubscribe,
  QueryConstraint,
} from 'firebase/firestore';
import { firestore } from '../config';
import { Product } from '@/types';
import { doc } from 'firebase/firestore';

// Get products by seller with real-time updates
export function useSellerProducts(sellerId: string | null) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!sellerId) {
      setProducts([]);
      setLoading(false);
      return;
    }

    // Query without status filter to avoid composite index requirement
    // We'll filter by status in the client if needed
    const q = query(
      collection(firestore, 'products'),
      where('sellerId', '==', sellerId),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const productsList: Product[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          // Preserve ALL fields from Firestore, ensure required fields have defaults
          // Handle price - check both price and initialPrice fields (Firestore uses initialPrice)
          let price = 0;
          const priceValue = data.price !== undefined && data.price !== null ? data.price : 
                           (data.initialPrice !== undefined && data.initialPrice !== null ? data.initialPrice : null);
          if (priceValue !== null && priceValue !== undefined) {
            if (typeof priceValue === 'number') {
              price = priceValue;
            } else if (typeof priceValue === 'string') {
              const parsed = parseFloat(priceValue);
              price = isNaN(parsed) ? 0 : parsed;
            }
          }

          // Handle status - only default to draft if status is truly missing
          const status = data.status && ['active', 'draft', 'inactive'].includes(data.status) 
            ? data.status 
            : (data.status || 'draft');

          const product: Product = {
            id: doc.id,
            sellerId: data.sellerId || '',
            name: data.name || '',
            description: data.description,
            price: price,
            compareAtPrice: typeof data.compareAtPrice === 'number' ? data.compareAtPrice : 
                           (typeof data.compareAtPrice === 'string' ? parseFloat(data.compareAtPrice) || undefined : undefined),
            stock: typeof data.stock === 'number' ? data.stock : 
                   (typeof data.stock === 'string' ? parseInt(data.stock, 10) || 0 : 0),
            sku: data.sku,
            imageUrl: data.imageUrl,
            imageUrls: data.imageUrls || (data.imageUrl ? [data.imageUrl] : undefined),
            videoUrl: data.videoUrl,
            audioDescription: data.audioDescription,
            category: data.category,
            status: status,
            isFeatured: data.isFeatured || false,
            variants: data.variants,
            views: typeof data.views === 'number' ? data.views : 0,
            salesCount: typeof data.salesCount === 'number' ? data.salesCount : 0,
            averageRating: typeof data.averageRating === 'number' ? data.averageRating : undefined,
            reviewCount: typeof data.reviewCount === 'number' ? data.reviewCount : 0,
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
          };
          productsList.push(product);
        });
        setProducts(productsList);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching seller products:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [sellerId]);

  return { products, loading, error };
}

// Get single product with real-time updates
export function useProduct(productId: string | null) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!productId) {
      setProduct(null);
      setLoading(false);
      return;
    }

    const unsubscribe: Unsubscribe = onSnapshot(
      doc(firestore, 'products', productId),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          // Preserve ALL fields from Firestore, ensure required fields have defaults
          // Handle price - check both price and initialPrice fields (Firestore uses initialPrice)
          let price = 0;
          const priceValue = data.price !== undefined && data.price !== null ? data.price : 
                           (data.initialPrice !== undefined && data.initialPrice !== null ? data.initialPrice : null);
          if (priceValue !== null && priceValue !== undefined) {
            if (typeof priceValue === 'number') {
              price = priceValue;
            } else if (typeof priceValue === 'string') {
              const parsed = parseFloat(priceValue);
              price = isNaN(parsed) ? 0 : parsed;
            }
          }

          // Handle status - only default to draft if status is truly missing
          const status = data.status && ['active', 'draft', 'inactive'].includes(data.status) 
            ? data.status 
            : (data.status || 'draft');

          const product: Product = {
            id: snapshot.id,
            sellerId: data.sellerId || '',
            name: data.name || '',
            description: data.description,
            price: price,
            compareAtPrice: typeof data.compareAtPrice === 'number' ? data.compareAtPrice : 
                           (typeof data.compareAtPrice === 'string' ? parseFloat(data.compareAtPrice) || undefined : undefined),
            stock: typeof data.stock === 'number' ? data.stock : 
                   (typeof data.stock === 'string' ? parseInt(data.stock, 10) || 0 : 0),
            sku: data.sku,
            imageUrl: data.imageUrl,
            imageUrls: data.imageUrls || (data.imageUrl ? [data.imageUrl] : undefined),
            videoUrl: data.videoUrl,
            audioDescription: data.audioDescription,
            category: data.category,
            status: status,
            isFeatured: data.isFeatured || false,
            variants: data.variants,
            views: typeof data.views === 'number' ? data.views : 0,
            salesCount: typeof data.salesCount === 'number' ? data.salesCount : 0,
            averageRating: typeof data.averageRating === 'number' ? data.averageRating : undefined,
            reviewCount: typeof data.reviewCount === 'number' ? data.reviewCount : 0,
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date(),
          };
          setProduct(product);
        } else {
          setProduct(null);
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching product:', err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [productId]);

  return { product, loading, error };
}

