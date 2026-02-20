# Market Street Cloud Functions - Backend Implementation Guide

This document describes the Cloud Functions that need to be implemented on the backend for the Market Street feature. All client-side integrations are already complete and ready to use these endpoints.

## Overview

Market Street is a TikTok-style vertical product feed for buyers. All write operations must go through Cloud Functions to maintain security and data integrity.

## Base URLs

All Cloud Functions should be deployed to Firebase Cloud Functions and accessible at:
- `https://[function-name]-q3rjv54uka-uc.a.run.app`

## Authentication

All authenticated endpoints require:
- `Authorization: Bearer <Firebase ID Token>` header
- Token verification using Firebase Admin SDK
- User ID extraction from verified token

## Function Specifications

### 7.1 Market Post Functions

#### `createMarketPost`

**Endpoint:** `https://createmarketpost-q3rjv54uka-uc.a.run.app`  
**Method:** `POST`  
**Auth Required:** Yes

**Request Body:**
```json
{
  "images": ["data:image/jpeg;base64,...", ...], // 1-20 base64 encoded images
  "hashtags": ["fashion", "vintage"], // Optional, array of strings
  "price": 15000, // Optional, number
  "description": "Beautiful vintage dress", // Optional, string
  "location": { // Optional
    "state": "Lagos",
    "city": "Ikeja"
  },
  "contactMethod": "in-app" // Optional, "in-app" | "whatsapp", default: "in-app"
}
```

**Validation:**
- `images`: Required, array of 1-20 base64 encoded images
- Each image must be valid base64 data URI (starts with `data:image/...`)
- `hashtags`: Optional, max 10 hashtags, each max 30 characters, lowercase, alphanumeric only
- `price`: Optional, positive number if provided
- `description`: Optional, max 1000 characters
- `location.state` and `location.city`: Optional, strings if provided

**Processing:**
1. Verify user authentication
2. Validate image count (1-20)
3. Decode base64 images
4. Upload images to Firebase Storage at path: `marketPosts/{postId}/{imageIndex}.jpg`
5. Get download URLs for all images
6. Normalize hashtags (lowercase, remove special chars)
7. Create Firestore document in `marketPosts` collection:
   ```typescript
   {
     posterId: userId,
     images: [downloadURL1, downloadURL2, ...],
     hashtags: ["fashion", "vintage"],
     price: 15000, // or undefined if not provided
     description: "Beautiful vintage dress",
     location: { state: "Lagos", city: "Ikeja" },
     contactMethod: "in-app",
     likes: 0,
     views: 0,
     comments: 0,
     likedBy: [],
     status: "active",
     createdAt: serverTimestamp(),
     updatedAt: serverTimestamp(),
     expiresAt: null // Optional, can set to 30 days from now
   }
   ```
8. Update `trendingHashtags` collection for each hashtag:
   - Increment count if exists, or create new document
   - Document structure: `{ tag: "fashion", count: 5 }`

**Response:**
```json
{
  "success": true,
  "post": { /* MarketPost object */ },
  "postId": "abc123"
}
```

**Error Responses:**
- `400`: Invalid input (missing images, too many images, invalid format)
- `401`: Unauthenticated
- `500`: Server error

---

#### `likeMarketPost`

**Endpoint:** `https://likemarketpost-q3rjv54uka-uc.a.run.app`  
**Method:** `POST`  
**Auth Required:** Yes

**Request Body:**
```json
{
  "postId": "abc123"
}
```

**Processing:**
1. Verify user authentication
2. Get post document from `marketPosts/{postId}`
3. Check if user already liked (check `likedBy` array)
4. If not liked:
   - Add userId to `likedBy` array
   - Increment `likes` count
5. If already liked:
   - Remove userId from `likedBy` array
   - Decrement `likes` count
6. Use Firestore transactions to ensure atomicity

**Response:**
```json
{
  "success": true,
  "likes": 42,
  "isLiked": true
}
```

**Error Responses:**
- `400`: Invalid postId
- `401`: Unauthenticated
- `404`: Post not found
- `500`: Server error

---

#### `deleteMarketPost`

**Endpoint:** `https://deletemarketpost-q3rjv54uka-uc.a.run.app`  
**Method:** `POST`  
**Auth Required:** Yes

**Request Body:**
```json
{
  "postId": "abc123"
}
```

**Processing:**
1. Verify user authentication
2. Get post document from `marketPosts/{postId}`
3. Verify `posterId === userId` (only poster can delete)
4. Delete all images from Firebase Storage (`marketPosts/{postId}/*`)
5. Delete post document from Firestore
6. Update `trendingHashtags` collection (decrement counts for hashtags)
7. Delete all comments in `marketPostComments` where `postId === postId`
8. Delete all messages in `marketChats` where `postId === postId`

**Response:**
```json
{
  "success": true,
  "message": "Post deleted successfully"
}
```

**Error Responses:**
- `400`: Invalid postId
- `401`: Unauthenticated
- `403`: Not authorized (not the poster)
- `404`: Post not found
- `500`: Server error

---

#### `incrementPostViews`

**Endpoint:** `https://incrementpostviews-q3rjv54uka-uc.a.run.app`  
**Method:** `POST`  
**Auth Required:** No (Public endpoint)

**Request Body:**
```json
{
  "postId": "abc123"
}
```

**Processing:**
1. Get post document from `marketPosts/{postId}`
2. Use Firestore `increment()` to atomically increment `views` field
3. No need to verify authentication (public endpoint)

**Response:**
```json
{
  "success": true,
  "message": "Views incremented"
}
```

**Error Responses:**
- `400`: Invalid postId
- `404`: Post not found
- `500`: Server error

---

### 7.2 Market Comment Functions

#### `createMarketComment`

**Endpoint:** `https://createmarketcomment-q3rjv54uka-uc.a.run.app`  
**Method:** `POST`  
**Auth Required:** Yes

**Request Body:**
```json
{
  "postId": "abc123",
  "comment": "This looks great! How much?"
}
```

**Validation:**
- `postId`: Required, valid post ID
- `comment`: Required, string, 1-500 characters

**Processing:**
1. Verify user authentication
2. Validate comment text (trim, check length)
3. Get post document to verify it exists and is active
4. Create comment document in `marketPostComments` collection:
   ```typescript
   {
     postId: "abc123",
     userId: userId,
     comment: "This looks great! How much?",
     createdAt: serverTimestamp(),
     updatedAt: serverTimestamp()
   }
   ```
5. Atomically increment `comments` count in post document

**Response:**
```json
{
  "success": true,
  "commentId": "comment123",
  "message": "Comment added successfully"
}
```

**Error Responses:**
- `400`: Invalid input (missing comment, too long, etc.)
- `401`: Unauthenticated
- `404`: Post not found
- `500`: Server error

---

#### `deleteMarketComment`

**Endpoint:** `https://deletemarketcomment-q3rjv54uka-uc.a.run.app`  
**Method:** `POST`  
**Auth Required:** Yes

**Request Body:**
```json
{
  "commentId": "comment123"
}
```

**Processing:**
1. Verify user authentication
2. Get comment document from `marketPostComments/{commentId}`
3. Verify `userId === comment.userId` (only commenter can delete)
4. Get `postId` from comment
5. Delete comment document
6. Atomically decrement `comments` count in post document

**Response:**
```json
{
  "success": true,
  "message": "Comment deleted successfully"
}
```

**Error Responses:**
- `400`: Invalid commentId
- `401`: Unauthenticated
- `403`: Not authorized (not the commenter)
- `404`: Comment not found
- `500`: Server error

---

### 7.3 Market Message Functions

#### `createMarketChat`

**Endpoint:** `https://createmarketchat-q3rjv54uka-uc.a.run.app`  
**Method:** `POST`  
**Auth Required:** Yes

**Request Body:**
```json
{
  "postId": "abc123",
  "receiverId": "user456"
}
```

**Processing:**
1. Verify user authentication
2. Verify post exists and is active
3. Verify receiver exists
4. Generate unique `chatId`: `${userId}_${receiverId}_${postId}` (sort IDs alphabetically for consistency)
5. Check if chat already exists in `marketChats` collection
6. If exists, return existing chat
7. If not, create chat document:
   ```typescript
   {
     chatId: "user123_user456_post789",
     postId: "post789",
     participants: [userId, receiverId], // Sorted alphabetically
     lastMessage: null,
     lastMessageAt: null,
     createdAt: serverTimestamp(),
     updatedAt: serverTimestamp()
   }
   ```

**Response:**
```json
{
  "success": true,
  "chatId": "user123_user456_post789",
  "chat": { /* Chat object */ }
}
```

**Error Responses:**
- `400`: Invalid input
- `401`: Unauthenticated
- `404`: Post or receiver not found
- `500`: Server error

---

#### `sendMarketMessage`

**Endpoint:** `https://sendmarketmessage-q3rjv54uka-uc.a.run.app`  
**Method:** `POST`  
**Auth Required:** Yes

**Request Body:**
```json
{
  "chatId": "user123_user456_post789",
  "message": "Is this still available?",
  "imageUrl": "data:image/jpeg;base64,...", // Optional
  "paymentLink": "https://paystack.com/..." // Optional
}
```

**Validation:**
- `chatId`: Required, valid chat ID
- `message`: Required if no imageUrl, string, 1-1000 characters
- `imageUrl`: Optional, base64 encoded image if provided
- `paymentLink`: Optional, valid URL if provided

**Processing:**
1. Verify user authentication
2. Get chat document and verify user is a participant
3. Determine receiver (other participant in chat)
4. If `imageUrl` provided:
   - Decode base64 image
   - Upload to Firebase Storage: `marketMessages/{chatId}/{messageId}_image.jpg`
   - Get download URL
5. Create message document in `marketMessages` collection:
   ```typescript
   {
     chatId: "user123_user456_post789",
     senderId: userId,
     receiverId: receiverId,
     postId: chat.postId,
     message: "Is this still available?",
     imageUrl: "https://...", // or null
     paymentLink: "https://...", // or null
     read: false,
     createdAt: serverTimestamp()
   }
   ```
6. Update chat document:
   - Set `lastMessage` to message text (or "Image" if image only)
   - Set `lastMessageAt` to `serverTimestamp()`
   - Set `updatedAt` to `serverTimestamp()`
7. Send push notification to receiver (if they have notifications enabled)

**Response:**
```json
{
  "success": true,
  "messageId": "msg123",
  "message": { /* Message object */ }
}
```

**Error Responses:**
- `400`: Invalid input
- `401`: Unauthenticated
- `403`: Not authorized (not a chat participant)
- `404`: Chat not found
- `500`: Server error

---

## Firestore Collections

### `marketPosts`
- Document ID: Auto-generated
- Fields: See `createMarketPost` above
- Indexes needed:
  - `status` + `createdAt` (descending)
  - `status` + `hashtags` (array-contains) + `createdAt` (descending)

### `marketPostComments`
- Document ID: Auto-generated
- Fields: `postId`, `userId`, `comment`, `createdAt`, `updatedAt`
- Indexes needed:
  - `postId` + `createdAt` (descending)

### `marketChats`
- Document ID: `chatId` (custom)
- Fields: `chatId`, `postId`, `participants`, `lastMessage`, `lastMessageAt`, `createdAt`, `updatedAt`
- Indexes needed:
  - `participants` (array-contains) + `lastMessageAt` (descending)

### `marketMessages`
- Document ID: Auto-generated
- Fields: `chatId`, `senderId`, `receiverId`, `postId`, `message`, `imageUrl`, `paymentLink`, `read`, `createdAt`
- Indexes needed:
  - `chatId` + `createdAt` (ascending)
  - `receiverId` + `read` + `createdAt` (descending)

### `trendingHashtags`
- Document ID: Hashtag tag (e.g., "fashion")
- Fields: `tag`, `count`
- Indexes needed:
  - `count` (descending)

## Security Rules

Ensure Firestore security rules allow:
- **Read**: Anyone can read active posts, comments, and public chat info
- **Write**: Only through Cloud Functions (no direct client writes)

## Testing Checklist

- [ ] Create post with 1 image
- [ ] Create post with 20 images
- [ ] Create post without price (Ask for Price)
- [ ] Like/unlike post
- [ ] Delete own post
- [ ] Try to delete someone else's post (should fail)
- [ ] Increment views (public, no auth)
- [ ] Create comment
- [ ] Delete own comment
- [ ] Try to delete someone else's comment (should fail)
- [ ] Create chat
- [ ] Send text message
- [ ] Send image message
- [ ] Send payment link
- [ ] Verify hashtag trending updates

## Notes

- All timestamps should use Firestore `serverTimestamp()`
- Use Firestore transactions for atomic operations (likes, comments count)
- Image uploads should be optimized (compress, resize if needed)
- Consider rate limiting for public endpoints
- Implement proper error logging and monitoring
