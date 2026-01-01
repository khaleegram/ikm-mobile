# Environment Variables Setup Guide

## Quick Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. The `.env` file is already configured with your Firebase credentials converted from web format.

## Environment Variables Conversion

### Web to Mobile Conversion

| Web (Next.js) | Mobile (Expo) | Description |
|---------------|---------------|-------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | `EXPO_PUBLIC_FIREBASE_API_KEY` | Firebase API Key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase Auth Domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | Firebase Project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase Storage Bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase Messaging Sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | `EXPO_PUBLIC_FIREBASE_APP_ID` | Firebase App ID |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | `EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY` | Paystack Public Key |

### Included Variables

✅ **Firebase Client Config** - All public Firebase values
✅ **Paystack Public Key** - Safe to expose in mobile apps
✅ **API Base URL** - Your backend API endpoint

### Excluded Variables (Server-Only)

❌ **GEMINI_API_KEY** - Server-only, not needed in mobile
❌ **PAYSTACK_SECRET_KEY** - Server-only, never expose in mobile
❌ **FIREBASE_SERVICE_ACCOUNT_KEY** - Server-only, never expose in mobile
❌ **AUTH_COOKIE_*** - Server-only, not applicable to mobile

## Configuration

### Firebase Configuration

All Firebase values are already converted and ready to use. The app will automatically use these values from the `.env` file.

### Backend API URL

Update `EXPO_PUBLIC_API_BASE_URL` with your actual backend URL:

- **Local Development**: `http://localhost:3000/api`
- **Production**: `https://your-api-domain.com/api`

### Paystack

Only the public key is included. The secret key should remain on your backend server only.

## Security Notes

⚠️ **Important**: 
- Never commit `.env` file to version control
- Only include public/client-side values in mobile `.env`
- Server secrets should remain on your backend only
- The `.env.example` file is safe to commit (contains no secrets)

## Usage in Code

Environment variables are accessed via `process.env.EXPO_PUBLIC_*`:

```typescript
const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
```

## Troubleshooting

If environment variables are not loading:

1. Make sure `.env` file exists in the root directory
2. Restart the Expo development server after changing `.env`
3. Clear cache: `npx expo start -c`
4. Check that variable names start with `EXPO_PUBLIC_`

