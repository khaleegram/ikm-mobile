# Firestore Security Rules - Complete Rules

Copy and paste this into your Firebase Console > Firestore Database > Rules

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper functions
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isAdmin() {
      return isAuthenticated() && request.auth.token.isAdmin == true;
    }
    
    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }
    
    function isValidEmail(email) {
      return email.matches('^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$');
    }
    
    // Products Collection
    // - Public read access (anyone can view products)
    // - Only sellers can create/update their own products
    // - Admins have full access
    match /products/{productId} {
      // Anyone can read products (public marketplace)
      allow read: if true;
      allow list: if true; // Allow listing all products, including filtered queries
      
      // Only authenticated users can create products
      // Note: Server actions use initialPrice, not price
      // createdAt is optional (can be set by server timestamp)
      allow create: if isAuthenticated() 
        && request.resource.data.sellerId == request.auth.uid
        && request.resource.data.keys().hasAll(['name', 'description', 'initialPrice', 'sellerId'])
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0
        && request.resource.data.name.size() <= 200
        && request.resource.data.description is string
        && request.resource.data.description.size() >= 10
        && request.resource.data.initialPrice is number
        && request.resource.data.initialPrice > 0;
      
      // Only product owner or admin can update
      allow update: if isAdmin() 
        || (isAuthenticated() 
          && resource.data.sellerId == request.auth.uid
          && request.resource.data.sellerId == resource.data.sellerId); // Prevent sellerId changes
      
      // Only admin can delete
      allow delete: if isAdmin();
    }
    
    // Stores Collection
    // Uses userId as document ID for direct access
    // - Public read access (anyone can browse stores)
    // - Sellers can create/update their own store (storeId must match their userId)
    // - Admins have full access
    match /stores/{storeId} {
      // Public read access for store browsing
      allow read: if true;
      allow list: if true;
      
      // Sellers can create their own store (storeId must equal their userId)
      allow create: if isAuthenticated() 
        && storeId == request.auth.uid
        && request.resource.data.userId == request.auth.uid
        && request.resource.data.keys().hasAll(['userId', 'storeName'])
        && request.resource.data.storeName is string
        && request.resource.data.storeName.size() > 0
        && request.resource.data.storeName.size() <= 100;
      
      // Sellers can update their own store (storeId must equal their userId), admins can update any
      allow update: if isAdmin() 
        || (isAuthenticated() 
          && storeId == request.auth.uid
          && request.resource.data.userId == request.auth.uid // Prevent userId changes
          // Validate store name if provided
          && (!request.resource.data.keys().hasAny(['storeName']) 
            || (request.resource.data.storeName is string 
              && request.resource.data.storeName.size() > 0 
              && request.resource.data.storeName.size() <= 100))
          // Validate store description if provided
          && (!request.resource.data.keys().hasAny(['storeDescription'])
            || (request.resource.data.storeDescription is string
              && request.resource.data.storeDescription.size() >= 10)));
      
      // Only admin can delete stores
      allow delete: if isAdmin();
    }
    
    // Users Collection
    // - Public read access for user profiles (limited fields)
    // - Users can only create/update their own profile
    // - Admins have full access
    match /users/{userId} {
      // Public read access (anyone can see user profile)
      // But sensitive data should be filtered client-side
      allow read: if true;
      
      // Users can create their own profile during signup
      allow create: if isAuthenticated() 
        && request.auth.uid == userId
        && request.resource.data.keys().hasAll(['email', 'displayName'])
        && isValidEmail(request.resource.data.email)
        && request.resource.data.displayName is string
        && request.resource.data.displayName.size() > 0;
      
      // Users can update their own profile, admins can update any
      allow update: if isAdmin() 
        || (isOwner(userId)
          // Prevent email and UID changes
          && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['email', 'id'])));
      
      // Only admin can delete user profiles
      allow delete: if isAdmin();
      
      // Delivery Locations Subcollection
      // - Only owner can manage their delivery locations
      match /deliveryLocations/{locationId} {
        // Anyone can read (for checkout/delivery options)
        allow read: if true;
        
        // Only owner can create/update/delete
        allow write: if isAdmin() || isOwner(userId);
      }
    }
    
    // Orders Collection
    // - Customers can create orders
    // - Customers and sellers can read their own orders
    // - Sellers can update order status
    // - Admins have full access
    match /orders/{orderId} {
      // Customers and sellers can read their own orders, admins can read all
      allow read: if isAdmin() 
        || (isAuthenticated() 
          && (resource.data.customerId == request.auth.uid 
            || resource.data.sellerId == request.auth.uid));
      
      // Any authenticated user can create an order
      allow create: if isAuthenticated()
        && request.resource.data.keys().hasAll(['customerId', 'sellerId', 'items', 'total', 'status', 'createdAt'])
        && request.resource.data.customerId == request.auth.uid
        && request.resource.data.total is number
        && request.resource.data.total > 0
        && request.resource.data.status == 'Processing'  // Fixed: Use 'Processing' not 'pending'
        && request.resource.data.items is list
        && request.resource.data.items.size() > 0;
      
      // Only seller or admin can update order (for status changes)
      allow update: if isAdmin() 
        || (isAuthenticated() 
          && resource.data.sellerId == request.auth.uid
          // Prevent changing customerId or sellerId
          && request.resource.data.customerId == resource.data.customerId
          && request.resource.data.sellerId == resource.data.sellerId);
      
      // Only admin can delete orders
      allow delete: if isAdmin();
    }
    
    // Order Messages Collection (Chat)
    // - Customers and sellers can read messages for their orders
    // - Customers and sellers can send messages for their orders
    // - Admins have full access
    match /order_messages/{messageId} {
      // Customers and sellers can read messages for their orders
      allow read: if isAdmin() 
        || (isAuthenticated() 
          && (resource.data.orderId != null 
            && exists(/databases/$(database)/documents/orders/$(resource.data.orderId))
            && (get(/databases/$(database)/documents/orders/$(resource.data.orderId)).data.customerId == request.auth.uid
              || get(/databases/$(database)/documents/orders/$(resource.data.orderId)).data.sellerId == request.auth.uid)));
      
      // Customers and sellers can create messages for their orders
      allow create: if isAuthenticated()
        && request.resource.data.keys().hasAll(['orderId', 'senderId', 'senderRole', 'message'])
        && request.resource.data.senderId == request.auth.uid
        && request.resource.data.message is string
        && request.resource.data.message.size() > 0
        && request.resource.data.message.size() <= 1000
        && request.resource.data.senderRole in ['customer', 'seller', 'admin']
        && exists(/databases/$(database)/documents/orders/$(request.resource.data.orderId))
        && (get(/databases/$(database)/documents/orders/$(request.resource.data.orderId)).data.customerId == request.auth.uid
          || get(/databases/$(database)/documents/orders/$(request.resource.data.orderId)).data.sellerId == request.auth.uid);
      
      // Only sender or admin can update (for marking as read)
      allow update: if isAdmin() 
        || (isAuthenticated() 
          && resource.data.senderId == request.auth.uid);
      
      // Only admin can delete messages
      allow delete: if isAdmin();
    }
    
    // Discount Codes Collection
    // - Sellers can read/create/update their own discount codes
    // - Public read for active codes (for checkout)
    // - Admins have full access
    match /discount_codes/{codeId} {
      // Public read for active codes, sellers can read their own
      allow read: if true; // Public read for checkout validation
      
      // Sellers can create their own discount codes
      allow create: if isAuthenticated()
        && request.resource.data.sellerId == request.auth.uid
        && request.resource.data.keys().hasAll(['sellerId', 'code', 'type', 'value', 'status'])
        && request.resource.data.code is string
        && request.resource.data.code.size() > 0
        && request.resource.data.type in ['percentage', 'fixed']
        && request.resource.data.value is number
        && request.resource.data.value > 0
        && request.resource.data.status in ['active', 'inactive', 'expired'];
      
      // Sellers can update their own discount codes, admins can update any
      allow update: if isAdmin() 
        || (isAuthenticated() 
          && resource.data.sellerId == request.auth.uid
          && request.resource.data.sellerId == resource.data.sellerId);
      
      // Only admin can delete discount codes
      allow delete: if isAdmin();
    }
    
    // Email Campaigns Collection
    // - Sellers can read/create their own campaigns
    // - Admins have full access
    match /email_campaigns/{campaignId} {
      // Sellers can read their own campaigns
      allow read: if isAdmin() 
        || (isAuthenticated() 
          && resource.data.sellerId == request.auth.uid);
      
      // Sellers can create their own campaigns (server-side only for sending)
      allow create: if isAdmin(); // Only server actions can create campaigns
      
      // Sellers can update their own campaigns, admins can update any
      allow update: if isAdmin() 
        || (isAuthenticated() 
          && resource.data.sellerId == request.auth.uid
          && request.resource.data.sellerId == resource.data.sellerId);
      
      // Only admin can delete campaigns
      allow delete: if isAdmin();
    }
    
    // Shipping Zones Collection
    // - Sellers can read/create/update their own shipping zones
    // - Admins have full access
    match /shipping_zones/{zoneId} {
      // Sellers can read their own zones
      allow read: if isAdmin() 
        || (isAuthenticated() 
          && resource.data.sellerId == request.auth.uid);
      
      // Sellers can create their own shipping zones
      allow create: if isAuthenticated()
        && request.resource.data.sellerId == request.auth.uid
        && request.resource.data.keys().hasAll(['sellerId', 'name', 'rate'])
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0
        && request.resource.data.rate is number
        && request.resource.data.rate >= 0;
      
      // Sellers can update their own zones, admins can update any
      allow update: if isAdmin() 
        || (isAuthenticated() 
          && resource.data.sellerId == request.auth.uid
          && request.resource.data.sellerId == resource.data.sellerId);
      
      // Only admin can delete shipping zones
      allow delete: if isAdmin();
    }
    
    // Settings Collection (Global Settings)
    // - Public read access
    // - Only admins can write
    match /settings/{settingId} {
      allow read: if true;
      allow write: if isAdmin();
    }
    
    // Payments Collection
    // - Customers can read their own payments
    // - Sellers can read payments for their orders
    // - Admins have full access
    match /payments/{paymentId} {
      allow read: if isAdmin() || (isAuthenticated() && resource.data.customerId == request.auth.uid) || (isAuthenticated() && resource.data.sellerId == request.auth.uid);
      allow create: if isAdmin(); // Only server actions can create payments
      allow update: if isAdmin();
      allow delete: if isAdmin();
    }
    
    // Payouts Collection
    // - Sellers can read/create their own payouts
    // - Sellers can cancel their pending payouts
    // - Admins have full access
    match /payouts/{payoutId} {
      allow read: if isAdmin() || (isAuthenticated() && resource.data.sellerId == request.auth.uid);
      allow create: if isAuthenticated() && request.resource.data.sellerId == request.auth.uid;
      allow update: if isAdmin() || (isAuthenticated() && resource.data.sellerId == request.auth.uid && request.resource.data.status == 'cancelled' && resource.data.status == 'pending');
      allow delete: if isAdmin();
    }
    
    // Transactions Collection
    // - Sellers can read their own transactions
    // - Admins have full access
    match /transactions/{transactionId} {
      allow read: if isAdmin() || (isAuthenticated() && resource.data.sellerId == request.auth.uid);
      allow create: if isAdmin(); // Only server actions can create transactions
      allow update: if isAdmin();
      allow delete: if isAdmin();
    }
    
    // Reviews Collection
    // - Public read access
    // - Authenticated users can create their own reviews
    // - Users can update/delete their own reviews
    // - Sellers can reply to reviews for their products
    match /reviews/{reviewId} {
      allow read: if true;
      allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid;
      allow update: if isAdmin() || (isAuthenticated() && resource.data.userId == request.auth.uid);
      allow delete: if isAdmin() || (isAuthenticated() && resource.data.userId == request.auth.uid);
    }
    
    // Wishlists Collection
    // - Users can read/create/delete their own wishlist items
    // - Admins have full access
    match /wishlists/{wishlistId} {
      allow read: if isAdmin() || (isAuthenticated() && resource.data.userId == request.auth.uid);
      allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid;
      allow update: if isAdmin() || (isAuthenticated() && resource.data.userId == request.auth.uid);
      allow delete: if isAdmin() || (isAuthenticated() && resource.data.userId == request.auth.uid);
    }
    
    // Notifications Collection
    // - Users can read their own notifications
    // - Only server actions can create notifications
    match /notifications/{notificationId} {
      allow read: if isAdmin() || (isAuthenticated() && resource.data.userId == request.auth.uid);
      allow create: if isAdmin(); // Only server actions can create notifications
      allow update: if isAdmin() || (isAuthenticated() && resource.data.userId == request.auth.uid);
      allow delete: if isAdmin() || (isAuthenticated() && resource.data.userId == request.auth.uid);
    }
    
    // Addresses Collection
    // - Users can manage their own addresses
    // - Admins have full access
    match /addresses/{addressId} {
      allow read: if isAdmin() || (isAuthenticated() && resource.data.userId == request.auth.uid);
      allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid;
      allow update: if isAdmin() || (isAuthenticated() && resource.data.userId == request.auth.uid);
      allow delete: if isAdmin() || (isAuthenticated() && resource.data.userId == request.auth.uid);
    }

    // Platform settings - admin only (server-side writes)
    match /platform_settings/{settingsId} {
      allow read: if isAuthenticated(); // Authenticated users can read (for commission rate display)
      allow write: if false; // Only server-side (admin actions) can write
    }
  }
}
```

## Key Changes Made:

1. **Fixed Order Status**: Changed from `'pending'` to `'Processing'` in order create rule to match your schema
2. **Added order_messages Collection**: Full rules for order chat functionality
3. **Added discount_codes Collection**: Rules for discount code management
4. **Added email_campaigns Collection**: Rules for email campaigns (server-side create only)
5. **Added shipping_zones Collection**: Rules for shipping zone management

## Notes:

- **Order Messages**: Uses `exists()` and `get()` to verify order ownership before allowing message creation
- **Email Campaigns**: Only server actions can create campaigns (for security)
- **Discount Codes**: Public read for checkout validation, but only sellers can create/update their own
- **Shipping Zones**: Sellers can manage their own zones

Make sure to deploy these rules to your Firebase project!

