# Seller Identification & Logout Updates

## ✅ Changes Made

### 1. Seller Identification Fix
**File:** `lib/firebase/auth/use-user.ts`

**Change:** Updated seller identification to check for `role: 'seller'` in the users collection instead of checking for `storeName`.

**Before:**
```typescript
isSeller = !!userData.storeName;
```

**After:**
```typescript
isSeller = userData.role === 'seller';
```

This now correctly identifies sellers based on the `role` field in the users collection, matching your Firebase schema.

### 2. Admin Logout Button
**File:** `app/(admin)/index.tsx`

**Added:**
- Logout button in the admin dashboard header
- Confirmation dialog before logout
- Proper navigation to login screen after logout

**Location:** Top right of the admin dashboard header, next to the admin badge icon.

### 3. Seller Logout Button
**File:** `app/settings.tsx`

**Added:**
- Logout button in the settings screen header
- Confirmation dialog before logout
- Proper navigation to login screen after logout
- Theme-aware styling

**Location:** Top right of the settings screen header, next to the Save button.

## 🔍 How Seller Identification Works

1. User logs in via Firebase Auth
2. System checks Firebase Auth custom claims for `isAdmin`
3. System fetches user document from Firestore `users` collection
4. System checks if `userData.role === 'seller'`
5. User is granted access if they are either:
   - Admin (from custom claims)
   - Seller (from `role` field in users collection)

## 🚪 Logout Functionality

Both admin and seller logout buttons:
1. Show a confirmation dialog
2. Call `signOut()` from `useUser()` hook
3. Clear AsyncStorage session
4. Navigate to login screen
5. Handle errors gracefully

## 📝 Notes

- The `role` field must be set to `'seller'` in the users collection for seller identification
- Admins are identified via Firebase Auth custom claims (`isAdmin: true`)
- Logout clears both Firebase Auth session and local storage
- All logout actions require user confirmation

