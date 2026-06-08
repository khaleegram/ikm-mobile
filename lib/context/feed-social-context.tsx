import React, { createContext, useContext } from 'react';

type FeedSocialContextValue = {
  enabled: boolean;
  followingIdSet: Set<string>;
  savedIdSet: Set<string>;
};

const EMPTY_SET = new Set<string>();

const FeedSocialContext = createContext<FeedSocialContextValue>({
  enabled: false,
  followingIdSet: EMPTY_SET,
  savedIdSet: EMPTY_SET,
});

export function FeedSocialProvider({
  followingIdSet,
  savedIdSet,
  children,
}: {
  followingIdSet: Set<string>;
  savedIdSet: Set<string>;
  children: React.ReactNode;
}) {
  const value = React.useMemo(
    () => ({ enabled: true, followingIdSet, savedIdSet }),
    [followingIdSet, savedIdSet]
  );
  return <FeedSocialContext.Provider value={value}>{children}</FeedSocialContext.Provider>;
}

export function useFeedSocial() {
  return useContext(FeedSocialContext);
}
