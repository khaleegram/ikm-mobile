# Backend Setup Guide

## Current Setup

Your app uses **two types of backends**:

### 1. Cloud Functions (✅ Ready)
- All order operations
- Order chat
- Payout operations
- **Status**: Fully integrated and working

### 2. REST API Backend (⚠️ Needs Configuration)
- Product create/update/delete
- User profile updates
- Admin operations
- Platform settings

## Configuration Required

### Environment Variables

Create or update your `.env` file:

```env
# Firebase Configuration
EXPO_PUBLIC_FIREBASE_API_KEY=your-api-key
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your-auth-domain
EXPO_PUBLIC_FIREBASE_PROJECT_ID=ikm-marketplace
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your-storage-bucket
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
EXPO_PUBLIC_FIREBASE_APP_ID=your-app-id

# Backend API URL (REQUIRED for products, users, admin)
EXPO_PUBLIC_API_BASE_URL=https://your-backend-url.com/api
# OR if using Cloud Functions for everything:
# EXPO_PUBLIC_API_BASE_URL=https://your-cloud-function-url.com
```

## What Needs Backend API?

### Products
- ✅ **Read**: Uses Firestore (works offline)
- ❌ **Create/Update/Delete**: Needs backend API or Cloud Function

**Options:**
1. **Use your existing backend** - Set `EXPO_PUBLIC_API_BASE_URL`
2. **Create Cloud Functions** - For `createProduct`, `updateProduct`, `deleteProduct`
3. **Use Firestore directly** - Not recommended (security rules prevent this)

### Users
- ✅ **Read**: Uses Firestore (works offline)
- ❌ **Update**: Needs backend API or Cloud Function

### Admin
- ❌ **All operations**: Need backend API or Cloud Functions

## Quick Fix Options

### Option 1: Use Your Existing Backend
If you have a backend server running:

1. Set `EXPO_PUBLIC_API_BASE_URL` in `.env`
2. Make sure backend accepts Firebase ID tokens
3. Backend should handle product/user/admin operations

### Option 2: Create Cloud Functions
If you want to use Cloud Functions for everything:

1. Create Cloud Functions for:
   - `createProduct`
   - `updateProduct`
   - `deleteProduct`
   - `updateUserProfile`
   - `updatePlatformSettings`
   - `updateUserRole`

2. Provide the URLs and I'll integrate them

### Option 3: Temporary Workaround
For testing, you can temporarily allow direct Firestore writes (NOT RECOMMENDED FOR PRODUCTION):

1. Update Firestore rules to allow writes
2. Update product API to write directly to Firestore
3. **Remember to revert before production!**

## Testing Your Setup

### Test Cloud Functions
```typescript
import { cloudFunctions } from '@/lib/api/cloud-functions';

// This should work
try {
  const banks = await cloudFunctions.getBanksList();
  console.log('✅ Cloud Functions working!', banks);
} catch (error) {
  console.error('❌ Cloud Functions error:', error);
}
```

### Test Backend API
```typescript
import { apiClient } from '@/lib/api/client';

// This needs EXPO_PUBLIC_API_BASE_URL to be set
try {
  const response = await apiClient.get('/health');
  console.log('✅ Backend API working!', response);
} catch (error) {
  console.error('❌ Backend API error:', error);
}
```

## Current Status

| Feature | Status | Backend Type |
|---------|--------|--------------|
| Orders | ✅ Working | Cloud Functions |
| Order Chat | ✅ Working | Cloud Functions |
| Payouts | ✅ Working | Cloud Functions |
| Products (Read) | ✅ Working | Firestore |
| Products (Write) | ❌ Needs config | Backend API or Cloud Function |
| Users (Read) | ✅ Working | Firestore |
| Users (Write) | ❌ Needs config | Backend API or Cloud Function |
| Admin | ❌ Needs config | Backend API or Cloud Function |

## Next Steps

1. **Check your backend URL** - Is it running? Is it accessible?
2. **Set environment variable** - `EXPO_PUBLIC_API_BASE_URL`
3. **Or provide Cloud Function URLs** - For product/user/admin operations
4. **Test** - Try creating a product and see what error you get

## Error Messages

If you see "Network request failed":
- Backend is not running
- `EXPO_PUBLIC_API_BASE_URL` is not set or incorrect
- CORS issues (check backend CORS settings)
- Internet connection issue

If you see "Cannot connect to backend server":
- Backend URL is wrong
- Backend is not accessible from your device/emulator
- Firewall blocking the connection

