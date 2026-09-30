import { Stack } from 'expo-router';

import { AppErrorBoundary } from '@/components/app-error-boundary';

/**
 * Anchor this stack at the inbox list.
 *
 * Without this, opening a chat from the feed or a post (`/messages/{chatId}`) built the messages
 * stack with the thread as its *only* screen. Back then popped the last entry and fell through to
 * the previous tab — the feed — instead of the inbox, and the tab kept the old thread on top
 * afterwards, so tapping Inbox reopened a conversation you were already done with.
 *
 * With the anchor, the inbox always sits underneath any thread: back returns to the list, and the
 * Inbox tab has somewhere sensible to land.
 */
export const unstable_settings = {
  // `anchor` is the current name; `initialRouteName` is the older one. This router reads
  // whichever is present, so both are set to be safe across versions.
  anchor: 'index',
  initialRouteName: 'index',
};

export default function MessagesStackLayout() {
  return (
    <AppErrorBoundary>
      <Stack screenOptions={{ headerShown: false }} />
    </AppErrorBoundary>
  );
}
