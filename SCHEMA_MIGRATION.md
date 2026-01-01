# Firebase Schema Migration - Mobile App

This document outlines all changes made to align the mobile app with the exact Firebase schema from the web application.

## ✅ Completed Updates

### 1. Type Definitions (`types/index.ts`)

#### User Type
- ✅ Added `firstName`, `lastName`, `phone` fields
- ✅ Updated `storePolicies` to match schema:
  - `shipping` (was `shippingPolicy`)
  - `returns` (was `returnPolicy`)
  - `refunds` (was `refundPolicy`)
  - `privacy` (new)
- ✅ Added `onboardingCompleted`, `isGuest` fields
- ✅ Added `payoutDetails` structure

#### Product Type
- ✅ Changed `isActive: boolean` → `status: 'active' | 'draft' | 'inactive'`
- ✅ Changed `images: string[]` → `imageUrl?: string` (single image)
- ✅ Added `compareAtPrice`, `sku` fields
- ✅ Added `variants` structure
- ✅ Added analytics fields: `views`, `salesCount`, `averageRating`, `reviewCount`
- ✅ Added `isFeatured` field

#### Order Type
- ✅ Updated `OrderStatus`: `'Processing' | 'Sent' | 'Received' | 'Completed' | 'Cancelled' | 'Disputed'`
  - Removed: `'Shipped'`, `'Delivered'`
  - Added: `'Sent'`, `'Received'`, `'Completed'`, `'Disputed'`
- ✅ Changed `totalAmount` → `total`
- ✅ Updated `items` structure:
  - Removed: `productImage`, `subtotal`
  - Kept: `productId`, `name`, `price`, `quantity`
- ✅ Changed `shippingAddress` → `deliveryAddress` (string) + `customerInfo` (object)
- ✅ Added `idempotencyKey`, `shippingPrice`, `shippingType`
- ✅ Added `escrowStatus`, `commissionRate`, `fundsReleasedAt`, `autoReleaseDate`
- ✅ Added `sentAt`, `sentPhotoUrl`, `receivedAt`, `receivedPhotoUrl`
- ✅ Added `dispute`, `notes`, `refunds` structures
- ✅ Updated payment fields: `paymentReference`, `paystackReference`, `discountCode`

#### Store Type
- ✅ Added separate `Store` interface (from `stores` collection)
- ✅ Includes all store-specific fields from schema

### 2. Firestore Hooks

#### Products (`lib/firebase/firestore/products.ts`)
- ✅ Updated query to handle `status` field instead of `isActive`
- ✅ Removed composite query (Firestore index limitation)
- ✅ Properly handles `imageUrl` instead of `images` array

#### Orders (`lib/firebase/firestore/orders.ts`)
- ✅ Updated to use new `OrderStatus` values
- ✅ Handles `total` instead of `totalAmount`
- ✅ Properly maps order items structure

#### Users (`lib/firebase/firestore/users.ts`)
- ✅ Updated to handle all new user fields
- ✅ Properly filters public vs private fields

### 3. API Interfaces

#### Products API (`lib/api/products.ts`)
- ✅ Updated `CreateProductData`:
  - `imageUrl` instead of `images`
  - `status` instead of `isActive`
  - Added `compareAtPrice`, `sku`, `variants`
- ✅ Updated `UpdateProductData` with same changes

#### Orders API (`lib/api/orders.ts`)
- ✅ Uses correct `OrderStatus` type
- ✅ Status transitions match schema

#### User API (`lib/api/user.ts`)
- ✅ Updated `storePolicies` structure to match schema

### 4. UI Screens

#### Products List (`app/(tabs)/products.tsx`)
- ✅ Displays `imageUrl` instead of `images[0]`
- ✅ Shows `status` badge (active/draft/inactive) instead of isActive
- ✅ Displays `compareAtPrice` if available

#### Product Detail (`app/products/[id].tsx`)
- ✅ Single image upload instead of multiple
- ✅ Status selector (active/draft/inactive) instead of switch
- ✅ Added `compareAtPrice`, `sku`, `category` fields
- ✅ Removed `isActive` toggle

#### New Product (`app/products/new.tsx`)
- ✅ Single image picker instead of multiple
- ✅ Status selector
- ✅ Added all new fields (compareAtPrice, sku, category)

#### Orders List (`app/(tabs)/orders.tsx`)
- ✅ Uses `order.total` instead of `order.totalAmount`
- ✅ Updated status colors for new statuses

#### Order Detail (`app/orders/[id].tsx`)
- ✅ Updated status transitions to match schema
- ✅ Displays `customerInfo` and `deliveryAddress` correctly
- ✅ Shows `sentAt`, `receivedAt` timestamps
- ✅ Displays dispute information if present
- ✅ Shows payment reference and escrow status
- ✅ Updated status button labels

#### Analytics (`app/(tabs)/analytics.tsx`)
- ✅ Uses `order.total` instead of `order.totalAmount`
- ✅ Updated status calculations for new statuses
- ✅ Filters out `Disputed` orders from revenue
- ✅ Uses `product.status === 'active'` instead of `isActive`
- ✅ Updated order item calculations (no subtotal field)

#### Settings (`app/settings.tsx`)
- ✅ Updated `storePolicies` field names to match schema

#### Dashboard (`app/(tabs)/index.tsx`)
- ✅ Uses `product.status === 'active'` instead of `isActive`

### 5. Notifications

#### Order Notifications (`lib/hooks/use-order-notifications.ts`)
- ✅ Updated status messages for new order statuses
- ✅ Uses `order.total` instead of `order.totalAmount`

### 6. Authentication

#### User Hook (`lib/firebase/auth/use-user.ts`)
- ✅ Checks `isAdmin` from custom claims
- ✅ Checks `isSeller` by verifying `storeName` in Firestore
- ✅ Forces token refresh to get latest claims

## 🔄 Schema Mapping

### Order Status Mapping
| Old (Mobile) | New (Schema) | Description |
|--------------|--------------|-------------|
| Processing | Processing | Initial state |
| Shipped | Sent | Order sent by seller |
| Delivered | Received | Order received by customer |
| - | Completed | Order fully completed |
| Cancelled | Cancelled | Order cancelled |
| - | Disputed | Order in dispute |

### Product Status Mapping
| Old (Mobile) | New (Schema) | Description |
|--------------|--------------|-------------|
| `isActive: true` | `status: 'active'` | Product is active |
| `isActive: false` | `status: 'inactive'` | Product is inactive |
| - | `status: 'draft'` | Product is draft |

### Field Name Changes
| Old | New | Collection |
|-----|-----|------------|
| `totalAmount` | `total` | orders |
| `images[]` | `imageUrl` | products |
| `isActive` | `status` | products |
| `shippingAddress` | `deliveryAddress` + `customerInfo` | orders |
| `returnPolicy` | `returns` | users.storePolicies |
| `shippingPolicy` | `shipping` | users.storePolicies |
| `refundPolicy` | `refunds` | users.storePolicies |

## 📝 Notes

1. **Order Items**: The schema uses `{ productId, name, price, quantity }` - no `subtotal` or `productImage`. Calculate subtotal as `quantity * price` in UI.

2. **Product Images**: Schema uses single `imageUrl` instead of `images[]` array. Updated all image handling to single image.

3. **Order Status Flow**: 
   - Processing → Sent → Received → Completed
   - Any status → Cancelled (with restrictions)
   - Received → Disputed (can be resolved)

4. **Product Status**: Three states: `active`, `draft`, `inactive`. All products visible to seller, but only `active` should be shown to customers (handled by backend).

5. **Timestamps**: All timestamps are Firestore `Timestamp` objects. Convert using `.toDate()` when needed.

## ✅ Verification Checklist

- [x] All types match Firebase schema
- [x] Order status values updated
- [x] Product status field updated
- [x] Order total field name updated
- [x] Order items structure updated
- [x] Product image field updated
- [x] Store policies field names updated
- [x] All UI screens updated
- [x] Analytics calculations updated
- [x] Notifications updated
- [x] API interfaces updated

## 🚀 Next Steps

1. Test with actual Firebase data
2. Verify all queries work with real data
3. Test order status transitions
4. Test product creation/editing
5. Verify analytics calculations

