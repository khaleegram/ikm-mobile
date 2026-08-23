import { Redirect, useLocalSearchParams } from 'expo-router';

/** People you (or a seller) follow — distinct from `following.tsx` feed redirect. */
export default function FollowingPeopleRedirect() {
  const { userId } = useLocalSearchParams<{ userId?: string }>();
  return (
    <Redirect
      href={{
        pathname: '/(market)/social-people',
        params: { mode: 'following', userId: userId || '' },
      }}
    />
  );
}
