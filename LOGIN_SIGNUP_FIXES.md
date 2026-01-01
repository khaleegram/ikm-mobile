# Login & Signup Fixes

## ✅ Issues Fixed

### 1. Login Access Denied Issue
**Problem:** Sellers were getting "Access Denied" alert even after successful login.

**Root Cause:** 
- Login screen was checking `storeName` instead of `role: 'seller'`
- Login screen was showing alert and signing out before the `useUser` hook could properly set the `isSeller` flag
- Access control was happening too early in the login flow

**Fix:**
- Updated login screen to check `role: 'seller'` instead of `storeName`
- Removed premature access check from login screen
- Let the `useUser` hook and root layout handle access control after authentication state is properly set
- Access control now happens in `_layout.tsx` after user state is fully loaded

**Files Changed:**
- `app/(auth)/login.tsx` - Removed premature access check, updated to check `role: 'seller'`

### 2. Signup Not Creating Seller Role
**Problem:** New accounts created via signup didn't have the `role: 'seller'` field.

**Root Cause:**
- Signup screen was creating user document without the `role` field

**Fix:**
- Added `role: 'seller'` field when creating user document in Firestore
- Used `serverTimestamp()` for proper Firestore timestamps

**Files Changed:**
- `app/(auth)/signup.tsx` - Added `role: 'seller'` field to user document creation

### 3. Access Control Flow
**Updated:** `app/_layout.tsx`
- Access control now properly checks `hasAppAccess(user)` after user state is loaded
- Shows appropriate alert if user doesn't have access
- Properly routes admins to admin panel and sellers to tabs

## 🔄 How It Works Now

### Signup Flow:
1. User creates account with email/password
2. Firebase Auth account is created
3. User document is created in Firestore with:
   - `role: 'seller'` ✅
   - `email`, `displayName`
   - `isAdmin: false`
   - Timestamps
4. `useUser` hook detects auth state change
5. Fetches user document and checks `role === 'seller'`
6. Sets `isSeller: true` in auth state
7. Root layout checks access and routes to `/(tabs)`

### Login Flow:
1. User enters email/password
2. Firebase Auth authenticates
3. Login screen checks `role: 'seller'` (for display only)
4. `useUser` hook detects auth state change
5. Fetches user document and checks `role === 'seller'`
6. Sets `isSeller: true` in auth state
7. Root layout checks `hasAppAccess(user)`
8. If access granted, routes to appropriate screen
9. If no access, shows alert and redirects to login

## 📝 Important Notes

- **Role Field:** Must be set to `'seller'` in the users collection for seller identification
- **Admin Claims:** Admins are identified via Firebase Auth custom claims (`isAdmin: true`)
- **Access Control:** Happens in root layout after user state is fully loaded
- **Timestamps:** Use `serverTimestamp()` for Firestore timestamps, not `new Date()`

## ✅ Verification

After these fixes:
- ✅ New signups automatically get `role: 'seller'`
- ✅ Sellers can login without "Access Denied" alert
- ✅ Access control happens at the right time in the flow
- ✅ Proper routing for admins and sellers

