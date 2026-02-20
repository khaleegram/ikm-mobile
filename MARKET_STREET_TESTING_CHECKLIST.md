# Market Street Testing Checklist

This document provides a comprehensive testing checklist for the Market Street feature implementation.

## Phase 8.4: Testing & Edge Cases

### 1. Post Creation Tests

#### ✅ Test with 1 Image Post
- [ ] Create a post with exactly 1 image
- [ ] Verify image displays correctly in feed
- [ ] Verify no pagination dots appear (single image)
- [ ] Verify post appears in user's profile posts count

#### ✅ Test with 20 Image Post
- [ ] Create a post with maximum 20 images
- [ ] Verify all images can be swiped through
- [ ] Verify pagination dots show correctly (20 dots)
- [ ] Verify images load efficiently
- [ ] Verify post creation doesn't timeout

#### ✅ Test with No Price (Ask for Price Flow)
- [ ] Create a post without price
- [ ] Verify "Ask for Price" button appears
- [ ] Click "Ask for Price" as guest → Should prompt login
- [ ] Click "Ask for Price" as logged-in user → Should navigate to chat
- [ ] Verify chat is created correctly with post context

### 2. Guest Browsing Tests

#### ✅ Guest Access
- [ ] App starts on Market Street feed (not login)
- [ ] Guest can scroll through feed
- [ ] Guest can view post details
- [ ] Guest can see trending hashtags
- [ ] Guest can search posts

#### ✅ Guest Interaction Restrictions
- [ ] Guest cannot like posts (prompts login)
- [ ] Guest cannot comment (prompts login)
- [ ] Guest cannot message sellers (prompts login)
- [ ] Guest cannot create posts (prompts login)

### 3. Authentication & User Types

#### ✅ Login Flow from Profile
- [ ] Click "Login" button in profile (guest state)
- [ ] Complete login successfully
- [ ] Verify redirect to Market Street feed
- [ ] Verify user can now interact (like, comment, etc.)

#### ✅ Customer User Type
- [ ] Sign up as Customer
- [ ] Verify can browse feed
- [ ] Verify can like posts
- [ ] Verify can comment
- [ ] Verify can message sellers
- [ ] Verify can create posts
- [ ] Verify cannot access seller dashboard

#### ✅ Street Seller User Type
- [ ] Sign up as Street Seller
- [ ] Verify can browse feed
- [ ] Verify can create posts
- [ ] Verify can like/comment on other posts
- [ ] Verify can message buyers
- [ ] Verify cannot access business seller dashboard

#### ✅ Business Seller User Type
- [ ] Sign up as Business Seller
- [ ] Verify can access seller dashboard (`(tabs)`)
- [ ] Verify can also browse Market Street
- [ ] Verify can create Market Street posts
- [ ] Verify can manage business products separately

#### ✅ Admin User Type
- [ ] Login as Admin
- [ ] Verify can access admin dashboard
- [ ] Verify can access seller dashboard
- [ ] Verify can browse Market Street
- [ ] Verify can create Market Street posts

### 4. Feed Functionality Tests

#### ✅ Feed Scrolling
- [ ] Vertical scrolling works smoothly
- [ ] Snap-to-interval works correctly (one post per screen)
- [ ] Pull-to-refresh works
- [ ] Infinite scroll loads more posts
- [ ] Loading indicator appears during pagination

#### ✅ Image Gallery
- [ ] Horizontal swipe works for multi-image posts
- [ ] Pagination dots update correctly
- [ ] Images load with proper caching
- [ ] Image transitions are smooth
- [ ] Images handle errors gracefully (show placeholder)

#### ✅ Like Functionality
- [ ] Like button animates on press
- [ ] Like count updates immediately
- [ ] Heart icon fills when liked
- [ ] Unlike works correctly
- [ ] Like persists after app restart

#### ✅ Comment Functionality
- [ ] Comment button navigates to post detail
- [ ] Comment count displays correctly
- [ ] Can add comments
- [ ] Can delete own comments
- [ ] Cannot delete others' comments

### 5. Search & Discovery Tests

#### ✅ Search Functionality
- [ ] Search by hashtag works (#fashion)
- [ ] Search by text works (description, location)
- [ ] Search results display correctly
- [ ] Empty search state shows
- [ ] Recent searches save correctly
- [ ] Clear recent searches works

#### ✅ Trending Hashtags
- [ ] Trending hashtags display
- [ ] Clicking hashtag performs search
- [ ] Hashtag counts update correctly

### 6. Messaging Tests

#### ✅ Chat Creation
- [ ] Chat created when messaging seller
- [ ] Chat appears in messages list
- [ ] Chat ID format is correct
- [ ] Multiple chats work correctly

#### ✅ Message Sending
- [ ] Text messages send successfully
- [ ] Image messages send successfully
- [ ] Payment links can be shared
- [ ] Messages appear in real-time
- [ ] Read status updates correctly

### 7. Profile & Settings Tests

#### ✅ Profile Screen
- [ ] Guest state shows login/signup buttons
- [ ] Logged-in state shows user info
- [ ] Posts count displays correctly
- [ ] Likes count displays correctly
- [ ] Settings button navigates correctly
- [ ] Logout works correctly

#### ✅ Settings Screen
- [ ] Profile picture can be updated
- [ ] Display name can be edited
- [ ] Phone number can be updated
- [ ] Theme toggle works
- [ ] Notifications toggle works
- [ ] Terms/Privacy links work
- [ ] Logout works

### 8. Error Handling Tests

#### ✅ Network Errors
- [ ] Offline state handled gracefully
- [ ] Network error messages are user-friendly
- [ ] Retry button works
- [ ] Failed operations can be retried

#### ✅ Image Load Errors
- [ ] Broken image URLs show placeholder
- [ ] Image loading errors don't crash app
- [ ] Multiple image errors handled correctly

#### ✅ API Errors
- [ ] 401 errors prompt re-login
- [ ] 403 errors show appropriate message
- [ ] 404 errors handled gracefully
- [ ] 500 errors show retry option
- [ ] Error messages are user-friendly

### 9. Performance Tests

#### ✅ Feed Performance
- [ ] Feed scrolls smoothly (60fps)
- [ ] Images load progressively
- [ ] Memory usage stays reasonable
- [ ] No memory leaks on long scrolling
- [ ] Pagination doesn't cause lag

#### ✅ Image Caching
- [ ] Images cache correctly
- [ ] Cached images load instantly
- [ ] Cache persists after app restart
- [ ] Cache doesn't grow unbounded

### 10. Edge Cases

#### ✅ Empty States
- [ ] Empty feed shows message
- [ ] Empty search results show message
- [ ] Empty messages list shows message
- [ ] Empty profile posts shows correctly

#### ✅ Data Edge Cases
- [ ] Post with no description
- [ ] Post with no hashtags
- [ ] Post with no location
- [ ] Post with very long description
- [ ] Post with special characters in hashtags
- [ ] Post with emoji in description

#### ✅ Boundary Conditions
- [ ] Create post with exactly 1 image (minimum)
- [ ] Create post with exactly 20 images (maximum)
- [ ] Try to create post with 21 images (should fail)
- [ ] Try to create post with 0 images (should fail)
- [ ] Very long hashtag list (10 hashtags)
- [ ] Very long description (1000 characters)

### 11. Integration Tests

#### ✅ Market Street vs Business Products
- [ ] Market Street posts don't appear in business products
- [ ] Business products don't appear in Market Street
- [ ] Data is completely separate
- [ ] No cross-contamination

#### ✅ Navigation Flow
- [ ] Can navigate from feed to post detail
- [ ] Can navigate from post to chat
- [ ] Can navigate from profile to settings
- [ ] Back navigation works correctly
- [ ] Tab navigation works correctly

### 12. Security Tests

#### ✅ Authorization
- [ ] Users can only delete their own posts
- [ ] Users can only delete their own comments
- [ ] Guests cannot perform write operations
- [ ] Proper authentication checks on all endpoints

#### ✅ Data Privacy
- [ ] User data not exposed to other users
- [ ] Chat messages are private
- [ ] Profile information respects privacy settings

## Testing Notes

- **Test on both iOS and Android**
- **Test on different screen sizes**
- **Test with slow network connection**
- **Test with no network connection**
- **Test with various user roles**
- **Monitor performance metrics during testing**
- **Check for memory leaks during extended use**

## Performance Benchmarks

- Feed should load initial posts in < 2 seconds
- Images should start loading within 1 second
- Like action should complete in < 500ms
- Comment submission should complete in < 1 second
- Search results should appear in < 1 second
- App should maintain 60fps during scrolling

## Known Issues / Future Improvements

- [ ] Add loading skeletons for better UX
- [ ] Implement share functionality
- [ ] Add post expiration handling
- [ ] Add post reporting functionality
- [ ] Add user blocking functionality
- [ ] Implement push notifications for messages
- [ ] Add analytics tracking
