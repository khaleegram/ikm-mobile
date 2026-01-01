# IKM Marketplace - Mobile App

Mobile application for sellers to manage their store, products, and orders on the IKM Marketplace platform.

## Features

- ✅ Seller authentication (login/signup)
- ✅ Seller dashboard with statistics
- ✅ Product management (create, edit, view)
- ✅ Order management (view, update status)
- ✅ Store settings management
- ✅ Real-time data updates via Firestore listeners

## Architecture

This app follows a strict client-server separation architecture:

- **Client-side**: Read-only operations with real-time Firestore listeners
- **Backend API**: All write operations go through backend endpoints
- **Security**: Firebase Auth with custom claims for role management
- **Data Flow**: Real-time listeners for reads, API calls for writes

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture documentation.

## Setup

### Prerequisites

- Node.js 18+
- Expo CLI
- Firebase project with Firestore and Authentication enabled

### Installation

1. Install dependencies:
```bash
npm install
```

2. Configure Firebase:
   - Copy `.env.example` to `.env`
   - Fill in your Firebase configuration values

3. Start the development server:
```bash
npm start
```

### Environment Variables

Create a `.env` file in the root directory:

```
EXPO_PUBLIC_FIREBASE_API_KEY=your-api-key
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your-auth-domain
EXPO_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your-storage-bucket
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
EXPO_PUBLIC_FIREBASE_APP_ID=your-app-id
EXPO_PUBLIC_API_BASE_URL=http://localhost:3000/api
```

## Project Structure

```
app/
  (auth)/          # Authentication screens (login, signup)
  (tabs)/          # Main app tabs (dashboard, products, orders)
  products/        # Product detail/edit screens
  orders/          # Order detail screen
  settings.tsx     # Store settings screen

lib/
  firebase/
    config.ts      # Firebase initialization
    auth/          # Authentication hooks
    firestore/     # Read-only Firestore hooks
  api/             # Backend API client and endpoints

types/             # TypeScript type definitions
```

## Important Notes

- **No Buyer Features**: This mobile app does NOT include customer/buyer functionality. All purchases must be completed through the web application.
- **Backend Required**: This app requires a backend API server to handle write operations. The API base URL is configured via `EXPO_PUBLIC_API_BASE_URL`.
- **Firebase Security Rules**: Ensure your Firestore security rules are properly configured to match the architecture (see ARCHITECTURE.md).

## Development

### Running on iOS
```bash
npm run ios
```

### Running on Android
```bash
npm run android
```

### Running on Web
```bash
npm run web
```

## Next Steps

1. Set up your Firebase project and configure security rules
2. Deploy your backend API server
3. Configure environment variables
4. Test authentication flow
5. Add image upload functionality for products
6. Implement offline support and caching
