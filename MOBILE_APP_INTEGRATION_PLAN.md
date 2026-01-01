# Mobile App Integration Plan - New Features

**Date:** January 2025  
**Version:** Northern Marketplace Update  
**Status:** Planning Phase

This document outlines the detailed plan for integrating the new web app features into the mobile app.

---

## Table of Contents

1. [Overview](#overview)
2. [Features to Integrate](#features-to-integrate)
3. [Implementation Order](#implementation-order)
4. [Detailed Feature Plans](#detailed-feature-plans)
5. [File Changes Required](#file-changes-required)
6. [Testing Checklist](#testing-checklist)

---

## Overview

The web app has added several new features that need to be integrated into the mobile app to maintain feature parity. The mobile app focuses on seller management, so we'll prioritize seller-facing features.

### Key Principles

- **Backward Compatible**: All changes must work with existing data
- **Cloud Functions First**: Use Cloud Functions for all write operations
- **Type Safety**: Update TypeScript types to match new schema
- **Gradual Rollout**: Implement features in logical dependency order

---

## Features to Integrate

### Priority 1: Northern Products System ⭐ MOST IMPORTANT

1. ✅ **Northern Products System with Category-Specific Fields**
   - Category-specific form fields for 8 categories
   - Dynamic form rendering based on category
   - Category-specific validation rules
   - Support for multiple product types per category
   - Media support (images, video, audio)
   - Cloud Functions integration (createNorthernProduct, updateNorthernProduct)

### Priority 2: Core Order Management Features

2. ✅ **Parks System for Waybill Deliveries**
   - View parks list
   - Select park when marking order as "Sent"
   - Display park info in order details

3. ✅ **Order Availability System**
   - Mark order as "Not Available"
   - Add reason and optional wait time
   - View availability status in order details

4. ✅ **Updated Order Status Flow**
   - Add `AvailabilityCheck` status
   - Support new status transitions
   - Update status color coding

### Priority 3: Supporting Features

5. ✅ **Free Orders Support** (Already handled - orders can be ₦0)
   - Verify existing implementation works

6. ⏸️ **Delivery Settings at Product Level** (Defer - Less critical)
   - Product-level delivery fee payment options
   - Product-level delivery methods

7. ⏸️ **Price System Changes** (Already using `price`, not `initialPrice`)
   - Verify compatibility
   - Remove any `initialPrice` references

---

## Implementation Order

### Phase 1: Northern Products System ⭐ TOP PRIORITY

1. **Types & Interfaces (Foundation)**
   - Update `types/index.ts` with Northern product interfaces
   - Add category-specific field types for all 8 categories
   - Add `ProductType` type (northern vs standard)
   
2. **Cloud Functions Integration**
   - Add `createNorthernProduct` and `updateNorthernProduct` Cloud Functions
   - Update `lib/api/cloud-functions.ts` with new endpoints
   - Create `lib/api/northern-products.ts` API client

3. **Category Field Components**
   - Create `components/products/category-fields/` directory
   - Create field components for each category (Fragrance, Fashion, Snacks, Materials, Skincare, Hair Care, Islamic, Electronics)
   - Implement dynamic form rendering based on category

4. **Product Creation UI**
   - Update `app/products/new.tsx` to support category selection
   - Add category-specific field rendering
   - Implement category-specific validation
   - Update multi-step form to include category fields

5. **Product Editing UI**
   - Update `app/products/[id].tsx` to support Northern products
   - Add category-specific field editing
   - Handle both standard and Northern products

### Phase 2: Types & Data Layer (Order Features)

1. Update `types/index.ts` with new Order fields
2. Add Park type and interfaces
3. Update order status type to include `AvailabilityCheck`
4. Create `lib/firebase/firestore/parks.ts` for park data hooks

### Phase 3: Cloud Functions Integration (Order Features)

1. Add park-related Cloud Functions to `lib/api/cloud-functions.ts`
2. Add availability-related Cloud Functions
3. Update `markOrderAsSent` to accept park information
4. Create `lib/api/parks.ts` API client
5. Create `lib/api/order-availability.ts` API client

### Phase 4: Order Management UI

1. Update `app/orders/[id].tsx`:
   - Add park selection in "Mark as Sent" dialog
   - Add "Mark as Not Available" button and dialog
   - Display park information in order details
   - Display availability status and wait time info
   - Update status color coding for `AvailabilityCheck`

2. Update `app/(tabs)/orders.tsx`:
   - Show availability status badges
   - Filter/indicate orders needing attention

### Phase 4: Testing & Polish
1. Test park selection flow
2. Test availability marking flow
3. Verify order details display correctly
4. Test edge cases (no parks, no wait time, etc.)

---

## Detailed Feature Plans

### Feature 1: Northern Products System ⭐ MOST IMPORTANT

#### Overview
A comprehensive product creation system specifically designed for Northern Nigerian businesses, with 8 supported categories, each with category-specific fields and validation rules.

#### Supported Categories & Fields

**1. Fragrance**
- Volume (e.g., "100ml", "50ml") - required
- Fragrance Type (Eau de Parfum, Eau de Toilette, etc.) - required
- Container Type (Glass Bottle, Spray, etc.) - required

**2. Fashion**
- Size Type (Standard, Custom) - required
- Abaya Length (ankle-length, mid-length, etc.) - conditional
- Standard Size (XS, S, M, L, XL, etc.) - conditional
- Set Includes (Abaya, Hijab, Underdress, etc.) - array
- Material (Cotton, Polyester, etc.) - required

**3. Snacks**
- Packaging Type (Plastic Container, Paper Bag, etc.) - required
- Quantity (number of items) - required
- Taste (Sweet, Spicy, etc.) - optional

**4. Materials**
- Material Type (Shadda, Atiku, Cotton, Silk, Linen, Custom) - required
- Custom Material Type (when "Custom" is selected) - conditional
- Fabric Length (e.g., "6 yards") - required
- Quality (based on yards, not stock) - optional

**5. Skincare & Cosmetics**
- Brand - required
- Product Type (Moisturizer, Cleanser, etc.) - required
- Size (Small, Medium, Large, etc.) - required

**6. Hair Care Products**
- Type (Oil, Shampoo, Conditioner, Treatment, Package Deal) - required
- Brand - required
- Size - required
- Package Items (for Package Deal: Oil, Shampoo, Conditioner, Treatment, Mask) - conditional array

**7. Islamic Products**
- Product Type (Prayer Rug, Tasbih, etc.) - required
- Size (Standard, Large, etc.) - required
- Material (Wool, Cotton, etc.) - required

**8. Electronics**
- Brand - required
- Model - required

#### Data Flow
1. Seller selects category → Category-specific fields appear
2. Seller fills category fields → Validation runs based on category
3. Seller submits → Product created/updated via `createNorthernProduct`/`updateNorthernProduct` Cloud Functions
4. Product saved with category-specific fields in Firestore

#### Files to Create

1. **`components/products/category-fields/CategoryFields.tsx`** - Wrapper component
2. **`components/products/category-fields/FragranceFields.tsx`**
3. **`components/products/category-fields/FashionFields.tsx`**
4. **`components/products/category-fields/SnacksFields.tsx`**
5. **`components/products/category-fields/MaterialsFields.tsx`**
6. **`components/products/category-fields/SkincareFields.tsx`**
7. **`components/products/category-fields/HairCareFields.tsx`**
8. **`components/products/category-fields/IslamicFields.tsx`**
9. **`components/products/category-fields/ElectronicsFields.tsx`**
10. **`lib/api/northern-products.ts`** - API client

#### Files to Modify

1. **`types/index.ts`** - Add ProductType, NorthernCategory, and category-specific fields to Product interface
2. **`lib/api/cloud-functions.ts`** - Add createNorthernProduct and updateNorthernProduct methods
3. **`app/products/new.tsx`** - Add product type selector, category picker, and category-specific fields
4. **`app/products/[id].tsx`** - Support Northern products in edit mode

#### Type Changes
```typescript
export type ProductType = 'standard' | 'northern';

export type NorthernCategory = 
  | 'Fragrance'
  | 'Fashion'
  | 'Snacks'
  | 'Materials'
  | 'Skincare & Cosmetics'
  | 'Hair Care Products'
  | 'Islamic Products'
  | 'Electronics';

// Update Product interface with category-specific fields
// (See detailed implementation plan for full field list)
```

#### Cloud Functions Needed
- `createNorthernProduct` - Create Northern products with category-specific fields
- `updateNorthernProduct` - Update Northern products

#### Category-Specific Validation
Each category has specific required fields with detailed validation rules (see detailed implementation plan in the full document).

---

### Feature 2: Parks System for Waybill Deliveries

#### Overview
Allow sellers to select which transport park (motor park) they sent items from when marking waybill orders as "Sent".

#### Data Flow
1. Seller marks order as "Sent" → Dialog appears
2. If shipping type is "waybill" → Show park selection
3. Parks filtered by buyer's state (from `order.customerInfo.state`)
4. Seller selects park or "None" → Order updated with `waybillParkId` and `waybillParkName`

#### Files to Create
- `lib/firebase/firestore/parks.ts` - Park data hooks
- `lib/api/parks.ts` - Parks API client (if needed, or use Cloud Functions directly)

#### Files to Modify
- `types/index.ts` - Add `Park` interface and update `Order` interface
- `lib/api/cloud-functions.ts` - Add park-related Cloud Functions
- `lib/api/orders.ts` - Update `markAsSent` to accept park info
- `app/orders/[id].tsx` - Add park selection UI

#### Type Changes
```typescript
// Add to types/index.ts
export interface Park {
  id?: string;
  name: string;
  city: string;
  state: string;
  isActive: boolean;
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
}

// Update Order interface
export interface Order {
  // ... existing fields
  waybillParkId?: string;
  waybillParkName?: string;
  deliveryFeePaidBy?: 'seller' | 'buyer';
}
```

#### Cloud Functions Needed
- `getParksByState` - Get parks filtered by state (public endpoint)
- `markOrderAsSent` - Already exists, needs to accept `waybillParkId` and `waybillParkName`

#### UI Changes
1. **Order Detail Screen** (`app/orders/[id].tsx`):
   - Update "Mark as Sent" dialog to:
     - Check if `shippingType === 'waybill'`
     - If yes, fetch parks by buyer's state
     - Show park picker/selector
     - Include "None" option
   - Display park info in order details section:
     - Show "Sent from: [Park Name], [City]" if park selected
     - Show "Sent via waybill" if no park selected

#### Edge Cases
- No parks available for buyer's state → Show "None" option only
- Parks API fails → Allow marking as sent without park (optional field)
- Buyer state not specified → Show all active parks or skip park selection

---

### Feature 3: Order Availability System

#### Overview
Allow sellers to mark orders as "Not Available" when products are out of stock, with optional wait time offers. Buyers can accept wait time or cancel for automatic refund.

#### Data Flow
1. Seller marks order as "Not Available" → Dialog appears
2. Seller enters reason (required) and optional wait time (days)
3. If wait time provided:
   - Order status → `AvailabilityCheck`
   - `availabilityStatus` → `waiting_buyer_response`
   - `waitTimeDays` and `waitTimeExpiresAt` set
4. If no wait time:
   - Order status → `AvailabilityCheck`
   - `availabilityStatus` → `not_available`
   - Order can be cancelled/refunded

#### Files to Create
- `lib/api/order-availability.ts` - Order availability API client

#### Files to Modify
- `types/index.ts` - Update `Order` interface and `OrderStatus` type
- `lib/api/cloud-functions.ts` - Add availability Cloud Functions
- `app/orders/[id].tsx` - Add "Mark as Not Available" UI
- `app/(tabs)/orders.tsx` - Show availability status indicators

#### Type Changes
```typescript
// Update OrderStatus type
export type OrderStatus = 
  | 'Processing' 
  | 'Sent' 
  | 'Received' 
  | 'Completed' 
  | 'Cancelled' 
  | 'Disputed'
  | 'AvailabilityCheck'; // NEW

// Update Order interface
export interface Order {
  // ... existing fields
  availabilityStatus?: 'available' | 'not_available' | 'waiting_buyer_response';
  waitTimeDays?: number;
  waitTimeExpiresAt?: Timestamp | Date;
  availabilityReason?: string;
  buyerWaitResponse?: 'accepted' | 'cancelled' | null;
}
```

#### Cloud Functions Needed
- `markOrderAsNotAvailable` - Mark order as not available with reason and wait time
- Note: Buyer response handled on web app (mobile is seller-focused)

#### UI Changes
1. **Order Detail Screen** (`app/orders/[id].tsx`):
   - Add "Mark as Not Available" button (shown when status is "Processing")
   - Dialog with:
     - Reason text input (required, multiline)
     - Wait time number input (optional, days)
     - Submit button
   - Display availability info in order details:
     - Show availability status badge
     - Show reason if available
     - Show wait time if provided
     - Show expiration date if waiting for buyer response

2. **Orders List** (`app/(tabs)/orders.tsx`):
   - Show availability status indicator/badge
   - Highlight orders with `availabilityStatus === 'waiting_buyer_response'`

#### Status Transitions
- `Processing` → `AvailabilityCheck` (via "Mark as Not Available")
- `AvailabilityCheck` → `Cancelled` (if buyer cancels, automatic refund)
- `AvailabilityCheck` → `Processing` (if buyer accepts wait time)

#### Edge Cases
- No reason provided → Show validation error
- Wait time in past → Validate wait time is > 0
- Order already in AvailabilityCheck → Don't show "Mark as Not Available" button

---

### Feature 4: Updated Order Status Flow

#### Overview
Update order status handling to support the new `AvailabilityCheck` status and ensure proper status transitions.

#### Files to Modify
- `app/orders/[id].tsx` - Update status colors and transitions
- `types/index.ts` - Already covered in Feature 2

#### Status Color Coding
```typescript
const statusColors: Record<OrderStatus, string> = {
  Processing: '#FFC107',        // Yellow/Orange
  Sent: '#17A2B8',              // Teal/Blue
  Received: '#28A745',          // Green
  Completed: '#28A745',         // Green
  Cancelled: '#DC3545',         // Red
  Disputed: '#FF6B6B',          // Light Red
  AvailabilityCheck: '#FF9800', // Orange (NEW)
};
```

#### Allowed Transitions
```typescript
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  Processing: ['Sent', 'Cancelled', 'AvailabilityCheck'], // Added AvailabilityCheck
  Sent: ['Received', 'Cancelled'],
  Received: ['Completed', 'Disputed'],
  Completed: [],
  Cancelled: [],
  Disputed: ['Completed', 'Cancelled'],
  AvailabilityCheck: ['Processing', 'Cancelled'], // NEW
};
```

---

## File Changes Required

### New Files to Create

1. **`lib/firebase/firestore/parks.ts`**
   - `useParksByState(state: string | null)` - Hook to fetch parks by state
   - `useAllParks()` - Hook to fetch all parks (if needed)

2. **`lib/api/parks.ts`** (Optional - if not using Cloud Functions directly)
   - API client for park operations

3. **`lib/api/order-availability.ts`**
   - `markOrderAsNotAvailable(orderId, reason, waitTimeDays?)` - Mark order as not available

### Files to Modify

1. **`types/index.ts`**
   - Add `Park` interface
   - Add `OrderStatus` value: `'AvailabilityCheck'`
   - Update `Order` interface with:
     - `waybillParkId?: string`
     - `waybillParkName?: string`
     - `availabilityStatus?: 'available' | 'not_available' | 'waiting_buyer_response'`
     - `waitTimeDays?: number`
     - `waitTimeExpiresAt?: Timestamp | Date`
     - `availabilityReason?: string`
     - `buyerWaitResponse?: 'accepted' | 'cancelled' | null`
     - `deliveryFeePaidBy?: 'seller' | 'buyer'`

2. **`lib/api/cloud-functions.ts`**
   - Add `getParksByState` Cloud Function URL and method
   - Add `markOrderAsNotAvailable` Cloud Function URL and method
   - Update `markOrderAsSent` to accept `waybillParkId` and `waybillParkName`

3. **`lib/api/orders.ts`**
   - Update `markAsSent` signature to accept park info:
     ```typescript
     markAsSent: async (
       orderId: string,
       photoUrl?: string,
       waybillParkId?: string,
       waybillParkName?: string
     ): Promise<Order>
     ```

4. **`app/orders/[id].tsx`**
   - Import park hooks and availability API
   - Add state for park selection dialog
   - Add state for "Mark as Not Available" dialog
   - Update "Mark as Sent" handler to:
     - Check if waybill shipping
     - Fetch parks by buyer state
     - Show park selection UI
     - Include park info in API call
   - Add "Mark as Not Available" button and handler
   - Update order details display to show:
     - Park information (if waybill and park selected)
     - Availability status and details
   - Update status color coding
   - Update status transitions

5. **`app/(tabs)/orders.tsx`**
   - Add availability status indicators/badges
   - Highlight orders waiting for buyer response

6. **`lib/firebase/firestore/orders.ts`** (If needed)
   - Ensure order hooks properly handle new fields
   - No changes needed if using `...data` spread (should work automatically)

---

## Cloud Functions URLs Needed

Based on the changelog, we need these Cloud Functions:

### Parks
- `getParksByState` - Get parks by state (public)
- URL format: `https://[function-name]-[region]-[project-id].cloudfunctions.net/getParksByState`

### Order Availability
- `markOrderAsNotAvailable` - Mark order as not available
- URL format: `https://[function-name]-[region]-[project-id].cloudfunctions.net/markOrderAsNotAvailable`

### Updated Existing Functions
- `markOrderAsSent` - Already exists, but needs to accept:
  - `waybillParkId?: string`
  - `waybillParkName?: string`

---

## Implementation Steps

### Step 1: Northern Products - Update Types (1 hour)
1. Open `types/index.ts`
2. Add `ProductType` and `NorthernCategory` types
3. Update `Product` interface with category-specific fields
4. Add category-specific field interfaces
5. Verify TypeScript compilation

### Step 2: Northern Products - Cloud Functions (30 min)
1. Add `createNorthernProduct` and `updateNorthernProduct` URLs to `lib/api/cloud-functions.ts`
2. Implement `createNorthernProduct` method
3. Implement `updateNorthernProduct` method
4. Create `lib/api/northern-products.ts` API client
5. Test API client methods

### Step 3: Northern Products - Category Field Components (4 hours)
1. Create `components/products/category-fields/` directory
2. Create `CategoryFields.tsx` wrapper component
3. Implement FragranceFields component
4. Implement FashionFields component
5. Implement SnacksFields component
6. Implement MaterialsFields component
7. Implement SkincareFields component
8. Implement HairCareFields component
9. Implement IslamicFields component
10. Implement ElectronicsFields component
11. Test each component with sample data

### Step 4: Northern Products - Product Creation UI (3 hours)
1. Update `app/products/new.tsx`:
   - Add product type selector in Step 1
   - Add category picker when Northern selected
   - Integrate CategoryFields component
   - Update form state to include category-specific fields
   - Implement category-specific validation
   - Update handleCreate to use createNorthernProduct
2. Test product creation flow for each category

### Step 5: Northern Products - Product Edit UI (2 hours)
1. Update `app/products/[id].tsx`:
   - Detect product type (standard vs northern)
   - Display category-specific fields in view mode
   - Show category-specific fields in edit mode
   - Update handleSave to use updateNorthernProduct for Northern products
2. Test product editing flow

### Step 6: Order Features - Update Types (30 min)
1. Open `types/index.ts`
2. Add `Park` interface
3. Update `OrderStatus` type to include `'AvailabilityCheck'`
4. Update `Order` interface with new fields
5. Verify TypeScript compilation

### Step 7: Order Features - Create Parks Data Layer (45 min)
1. Create `lib/firebase/firestore/parks.ts`
2. Implement `useParksByState` hook
3. Test hook with mock data

### Step 8: Order Features - Add Cloud Functions (30 min)
1. Add park and availability Cloud Function URLs to `lib/api/cloud-functions.ts`
2. Implement `getParksByState` method
3. Implement `markOrderAsNotAvailable` method
4. Update `markOrderAsSent` to accept park parameters

### Step 9: Order Features - Update Order API (15 min)
1. Update `lib/api/orders.ts` `markAsSent` signature
2. Pass park info to Cloud Function

### Step 10: Order Features - Implement Parks UI (2 hours)
1. Update `app/orders/[id].tsx`:
   - Add park selection state
   - Fetch parks when marking as sent (if waybill)
   - Add park picker UI component
   - Update `handleMarkAsSent` to include park info
   - Display park info in order details
2. Test park selection flow

### Step 11: Order Features - Implement Availability UI (2 hours)
1. Update `app/orders/[id].tsx`:
   - Add "Mark as Not Available" button (conditional on status)
   - Add dialog/modal for reason and wait time input
   - Implement form validation
   - Call API to mark as not available
   - Display availability status in order details
2. Update `app/(tabs)/orders.tsx`:
   - Add availability status badges
3. Test availability marking flow

### Step 12: Order Features - Update Status Handling (30 min)
1. Update status colors in `app/orders/[id].tsx`
2. Update `ALLOWED_TRANSITIONS` to include `AvailabilityCheck`
3. Verify all status transitions work correctly

### Step 13: Testing & Polish (2 hours)
1. Test Northern product creation for all 8 categories
2. Test Northern product editing
3. Test category-specific validation
4. Test switching between Standard and Northern
5. Test complete flow: Mark as sent with park selection (order features)
6. Test complete flow: Mark as not available (order features)
7. Test edge cases (all features)
8. Verify UI/UX is consistent
9. Check for TypeScript errors
10. Test on different screen sizes

---

## Testing Checklist

### Parks System
- [ ] Can fetch parks by state
- [ ] Park picker appears when marking waybill order as sent
- [ ] Can select a park
- [ ] Can select "None" option
- [ ] Park information displays correctly in order details
- [ ] Handles no parks available for state
- [ ] Handles API errors gracefully
- [ ] Park selection works with photo upload

### Order Availability
- [ ] "Mark as Not Available" button appears for Processing orders
- [ ] Button hidden for non-Processing orders
- [ ] Dialog opens with reason input (required)
- [ ] Wait time input is optional
- [ ] Form validation works (reason required)
- [ ] Can submit with reason only
- [ ] Can submit with reason and wait time
- [ ] Availability status displays in order details
- [ ] Reason displays correctly
- [ ] Wait time displays correctly (if provided)
- [ ] Availability badge shows in orders list
- [ ] Orders waiting for buyer response are highlighted

### Status Flow
- [ ] `AvailabilityCheck` status displays with correct color
- [ ] Status transitions work correctly
- [ ] Cannot mark as not available if already in AvailabilityCheck
- [ ] Status badges update correctly

### Integration
- [ ] All TypeScript types compile without errors
- [ ] No runtime errors in order detail screen
- [ ] No runtime errors in orders list
- [ ] Cloud Functions called with correct parameters
- [ ] Error handling works correctly
- [ ] Loading states work correctly

---

## Questions to Resolve

1. **Cloud Function URLs**: Need actual URLs for:
   - `createNorthernProduct`
   - `updateNorthernProduct`
   - `getParksByState`
   - `markOrderAsNotAvailable`

2. **Northern Product Categories**: 
   - Should we support both Standard and Northern products, or make all products Northern?
   - Should existing products remain Standard, or migrate to Northern?
   - Can users switch product types after creation?

3. **Category Field Components**:
   - Use Picker/Dropdown component from React Native or custom?
   - Multi-select component for arrays (Set Includes, Package Items)?
   - Text input vs picker for fields like Brand and Model?

4. **Park Selection UI**: What type of picker/selector?
   - Dropdown/Picker component
   - Modal with list
   - Bottom sheet

5. **Availability Dialog**: Style preference?
   - Modal dialog
   - Bottom sheet
   - Inline form

6. **Error Handling**: How should errors be displayed?
   - Toast notifications (current pattern)
   - Alert dialogs
   - Inline error messages

---

## Estimated Timeline

### Northern Products System (Priority 1)
- **Step 1 (Types)**: 1 hour
- **Step 2 (Cloud Functions)**: 30 minutes
- **Step 3 (Category Components)**: 4 hours
- **Step 4 (Creation UI)**: 3 hours
- **Step 5 (Edit UI)**: 2 hours
- **Subtotal**: 10.5 hours

### Order Features (Priority 2)
- **Step 6 (Types)**: 30 minutes
- **Step 7 (Parks Data Layer)**: 45 minutes
- **Step 8 (Cloud Functions)**: 30 minutes
- **Step 9 (Order API)**: 15 minutes
- **Step 10 (Parks UI)**: 2 hours
- **Step 11 (Availability UI)**: 2 hours
- **Step 12 (Status Handling)**: 30 minutes
- **Subtotal**: 6.5 hours

### Testing & Polish
- **Step 13 (Testing)**: 2 hours

**Total Estimated Time**: ~19 hours

### Recommended Split
- **Phase 1 (Northern Products)**: 10.5 hours
- **Phase 2 (Order Features)**: 6.5 hours
- **Phase 3 (Testing)**: 2 hours

---

## Notes

### Northern Products System
- All write operations must use Cloud Functions (per architecture)
- Category-specific fields are validated both client-side and server-side
- Standard products continue to work - backward compatible
- Northern products require category selection and category-specific fields
- Media support (images, video, audio) - images already supported, video/audio can be added later

### Order Features
- All write operations must use Cloud Functions (per architecture)
- Parks data is read-only in mobile app (admins manage on web)
- Availability buyer responses handled on web app (mobile is seller-focused)
- Backward compatible: Existing orders without new fields will work fine
- Optional fields: Parks and availability fields are optional, so existing orders are unaffected

---

## Next Steps

1. **Review and approve this plan** - Especially Northern Products priority
2. **Get Cloud Function URLs**:
   - `createNorthernProduct`
   - `updateNorthernProduct`
   - `getParksByState`
   - `markOrderAsNotAvailable`
3. **Decide on UI component preferences**:
   - Picker/Dropdown component choice
   - Multi-select component for arrays
   - Text input vs picker for Brand/Model fields
4. **Decide on product type strategy**:
   - Support both Standard and Northern?
   - Allow type switching?
   - Migration strategy for existing products?
5. **Begin implementation** starting with Step 1 (Northern Products Types)

