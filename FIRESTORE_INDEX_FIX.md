# Firestore Index Fix

## ✅ Issue Fixed

### Problem
The products query was requiring a composite index that wasn't created:
- Query: `where('sellerId', '==', sellerId) + where('status', 'in', [...]) + orderBy('status') + orderBy('createdAt', 'desc')`
- Required index: `products` collection with fields: `sellerId`, `status`, `createdAt`

### Solution
Simplified the query to only use the existing index:
- Removed `where('status', 'in', [...])` filter
- Removed `orderBy('status')`
- Now only queries: `where('sellerId', '==', sellerId) + orderBy('createdAt', 'desc')`
- This matches your existing index: `products` with `sellerId` and `createdAt`

**File Changed:** `lib/firebase/firestore/products.ts`

## 📋 Your Existing Indexes (Verified)

✅ **orders** - `sellerId` + `createdAt` - Used for seller orders
✅ **orders** - `customerId` + `createdAt` - Used for customer orders  
✅ **products** - `sellerId` + `createdAt` - Used for seller products (now matches query)
✅ **addresses** - `userId` + `isDefault` + `createdAt`
✅ **notifications** - `userId` + `createdAt`
✅ **shipping_zones** - `sellerId` + `createdAt`
✅ **wishlists** - `userId` + `createdAt`

## 🔍 Seller Login Redirect Issue

Added debug logging to help diagnose why sellers are still getting redirected:

1. **In `use-user.ts`**: Logs when checking user role
2. **In `_layout.tsx`**: Logs access check details

Check the console logs to see:
- What role is being read from Firestore
- Whether `isSeller` is being set correctly
- What the access check result is

## 🐛 Debugging Steps

If sellers are still getting redirected:

1. Check console logs for:
   - "User role check:" - Shows what role was found
   - "Access check:" - Shows access decision

2. Verify in Firestore:
   - User document exists at `users/{userId}`
   - Document has `role: 'seller'` field (string, not boolean)

3. Check timing:
   - The `useUser` hook might be checking before the user document is created
   - After signup, wait a moment for Firestore write to complete

## 📝 Notes

- The products query now fetches all products for a seller (regardless of status)
- You can filter by status in the UI if needed
- If you need status filtering in the query later, create a composite index:
  - Collection: `products`
  - Fields: `sellerId` (Ascending), `status` (Ascending), `createdAt` (Descending)

