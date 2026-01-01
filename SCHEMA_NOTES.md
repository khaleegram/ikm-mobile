# Firestore Schema Notes

This document outlines important schema differences and requirements between the client app and Firestore rules.

## Products Collection

### Schema Mismatch: `price` vs `initialPrice`

**Client-side (TypeScript/API):**
- Uses `price` field in TypeScript interfaces and API requests
- API endpoint: `POST /products` and `PUT /products/:id`

**Firestore Rules:**
- Rules expect `initialPrice` field (not `price`)
- Rule validation: `request.resource.data.initialPrice is number && request.resource.data.initialPrice > 0`

**Solution:**
- ✅ **Server-side API must convert `price` → `initialPrice` when writing to Firestore**
- ✅ Client-side hooks handle reading both fields (backward compatibility)
- ✅ No client-side changes needed - server handles conversion

**Example server-side conversion:**
```typescript
// Server-side (backend API)
const firestoreData = {
  ...productData,
  initialPrice: productData.price, // Convert price to initialPrice
  // Remove price field if it exists
};
await firestore.collection('products').doc(productId).set(firestoreData);
```

## Orders Collection

### Status Field

**Required Status Value:**
- Rules expect: `status == 'Processing'` (capital P)
- ✅ Client types already use `OrderStatus = 'Processing' | 'Sent' | ...`
- ✅ All order status references use correct capitalization

**Status Values (from rules and types):**
- `Processing` - Initial state (required for new orders)
- `Sent` - Order has been shipped
- `Received` - Order received by customer
- `Completed` - Order completed
- `Cancelled` - Order cancelled
- `Disputed` - Order in dispute

## Platform Settings Collection

### Write Restrictions

**Firestore Rules:**
- `allow write: if false` - No client-side writes allowed
- `allow read: if isAuthenticated()` - Authenticated users can read

**Implementation:**
- ✅ All writes go through API: `adminApi.updatePlatformSettings()`
- ✅ Client only reads via: `usePlatformSettings()` hook
- ✅ No direct Firestore writes from client

**Collection Path:**
- Document ID: `main` (single document)
- Full path: `platform_settings/main`

## Collection Names

All collection names match Firestore rules exactly:

| Collection | Rules Path | Client Code |
|------------|------------|-------------|
| Products | `/products/{productId}` | ✅ `collection(firestore, 'products')` |
| Stores | `/stores/{storeId}` | ✅ (via API only) |
| Users | `/users/{userId}` | ✅ `collection(firestore, 'users')` |
| Orders | `/orders/{orderId}` | ✅ `collection(firestore, 'orders')` |
| Order Messages | `/order_messages/{messageId}` | ✅ `collection(firestore, 'order_messages')` |
| Discount Codes | `/discount_codes/{codeId}` | ✅ (via API only) |
| Email Campaigns | `/email_campaigns/{campaignId}` | ✅ (via API only) |
| Shipping Zones | `/shipping_zones/{zoneId}` | ✅ (via API only) |
| Settings | `/settings/{settingId}` | ✅ (via API only) |
| Platform Settings | `/platform_settings/{settingsId}` | ✅ `doc(firestore, 'platform_settings', 'main')` |
| Payments | `/payments/{paymentId}` | ✅ (via API only) |
| Payouts | `/payouts/{payoutId}` | ✅ (via API only) |
| Transactions | `/transactions/{transactionId}` | ✅ (via API only) |
| Reviews | `/reviews/{reviewId}` | ✅ (via API only) |
| Wishlists | `/wishlists/{wishlistId}` | ✅ (via API only) |
| Notifications | `/notifications/{notificationId}` | ✅ (via API only) |
| Addresses | `/addresses/{addressId}` | ✅ (via API only) |

## Required Fields on Create

### Products
From rules: `request.resource.data.keys().hasAll(['name', 'description', 'initialPrice', 'sellerId'])`
- ✅ Client sends: `name`, `description`, `price`, `sellerId` (server converts `price` → `initialPrice`)

### Orders
From rules: `request.resource.data.keys().hasAll(['customerId', 'sellerId', 'items', 'total', 'status', 'createdAt'])`
- ✅ Status must be `'Processing'` (capital P)
- ✅ Total must be > 0
- ✅ Items must be non-empty list

### Users
From rules: `request.resource.data.keys().hasAll(['email', 'displayName'])`
- ✅ Client sends these fields on signup

## Field Validation Rules

### Products
- `name`: 1-200 characters (string)
- `description`: ≥10 characters (string)
- `initialPrice`: > 0 (number)

### Stores
- `storeName`: 1-100 characters (string)
- `storeDescription`: ≥10 characters (if provided)

### Order Messages
- `message`: 1-1000 characters (string)
- `senderRole`: must be in `['customer', 'seller', 'admin']`

## Important Notes

1. **All writes go through API endpoints** - Client never writes directly to Firestore
2. **Server must handle schema conversion** - `price` → `initialPrice` for products
3. **Status values are case-sensitive** - Use `'Processing'` not `'processing'`
4. **Platform settings writes are server-only** - Client can only read
5. **Collection names must match exactly** - Use snake_case as per rules

