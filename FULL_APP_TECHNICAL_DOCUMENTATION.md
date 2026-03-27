# IKM Mobile App - Full Technical Documentation
Last updated: February 22, 2026

## 1. Scope and Goal
This document explains the entire app as implemented today:
- Every route/screen and what it is supposed to do.
- The main buttons and controls on each screen and expected behavior.
- Focused code snippets (necessary parts only) for important logic.
- The major upgrades already delivered in this codebase.

## 2. Product and Architecture Summary
IKM is a single Expo React Native app with 2 runtime variants:
- `market`: social commerce feed, chat, offers, escrow checkout, orders, payouts.
- `seller`: merchant operations app (dashboard, products, orders, marketing, payouts, reports).
- `admin`: platform control panel inside seller app for admin users.

Core technical layers:
- UI/routes: `app/**`.
- Feature components: `components/**`.
- Firestore read hooks: `lib/firebase/firestore/**`.
- Mutations/API: `lib/api/**` (cloud functions, admin APIs, market APIs).
- Shared infra: auth hooks, offline queue, theme system.

## 3. What We Have Implemented (Major Delivered Work)
Recent engineering outcomes reflected in code:
- Variant-based app routing (`market` vs `seller`) with role gating and protected layouts.
- Auth expansion: separate market and seller entry points.
- Market messaging refactor into modular chat-detail architecture.
- Robust unread/read behavior using conversation metadata + visible-message read marking.
- Offer flow in chat linked to escrow buy screen.
- Market buy/order/payout flow integrated end-to-end.
- Seller/admin surfaces expanded (products, orders, marketing, shipping, payouts, reports).
- Firestore rules and offline sync improvements.

## 4. Access and Routing Model
### 4.1 App Entry (`app/index.tsx`)
Purpose:
- Decide destination from app variant + auth + role.

Expected behavior:
- Market variant always opens `/(market)` (guest allowed).
- Seller variant requires sign-in and seller/admin access.
- Admin users route to `/(admin)`, seller users route to `/(tabs)`.

Key snippet:
```tsx
if (isMarketApp) return <Redirect href="/(market)" />;
if (!user) return <Redirect href="/(auth)/seller-login" />;
if (!userHasAccess) return <Redirect href="/(auth)/seller-login" />;
return <Redirect href={isAdmin ? '/(admin)' : '/(tabs)'} />;
```

### 4.2 Root Layout (`app/_layout.tsx`)
Purpose:
- Global providers and navigation defaults.

Expected behavior:
- Applies keyboard behavior defaults for `ScrollView`/`FlatList`.
- Applies guarded `router.back()` behavior so back cannot pop when no history.

Key snippet:
```tsx
routerAny.back = () => {
  if (typeof router.canGoBack === 'function' && !router.canGoBack()) return;
  originalBack();
};
```

## 5. End-to-End Core Flows
### 5.1 Market Buyer Flow
1. Open feed -> search/select post.
2. Open post comments and initiate message/chat.
3. Seller sends offer in chat.
4. Buyer taps `Buy Offer`.
5. Buyer fills checkout (state/city/address/phone/qty) and pays to escrow.
6. Order appears in market orders.
7. Buyer confirms `Mark Received` or opens dispute.

### 5.2 Market Seller Flow
1. Create post from market create-post screen.
2. Receive buyer messages and unread badge in inbox.
3. Send final offer from chat.
4. Monitor orders in market orders.
5. Mark order sent (optional proof), then await buyer confirmation/auto-release.
6. Manage payout account and submit payout requests.

### 5.3 Seller Operations Flow
1. Seller login -> dashboard.
2. Manage products (create/edit/delete, media, delivery settings).
3. Process seller orders.
4. Manage customers, shipping zones, promotions, payout requests.

### 5.4 Admin Flow
1. Admin login -> admin dashboard.
2. Manage users and roles.
3. Monitor platform orders/products.
4. Review analytics/reports and update platform settings.

## 6. Screen-by-Screen Documentation

## 6.1 Root Routes (`app/*`)

### `app/+not-found.tsx`
Purpose:
- Handle unknown deep links/routes.

Buttons/behavior:
- No button. Automatically redirects to `/`.

Snippet:
```tsx
return <Redirect href="/" />;
```

### `app/modal.tsx`
Purpose:
- Basic modal sample route.

Buttons/behavior:
- `Go to home screen` -> dismiss modal and navigate to `/`.

### `app/notifications.tsx`
Purpose:
- Show user notifications (orders/products), mark read on open.

Buttons/behavior:
- Header back icon -> `router.back()`.
- Notification row -> marks read then routes:
  - order notification -> `/orders/[id]`
  - product notification -> `/products/[id]`

Snippet:
```tsx
if (!notification.read && notification.id) await markNotificationAsRead(notification.id);
if (notification.orderId) router.push(`../orders/${notification.orderId}` as any);
else if (notification.productId) router.push(`../products/${notification.productId}` as any);
```

### `app/domain.tsx`
Purpose:
- Show generated store URL and open storefront.

Buttons/behavior:
- Back icon -> `router.back()`.
- `Open Store` -> attempts `Linking.openURL(storeUrl)`.
- `Complete Store Setup` (when no subdomain) -> `/store-settings`.

### `app/store-settings.tsx`
Purpose:
- Full merchant profile/store settings editor by category.

Main controls:
- Header back icon.
- Header `Save` button -> updates user profile + store settings.
- Expand/collapse category cards.
- Upload buttons for store logo/banner.
- `Logout` button.

Expected behavior:
- Personal/store/location/policies/social/hours/contact/payout sections update fields.
- Save persists to user/store collections through API.

Key snippet:
```tsx
await userApi.updateProfile(user.uid, { displayName, firstName, lastName, phone, payoutDetails });
await userApi.updateStoreSettings(user.uid, { storeName, storeDescription, storeLocation, storePolicies, storeHours });
```

### `app/storefront.tsx`
Purpose:
- Seller storefront customization (colors, font, layout, preview).

Main controls:
- Back icon.
- `Save` button.
- Color preset chips.
- Font options.
- Layout options (`grid`, `list`, `masonry`).

Expected behavior:
- Validates hex colors and saves customization to store settings.

Key snippet:
```tsx
await userApi.updateStoreSettings(user.uid, {
  primaryColor, secondaryColor, fontFamily, storeLayout,
});
```

### `app/products/new.tsx`
Purpose:
- Multi-step seller product creation.

Main controls:
- Header back icon.
- Category picker modal.
- Media controls: add/remove images, add/remove video, add/remove audio.
- Step `Continue` / final `Create Product` button.
- Delivery settings toggles (buyer/seller fee payer, local dispatch/waybill/pickup).

Expected behavior:
- Step validation enforced.
- Creates product via API and redirects to product detail.

Key snippet:
```tsx
const product = await productApi.create(productData);
router.replace(`../products/${product.id}` as any);
```

### `app/products/[id].tsx`
Purpose:
- Seller product detail + edit mode.

Main controls:
- Back icon.
- Edit/Save icon.
- Media add/remove controls.
- Delivery method controls in edit mode.
- Image viewer modal navigation.

Expected behavior:
- Toggle view/edit mode.
- Save updates product via API.

Key snippet:
```tsx
await productApi.update(product.id!, {
  name, description, price, stock, status, category, imageBase64, deliveryMethods,
});
```

### `app/orders/[id].tsx`
Purpose:
- Seller/admin order management with operational chat and status transitions.

Main controls:
- Back icon.
- `Customer Messages` -> opens chat modal.
- Action dock buttons based on allowed transitions.
- `Select Waybill Park` modal for sent flow.
- `Not Available` dialog.

Expected behavior:
- Enforces transition rules.
- Calls cloud functions for critical transitions.

Key snippet:
```tsx
if (newStatus === 'Sent') {
  await cloudFunctions.markOrderAsSent({ orderId: order.id!, waybillParkId, waybillParkName });
} else {
  await orderApi.updateStatus(order.id!, newStatus);
}
```

## 6.2 Auth Routes (`app/(auth)/*` + `components/auth/*`)

### `app/(auth)/_layout.tsx`
Purpose:
- Auth stack and redirect behavior for signed-in seller app users.

Expected behavior:
- Seller variant: authenticated users are redirected to `/`.

### Alias Screens
- `app/(auth)/login.tsx` -> redirects to variant-specific login.
- `app/(auth)/signup.tsx` -> redirects to variant-specific signup.
- `app/(auth)/market-login.tsx` -> renders `AuthLoginScreen variant="market"`.
- `app/(auth)/market-signup.tsx` -> renders `AuthSignupScreen variant="market"`.
- `app/(auth)/seller-login.tsx` -> renders `AuthLoginScreen variant="seller"`.
- `app/(auth)/seller-signup.tsx` -> renders `AuthSignupScreen variant="seller"`.

### `components/auth/auth-login-screen.tsx`
Purpose:
- Variant-aware login UI.

Main buttons:
- Password eye icon.
- `Sign In` button.
- Secondary CTA to signup route.
- `Forgot Credentials?` (display action only currently).

Expected behavior:
- Validates fields, signs in with Firebase auth, redirects to `/`.

Snippet:
```tsx
await signInWithEmailAndPassword(auth, email.trim(), password);
router.replace('/');
```

### `components/auth/auth-signup-screen.tsx`
Purpose:
- Variant-aware signup UI.

Main buttons:
- Password and confirm-password eye icons.
- `SIGN UP` button.
- `Sign In` link.

Expected behavior:
- Creates Firebase user, updates profile displayName, writes `users/{uid}` role, redirects `/`.

Snippet:
```tsx
const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
await setDoc(doc(firestore, 'users', user.uid), { role, isAdmin: false, createdAt: serverTimestamp() });
```

## 6.3 Market App (`app/(market)/*`)

### `app/(market)/_layout.tsx`
Purpose:
- Market tab shell.

Visible tabs:
- `index`, `following`, `create-post`, `messages/index`, `profile`.

Hidden routes:
- `settings`, `search`, `post/[id]`, `post-edit/[id]`, `messages/[chatId]`, `buy/[postId]`, `orders/*`, `payouts`.

### `app/(market)/index.tsx` (Feed)
Purpose:
- Full-screen feed browsing.
- Uses a FlashList-compatible list layer for higher-throughput rendering (falls back to FlatList if FlashList package is unavailable in the current build cache).

Main buttons:
- Search icon -> `/(market)/search`.
- Retry on load failure.
- Feed card comment action -> `/(market)/post/[id]`.
- Pull-to-refresh.

### `app/(market)/following.tsx`
Purpose:
- Following feed placeholder.

Buttons:
- `Find Sellers` -> `/(market)/search`.

### `app/(market)/create-post.tsx`
Purpose:
- Market post creation.

Main controls:
- Back icon.
- `Publish` button.
- Add/remove images.
- Hashtag suggestion chips.
- Token insert buttons (`#`, `@`).
- Negotiable switch.
- Location picker modal and clear location.

Expected behavior:
- Publishes post, resets form, routes to feed.

Key snippet:
```tsx
await marketPostsApi.create({ description, price, isNegotiable, images, location, hashtags });
router.replace('/(market)' as any);
```

### `app/(market)/search.tsx`
Purpose:
- Search by text or hashtag with trending and recents.

Main controls:
- Search input submit.
- Clear search button.
- Trending hashtag chips.
- Recent search row tap.
- Remove single recent search.
- Clear all recents.

Expected behavior:
- Saves recent searches and shows matching posts.

### `app/(market)/post/[id].tsx`
Purpose:
- Post comments screen.

Main controls:
- Header back icon.
- Comment input.
- Send comment button.

Expected behavior:
- Requires login to comment.
- Creates comment via API and scrolls to latest.

Snippet:
```tsx
await marketCommentsApi.create(id, commentText);
showToast('Comment added', 'success');
```

### `app/(market)/post-edit/[id].tsx`
Purpose:
- Edit own market post metadata.

Main controls:
- Back icon.
- `Save` chip.
- Description/price/location inputs.
- Delete hint button (informational alert; actual delete from manage menu).

Expected behavior:
- Owner-only edit.
- Updates post description/hashtags/price/location.

### `app/(market)/profile.tsx`
Purpose:
- Market profile, post list, post management.

Guest controls:
- `Sign In`.
- `Create Account`.

Authenticated controls:
- Settings icon -> `/(market)/settings`.
- Avatar tap -> profile picture action sheet:
  - `Set New Profile Pic`
  - `Remove Profile Pic` (if existing)
- Post card tap -> `/(market)/post/[id]`.
- Post ellipsis -> manage sheet (`Edit`, `Share`, `Delete`).

Expected behavior:
- Supports profile photo upload/remove.
- Supports post edit/share/delete.

### `app/(market)/settings.tsx`
Purpose:
- Market account settings.

Main controls:
- Back icon.
- Profile picture change.
- Edit display name/phone (Save/Cancel).
- `Change Password` (email-reset flow).
- Theme switch.
- Notifications switch (placeholder toast).
- `Market Orders` -> `/(market)/orders`.
- `Payouts` -> `/(market)/payouts`.
- Terms/Privacy external links.
- Logout button.

### `app/(market)/messages/_layout.tsx`
Purpose:
- Stack wrapper for messages routes.

### `app/(market)/messages/index.tsx`
Purpose:
- Conversations inbox with unread filtering.

Main controls:
- Filter chips: `Chats`, `Unread`.
- Chat row tap -> opens `/(market)/messages/[chatId]` with peer/legacy params.
- Login CTA for guests.

Expected behavior:
- Displays unread badges and unread totals.

### `app/(market)/messages/[chatId].tsx`
Purpose:
- Chat detail orchestrator.

Main controls:
- Header back to inbox.
- Optional `Offer` action (seller conditions).
- Compose text input.
- Send button.
- Image picker button.
- Inline offer CTA.
- Offer modal send action.

Expected behavior:
- Optimistic send + fallback chat target selection.
- Handles offline queue state.
- Routes buyer to buy offer screen from message bubble.

Key snippet:
```tsx
const result = await attemptSend(trimmedMessage, undefined, undefined, {
  clientMessageId: optimisticMessageId,
});
applyResolvedChatId(result.chatId);
```

### Chat Detail Support Components (`app/(market)/messages/chat-detail/*`)

#### `chat-header.tsx`
- Back button.
- Offer button (when eligible).

#### `chat-composer.tsx`
- Inline offer CTA button.
- Photo picker button.
- Send button.

#### `offer-modal.tsx`
- Close button.
- Send offer button.

#### `chat-list.tsx`
- Tracks viewable rows.
- Calls `onLatestVisibleIncomingMessage` for accurate read-marking.
- Renders unread divider with unread count.

Snippet:
```tsx
if (String(message.senderId || '') !== currentUser) {
  callback(String(message.id || '').trim());
}
```

#### `use-chat-route.ts`
- Resolves direct conversation id, legacy fallback id, and syncs route params.

#### `use-chat-messages.ts`
- Merges legacy + conversation + queued + pending messages.
- Computes unread count from metadata + pointer fallback.
- Exposes `markLatestVisibleIncomingAsRead`.

Snippet:
```tsx
await marketMessagesApi.markAsRead(activeChatId, [normalizedMessageId]);
```

### `components/market/message-bubble.tsx`
Purpose:
- Render chat message bubble with media/offer/quote.

Behavior highlights:
- Self avatar hidden.
- Peer avatar shown only for incoming messages.
- Offer link button:
  - sender sees `Offer Sent`
  - receiver sees `Buy Offer`

Snippet:
```tsx
{!isSent ? <PeerAvatar /> : null}
{offerPayload ? (isSent ? 'Offer Sent' : 'Buy Offer') : 'Payment Link'}
```

### `lib/api/market-messages.ts`
Purpose:
- Direct conversation id, send message, queue fallback, mark read.

Snippet:
```tsx
export function buildDirectConversationId(userA: string, userB: string) {
  const [minUid, maxUid] = [userA, userB].sort((a, b) => a.localeCompare(b));
  return `direct_${minUid}_${maxUid}`;
}
```

### `app/(market)/buy/[postId].tsx`
Purpose:
- Escrow checkout from post/offer.

Main controls:
- Back icon.
- Quantity minus/plus.
- State picker modal.
- City picker modal.
- Cancel setup button.
- `Pay to Escrow` button.

Expected behavior:
- Validates seller price, phone, state/city/address, quantity, self-buy restriction.
- Creates order with `fromChatId` when supplied.

Key snippet:
```tsx
const created = await marketOrdersApi.createFromPost({
  buyerId: user.uid,
  post,
  quantity: numericQuantity,
  finalPrice: lockedPrice,
  deliveryAddress: builtDeliveryAddress,
  fromChatId: chatId,
});
router.replace(`/(market)/orders/${created.id}` as any);
```

### `app/(market)/orders/index.tsx`
Purpose:
- Buyer/seller market orders list.

Main controls:
- Back icon.
- Filter chips (`All`, `Buying`, `Selling`, `Active`).
- Order card tap -> order detail.
- Guest login CTA.

### `app/(market)/orders/[id].tsx`
Purpose:
- Market order detail and lifecycle actions.

Seller actions:
- `Mark Sent` (with optional proof image).
- `Cancel` while processing.
- `Payout Settings` shortcut.

Buyer actions:
- `Cancel Purchase` while processing.
- `Mark Received` when sent.
- `Dispute` when sent.

Expected behavior:
- Calls cloud functions for state transitions and escrow-safe flow.

### `app/(market)/payouts.tsx`
Purpose:
- Market payout account and payout request flow.

Main controls:
- Back icon.
- `Add/Update bank details` modal.
- Bank dropdown/search and account resolve.
- Save bank details button.
- Request payout modal and submit button.

Expected behavior:
- Validates required bank fields and payout minimum.

## 6.4 Seller App (`app/(tabs)/*`)

### `app/(tabs)/_layout.tsx`
Purpose:
- Seller tab shell with auth/access gate.

Visible tabs:
- `index`, `products`, `analytics`, `settings`.

Hidden operational routes:
- `orders`, `customers`, `reports`, `marketing`, `shipping`, `payouts`.

### `app/(tabs)/index.tsx` (Seller Dashboard)
Purpose:
- Merchant home overview.

Main controls:
- Notifications icon -> `/notifications`.
- Theme icon.
- Payout gradient card -> `/(tabs)/payouts`.
- `Products` stat -> `/(tabs)/products`.
- `See all` recent orders -> `/(tabs)/orders`.
- Order row -> `/orders/[id]`.
- Tool cards -> `customers`, `shipping`, `marketing`, `store-settings`.
- `Setup Store` button when store missing.

### `app/(tabs)/products.tsx`
Purpose:
- Product grid management.

Main controls:
- Theme icon.
- Add product icon -> `/products/new`.
- Search input.
- Product card press -> `/products/[id]`.
- Long press product -> enter multi-select mode.
- Per-product trash button.
- Multi-select delete action.

### `app/(tabs)/orders.tsx`
Purpose:
- Seller order list.

Main controls:
- Theme icon.
- Order card -> `/orders/[id]`.
- Pull-to-refresh.

### `app/(tabs)/analytics.tsx`
Purpose:
- Read-only analytics dashboard (revenue, status metrics, trends).

Buttons:
- No action buttons in the body; display/reporting focused screen.

### `app/(tabs)/customers.tsx`
Purpose:
- Customer segmentation and details.

Main controls:
- Segment chips (`all`, `VIP`, `Regular`, `New`).
- Customer row -> open details modal.
- Modal close icon.
- Recent order in modal -> `/orders/[id]`.

### `app/(tabs)/marketing.tsx`
Purpose:
- Discount code and campaign tools.

Main controls:
- Tab switch (`codes`, `campaigns`).
- `Create Code` button.
- Modal type switch (`percentage`, `fixed`).
- `Create` submit button.

### `app/(tabs)/shipping.tsx`
Purpose:
- Shipping zones CRUD.

Main controls:
- `Add Zone` button.
- Edit zone action.
- Delete zone action.
- Save in modal.

### `app/(tabs)/payouts.tsx`
Purpose:
- Seller payout account setup + payout requests + history.

Main controls:
- Open bank modal.
- Toggle bank search list.
- Select bank row.
- Resolve account name flow.
- Save bank details.
- Open payout request modal.
- Submit payout request.

### `app/(tabs)/reports.tsx`
Purpose:
- Export seller reports (sales/customer/product).

Main controls:
- Export button on each report card.

Expected behavior:
- Builds report file and shows success/failure alerts.

### `app/(tabs)/settings.tsx`
Purpose:
- Seller account/settings hub.

Main controls:
- Theme icon.
- Menu rows:
  - `Store Settings` -> `/store-settings`
  - `Storefront Customization` -> `/storefront`
  - `Domain Settings` -> `/domain`
  - `Admin Panel` (admin users only) -> `/(admin)`
  - `Security & Password` placeholder
- `Logout from Account` button.

## 6.5 Admin App (`app/(admin)/*`)

### `app/(admin)/_layout.tsx`
Purpose:
- Admin tab shell and role gate.

Behavior:
- Seller variant only.
- Requires authenticated admin user.

Visible tabs:
- `index`, `users`, `orders`, `products`, `settings`.

Hidden routes:
- `reports`, `security`, `users/[id]`.

### `app/(admin)/index.tsx`
Purpose:
- Admin dashboard.

Main controls:
- Theme icon.
- Logout icon.
- Quick action cards:
  - users/orders/products/reports/security/settings
- Recent order row -> `/orders/[id]`.
- `View All Orders`.

### `app/(admin)/users.tsx`
Purpose:
- Search users and access user detail/role management.

Main controls:
- Back icon.
- Theme icon.
- Search input.
- User card press -> `/(admin)/users/[id]`.
- (Legacy modal role actions still present in file).

### `app/(admin)/users/[id].tsx`
Purpose:
- Single user detail + role updates.

Main controls:
- Back icon.
- Role buttons (`user`, `seller`, `admin`).

### `app/(admin)/orders.tsx`
Purpose:
- Platform-wide order list.

Main controls:
- Back icon.
- Theme icon.
- Status filter chips.
- Order row -> `/orders/[id]`.

### `app/(admin)/products.tsx`
Purpose:
- Platform-wide product moderation.

Main controls:
- Back icon.
- Theme icon.
- Status filter chips.
- Product row -> `/products/[id]`.
- Product delete action.

### `app/(admin)/reports.tsx`
Purpose:
- Platform analytics/reporting view.

Main controls:
- Left icon currently only triggers haptic feedback (no navigation wired yet).
- Theme icon.

Expected behavior:
- Displays analytics sections (overview, revenue by status, orders by status, top sellers, user breakdown).

### `app/(admin)/security.tsx`
Purpose:
- Security/access hub.

Main controls:
- Back icon.
- Feature cards route to users/settings/reports/security-linked destinations.

### `app/(admin)/settings.tsx`
Purpose:
- Platform-level configuration.

Main controls:
- Back icon.
- Theme icon.
- Numeric settings inputs (commission %, min payout, auto release days).
- `Save Changes` button with confirmation.
- Admin actions:
  - `Switch to Seller Dashboard`
  - `Security & Access`

Key snippet:
```tsx
await adminApi.updatePlatformSettings({
  commissionRate: commissionRateNum / 100,
  minPayoutAmount: minPayoutNum,
  autoReleaseDays: autoReleaseDaysNum,
});
```

## 7. Firestore/Write Boundaries (Practical)
- Realtime reads: Firestore hooks in `lib/firebase/firestore/**`.
- Business writes: API layer (`lib/api/**`) and cloud functions.
- Chat write path: `marketMessagesApi.sendMessage` + queue fallback on network issues.
- Order transitions: cloud functions for high-trust state changes.
- Admin mutations: `adminApi` functions with guarded routes and rules.

## 8. Offline and Reliability
Message reliability patterns used:
- Optimistic pending messages in chat.
- Offline queue via `queueWrite` and replay.
- Deduplication via `clientMessageId`.
- Read markers based on visible incoming messages.

Key snippet:
```tsx
await queueWrite({
  type: 'marketMessage',
  action: 'create',
  data: { chatId, message, clientMessageId },
  timestamp: Date.now(),
});
```

## 9. Known Gaps / Intended Next Improvements
Current intentional gaps or TODO areas in code:
- Seller `Security & Password` is still a placeholder action.
- Media uploads support images/video/audio, but large file resume/retry support is still not implemented.
- Several lint warnings remain outside blocking errors.
- No dedicated `npm test` script in package scripts.

## 10. Quick QA Checklist by Critical Flow
Use this to verify expected behavior after changes.

### Auth and Routing
- Market variant opens market tabs as guest.
- Seller variant blocks non-seller users and routes to seller login.
- Admin user is routed to admin tabs.

### Market Chat and Offers
- Inbox unread count updates.
- Opening chat marks visible incoming messages as read.
- Self avatar not shown; peer avatar shown.
- Seller can send offer, buyer sees `Buy Offer`.

### Escrow Buy and Orders
- Offer click opens buy screen with locked price.
- Validation blocks missing phone/state/city/address/quantity.
- Successful checkout creates order and routes to order detail.
- Seller can mark sent; buyer can mark received/dispute.

### Seller/Admin Operations
- Product create/edit paths work.
- Payout bank setup and request flows validate correctly.
- Admin role updates and settings save successfully.

---
This is the current implementation baseline for developers, QA, and release planning. For any route listed above, the expected behavior and button semantics are now defined against the actual codebase.
