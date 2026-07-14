import React from 'react';

import { FeedVideoItem, type FeedVideoItemProps } from './feed-video-item';

/** @deprecated Prefer FeedVideoItem — thin wrapper for existing imports. */
export type FeedCardProps = FeedVideoItemProps;

export const FeedCard = React.memo(function FeedCard(props: FeedCardProps) {
  return <FeedVideoItem {...props} />;
});
