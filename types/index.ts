// Core data types for IKM Marketplace - Matching Firebase Schema

import { Timestamp } from 'firebase/firestore';

export type UserRole = 'customer' | 'seller' | 'admin';
export type SellerType = 'business' | 'street' | 'both';

// User Collection - matches Firebase schema exactly
export interface User {
  id?: string;                    // Document ID (same as userId)
  displayName: string;            // User's display name
  email: string;                  // User's email address
  firstName?: string;             // First name
  lastName?: string;              // Last name
  phone?: string;                 // Phone number
  whatsappNumber?: string;        // WhatsApp number (format: +234...)
  
  // Admin
  isAdmin?: boolean;              // true if user is admin
  
  // Seller Info (if user is a seller)
  storeName?: string;             // Store name
  storeDescription?: string;      // Store description
  storeLogoUrl?: string;          // Store logo image URL
  storeBannerUrl?: string;        // Store banner image URL
  
  // Location
  storeLocation?: {
    state: string;                // State
    lga: string;                  // Local Government Area
    city: string;                 // City
    address?: string;             // Full address
  };
  
  // Business Info
  businessType?: string;          // Business category
  
  // Policies
  storePolicies?: {
    shipping?: string;            // Shipping policy text
    returns?: string;             // Returns policy text
    refunds?: string;             // Refunds policy text
    privacy?: string;             // Privacy policy text
  };
  
  // Payout Details (for sellers)
  payoutDetails?: {
    bankName: string;             // Bank name
    bankCode: string;             // Bank code
    accountNumber: string;        // Account number
    accountName: string;          // Account name
  };
  
  // Onboarding
  onboardingCompleted?: boolean;  // true if seller completed onboarding
  
  // Guest Users
  isGuest?: boolean;              // true if created from guest checkout
  
  // Seller Type (for Market Street)
  sellerType?: SellerType;        // 'business' | 'street' | 'both' (optional for backward compatibility)
  
  // Timestamps
  createdAt?: Timestamp | Date;          // Account creation date
  updatedAt?: Timestamp | Date;          // Last update date
}

// Public user fields (for store browsing)
export interface PublicUser {
  id: string;
  displayName: string;
  storeName?: string;
  storeDescription?: string;
  storeLogoUrl?: string;
  storeBannerUrl?: string;
  storeLocation?: {
    state: string;
    lga: string;
    city: string;
  };
  businessType?: string;
  storePolicies?: {
    shipping?: string;
    returns?: string;
    refunds?: string;
    privacy?: string;
  };
}

// Store Collection - separate from users
export interface Store {
  id?: string;                    // Document ID
  userId: string;                 // Owner's user ID
  storeName: string;              // Store name
  storeDescription?: string;      // Store description
  storeLogoUrl?: string;          // Logo URL
  storeBannerUrl?: string;        // Banner URL
  
  // Location
  storeLocation?: {
    state: string;
    lga: string;
    city: string;
    address?: string;
  };
  
  // Business
  businessType?: string;
  
  // Policies
  storePolicies?: {
    shipping?: string;
    returns?: string;
    refunds?: string;
    privacy?: string;
  };
  
  // Social Media
  facebookUrl?: string;
  instagramUrl?: string;
  twitterUrl?: string;
  tiktokUrl?: string;
  
  // Store Hours
  storeHours?: {
    monday?: string;
    tuesday?: string;
    wednesday?: string;
    thursday?: string;
    friday?: string;
    saturday?: string;
    sunday?: string;
  };
  
  // Contact
  email?: string;
  phone?: string;
  website?: string;
  pickupAddress?: string;         // Default pickup address
  
  // Theme/Customization
  primaryColor?: string;          // Hex color (e.g., "#FF5733")
  secondaryColor?: string;        // Hex color
  fontFamily?: string;            // Font family name
  storeLayout?: 'grid' | 'list' | 'masonry';
  
  // SEO
  metaTitle?: string;
  metaDescription?: string;
  metaKeywords?: string;
  
  // Domain
  subdomain?: string;             // Auto-generated subdomain
  customDomain?: string;          // Custom domain
  domainStatus?: 'none' | 'pending' | 'verified' | 'failed';
  dnsRecords?: Array<{
    type: 'A' | 'CNAME' | 'TXT';
    name: string;
    value: string;
    status?: 'pending' | 'verified' | 'failed';
    lastCheckedAt?: Timestamp | Date;
  }>;
  
  // Shipping Settings
  shippingSettings?: {
    defaultPackagingType?: string;
    packagingCost?: number;
  };
  
  // Payout Details (may be stored in stores collection or users collection)
  payoutDetails?: {
    bankName: string;
    bankCode: string;
    accountNumber: string;
    accountName: string;
  };
  
  // Status
  onboardingCompleted?: boolean;
  
  // Timestamps
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}

// Product Type
export type ProductType = 'standard';

// Product Categories (lowercase to match web version)
export type ProductCategory = 
  | 'fragrance'
  | 'fashion'
  | 'snacks'
  | 'materials'
  | 'skincare'
  | 'haircare'
  | 'islamic'
  | 'electronics';

// Product Collection - matches Firebase schema exactly
export interface Product {
  id?: string;                    // Document ID
  sellerId: string;               // Seller's user ID
  name: string;                   // Product name
  description?: string;           // Product description
  price: number;                  // Selling price (in NGN)
  compareAtPrice?: number;        // Original price (for discounts)
  stock: number;                  // Available stock quantity
  sku?: string;                   // Stock Keeping Unit
  imageUrl?: string;              // Legacy: single image URL (deprecated, use imageUrls)
  imageUrls?: string[];           // Multiple image URLs (preferred)
  videoUrl?: string;             // 15-second product video URL
  audioDescription?: string;      // Audio file URL (basic voice description)
  category?: string;              // Product category
  
  // Product Type
  productType?: ProductType;      // 'standard'
  
  // Status - matches schema exactly
  status?: 'active' | 'draft' | 'inactive';
  isFeatured?: boolean;           // Featured product flag
  
  // ========== Category-Specific Fields ==========
  // All fields are optional, validated based on category
  
  // Fragrance Category
  volume?: string;                // "3ml", "6ml", "12ml", "30ml", "50ml", "100ml", "other"
  fragranceType?: string;          // "oil-based", "spray", "incense"
  container?: string;             // "pocket-size", "standard-bottle", "refill-unboxed"
  
  // Fashion Category
  sizeType?: 'free-size' | 'abaya-length' | 'standard';
  abayaLength?: string;           // "52", "54", "56", "58", "60" (in inches)
  standardSize?: string;          // "S", "M", "L", "XL", "XXL"
  setIncludes?: string;           // "dress-only", "with-veil", "3-piece-set"
  material?: string;              // "soft-silk", "stiff-cotton", "heavy-premium"
  
  // Snacks Category
  packaging?: string;             // "single-piece", "pack-sachet", "plastic-jar", "bucket"
  quantity?: number;              // 1, 6, 12, 24, or custom positive integer
  taste?: string;                 // "sweet", "spicy", "crunchy", "soft"
  
  // Materials Category
  materialType?: string;          // "shadda", "atiku", "cotton", "silk", "linen", "custom"
  customMaterialType?: string;    // Required if materialType is "custom"
  fabricLength?: string;          // "4-yards", "5-yards", "10-yards", etc.
  quality?: string;               // "super-vip", "standard", "starched" (based on yards)
  
  // Skincare Category
  skincareBrand?: string;         // Brand name
  skincareType?: string;          // "face-cream", "soap", "toner", "serum", etc.
  skincareSize?: string;          // "small", "medium", "large", or specific ml/g
  
  // Haircare Category
  haircareType?: string;          // "hair-oil", "treatment", "shampoo", "conditioner", "package-deal"
  haircareBrand?: string;         // Brand name
  haircareSize?: string;          // "small", "medium", "large", or specific size
  haircarePackageItems?: string[]; // Required if type is "package-deal": ["oil", "shampoo", "conditioner", "treatment", "mask"]
  
  // Islamic Category
  islamicType?: string;           // "prayer-mat", "tasbih", "book", "misbaha", etc.
  islamicSize?: string;           // "small", "medium", "large", "standard"
  islamicMaterial?: string;       // "wool", "cotton", "plastic", "wood", etc.
  
  // Electronics Category
  brand?: string;                 // Brand name (e.g., "Samsung", "Apple")
  model?: string;                 // Model number/name
  
  // Delivery Settings
  deliveryFeePaidBy?: 'seller' | 'buyer';  // Who pays delivery fees
  deliveryMethods?: {
    localDispatch?: {
      enabled: boolean;            // Within city delivery enabled
    };
    waybill?: {
      enabled: boolean;            // Inter-state waybill enabled
    };
    pickup?: {
      enabled: boolean;            // Customer pickup enabled
      landmark?: string;          // Pickup location landmark
    };
  };
  
  // Variants
  variants?: Array<{
    id: string;                   // Variant ID
    name: string;                 // Variant name (e.g., "Size", "Color")
    options: Array<{
      value: string;              // Option value (e.g., "Small", "Red")
      priceModifier: number;      // Price adjustment (+₦500, -₦200, etc.)
      stock: number;              // Stock for this option
      sku?: string;               // SKU for this option
    }>;
  }>;
  
  // WhatsApp Share
  shareLink?: string;             // Generated product share link
  whatsappPreviewImage?: string;  // Generated preview image for WhatsApp
  
  // Analytics
  views?: number;                 // Product view count
  salesCount?: number;             // Total sales count
  averageRating?: number;          // Average rating (1-5)
  reviewCount?: number;           // Total number of reviews
  
  // Timestamps
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}

// Order Collection - matches Firebase schema exactly
export type OrderStatus = 'Processing' | 'Sent' | 'Received' | 'Completed' | 'Cancelled' | 'Disputed' | 'AvailabilityCheck';

export interface Order {
  id?: string;                    // Document ID
  customerId: string;             // Customer's user ID (or guest ID)
  sellerId: string;               // Seller's user ID
  idempotencyKey: string;         // Unique key to prevent duplicate orders
  
  // Order Items - matches schema exactly
  items: Array<{
    productId: string;            // Product document ID
    name: string;                 // Product name
    price: number;                // Price per unit
    quantity: number;             // Quantity ordered
  }>;
  
  // Pricing
  total: number;                  // Total order amount (in NGN) - NOT totalAmount
  shippingPrice?: number;         // Shipping cost
  shippingType?: 'delivery' | 'pickup';
  
  // Status - matches schema exactly
  status: OrderStatus;
  
  // Delivery Info
  deliveryAddress: string;        // Full delivery address
  customerInfo: {
    name: string;                 // Customer full name
    email: string;                // Customer email
    phone: string;                // Customer phone
    state?: string;               // Customer state
    isGuest?: boolean;            // true if guest order
  };
  
  // Payment
  paymentReference?: string;      // Paystack reference
  paystackReference?: string;    // Paystack reference (duplicate)
  paymentMethod?: string;         // Payment method (e.g., "Paystack")
  discountCode?: string;          // Applied discount code
  
  // Escrow
  escrowStatus?: 'held' | 'released' | 'refunded';
  commissionRate?: number;        // Platform commission rate at time of order
  fundsReleasedAt?: Timestamp | Date;    // When funds were released
  autoReleaseDate?: Timestamp | Date;    // Auto-release date if no dispute
  
  // Delivery Tracking
  sentAt?: Timestamp | Date;             // When order was sent
  sentPhotoUrl?: string;          // Photo proof of sending
  receivedAt?: Timestamp | Date;         // When order was received
  receivedPhotoUrl?: string;      // Photo proof of receipt
  
  // Waybill Park Information (for inter-state deliveries)
  waybillParkId?: string;         // Park ID where item was sent from
  waybillParkName?: string;       // Park name for display
  
  // Order Availability System (for food/snacks sellers)
  availabilityStatus?: 'available' | 'not_available' | 'waiting_buyer_response';
  waitTimeDays?: number;          // Number of days seller needs to restock (optional)
  waitTimeExpiresAt?: Timestamp | Date;  // When wait time expires
  availabilityReason?: string;    // Seller's reason for unavailability
  buyerWaitResponse?: 'accepted' | 'cancelled' | null;  // Buyer's response to wait time offer
  
  // Dispute
  dispute?: {
    id: string;
    orderId: string;
    openedBy: string;             // customerId
    type: 'item_not_received' | 'wrong_item' | 'damaged_item';
    description: string;
    status: 'open' | 'resolved' | 'closed';
    photos?: string[];            // Array of photo URLs
    resolvedBy?: string;          // adminId
    resolvedAt?: Timestamp | Date;
    createdAt: Timestamp | Date;
  };
  
  // Notes
  notes?: Array<{
    id: string;
    note: string;
    isInternal: boolean;          // true if seller/admin only
    createdBy: string;            // userId
    createdAt: Timestamp | Date;
  }>;
  
  // Refunds
  refunds?: Array<{
    id: string;
    orderId: string;
    amount: number;
    reason: string;
    refundMethod: 'original_payment' | 'store_credit' | 'manual';
    status: 'pending' | 'processed' | 'failed';
    processedBy?: string;        // adminId
    createdAt: Timestamp | Date;
    processedAt?: Timestamp | Date;
  }>;
  
  // Timestamps
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}

// Order Chat Message
export interface OrderMessage {
  id?: string;                    // Document ID
  orderId: string;                // Order ID
  senderId: string;               // User ID of sender (customer or seller)
  senderRole: 'customer' | 'seller' | 'admin';
  message: string;                // Message text
  read: boolean;                  // Whether message has been read
  createdAt?: Timestamp | Date;
}

// Order Item (simplified for display)
export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

// Notification Collection
export interface Notification {
  id?: string;                    // Document ID
  userId: string;                 // User ID (seller who receives the notification)
  title: string;                  // Notification title
  message: string;                // Notification message/body
  type: 'new_order' | 'order_update' | 'order_cancelled' | 'low_stock' | 'general';
  read: boolean;                  // Whether notification has been read
  orderId?: string;               // Related order ID (if applicable)
  productId?: string;             // Related product ID (if applicable)
  status?: string;                // Order status (for order_update type)
  amount?: number;                // Order amount (for new_order type)
  createdAt?: Timestamp | Date;   // Notification creation date
  updatedAt?: Timestamp | Date;   // Last update date
}

// Store Settings (for API updates)
export interface StoreSettings {
  storeName: string;
  storeDescription?: string;
  storeLogoUrl?: string;
  storeBannerUrl?: string;
  storeLocation?: {
    state?: string;
    lga?: string;
    city?: string;
    address?: string;
  };
  businessType?: string;
  storePolicies?: {
    shipping?: string;
    returns?: string;
    refunds?: string;
    privacy?: string;
  };
}

// Discount Code Collection
export interface DiscountCode {
  id?: string;
  sellerId: string;
  code: string;                   // Discount code (e.g., "SAVE20")
  type: 'percentage' | 'fixed';    // Discount type
  value: number;                  // Discount value (percentage or fixed amount)
  uses: number;                   // Number of times used
  maxUses?: number;               // Maximum uses (optional)
  minOrderAmount?: number;         // Minimum order amount
  validFrom?: Timestamp | Date;
  validUntil?: Timestamp | Date;
  status: 'active' | 'inactive' | 'expired';
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}

// Email Campaign Collection
export interface EmailCampaign {
  id?: string;
  sellerId: string;
  subject: string;
  message: string;
  recipientType: 'all' | 'segment' | 'custom';
  segment?: 'VIP' | 'Regular' | 'New';
  recipientEmails?: string[];
  recipientCount: number;
  deliveredCount?: number;
  status: 'draft' | 'pending' | 'sending' | 'sent' | 'failed';
  sentAt?: Timestamp | Date;
  createdAt?: Timestamp | Date;
}

// Shipping Zone Collection
export interface ShippingZone {
  id?: string;
  sellerId: string;
  name: string;                    // Zone name (e.g., "Lagos Zone")
  rate: number;                    // Shipping rate (in NGN)
  freeThreshold?: number;          // Order total for free shipping
  states?: string[];               // Array of states (e.g., ["Lagos", "Abuja"])
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}

// Payout Collection
export interface Payout {
  id?: string;
  sellerId: string;
  amount: number;
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  requestedAt?: Timestamp | Date;
  processedAt?: Timestamp | Date;
  processedBy?: string;           // Admin user ID
  transferReference?: string;     // Paystack transfer reference
  failureReason?: string;
  createdAt?: Timestamp | Date;
}

// Customer (derived from orders)
export interface Customer {
  id: string;                      // Customer user ID
  name: string;                    // Customer name
  email: string;                   // Customer email
  phone?: string;                  // Customer phone
  totalOrders: number;              // Total orders from this customer
  totalSpent: number;              // Total amount spent
  lastOrderDate?: Date;            // Date of last order
  segment: 'VIP' | 'Regular' | 'New'; // Customer segment
}

// Platform Settings
export interface PlatformSettings {
  minPayoutAmount: number;         // Minimum payout amount
  commissionRate: number;          // Platform commission rate
  maintenanceMode: boolean;        // Maintenance mode flag
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}

// Park Collection (Transport Parks for Waybill Deliveries)
export interface Park {
  id?: string;                     // Document ID
  name: string;                    // Park name (e.g., "Naibawa Park")
  city: string;                    // City (e.g., "Kano")
  state: string;                   // State (e.g., "Kano")
  isActive: boolean;               // Whether park is active
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}

// Market Street Types

// Market Post Collection - separate from business products
export interface MarketPost {
  id?: string;
  posterId: string;              // Firebase Auth UID
  images: string[];              // 1-20 image URLs (required)
  hashtags?: string[];           // Optional hashtags
  price?: number;                // Optional price (NGN)
  description?: string;          // Optional description
  location?: {
    state?: string;
    city?: string;
  };
  contactMethod?: 'in-app' | 'whatsapp';
  
  // Engagement
  likes: number;                 // Like count
  views: number;                 // View count
  comments: number;              // Comment count
  likedBy?: string[];            // User IDs who liked
  
  // Status
  status: 'active' | 'hidden' | 'deleted';
  
  // Timestamps
  createdAt: Timestamp | Date;
  updatedAt: Timestamp | Date;
  expiresAt?: Timestamp | Date;  // Optional auto-hide
}

// Market Message Collection
export interface MarketMessage {
  id?: string;
  chatId: string;                // Unique chat ID (buyerId_posterId_postId)
  senderId: string;              // Sender Firebase UID
  receiverId: string;            // Receiver Firebase UID
  postId: string;                // Related Market Post ID
  message: string;               // Message text
  imageUrl?: string;             // Optional image in message
  paymentLink?: string;          // Optional payment link
  read: boolean;                 // Read status
  
  // Timestamps
  createdAt: Timestamp | Date;
}

// Market Comment Collection
export interface MarketComment {
  id?: string;
  postId: string;                // Market Post ID
  userId: string;                // Commenter Firebase UID
  comment: string;               // Comment text
  
  // Timestamps
  createdAt: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}
