import { Redirect, useLocalSearchParams } from 'expo-router';

/** Deep-link alias → social people list (followers). */
export default function FollowersRedirect() {
  const { userId } = useLocalSearchParams<{ userId?: string }>();
  return (
    <Redirect
      href={{
        pathname: '/(market)/social-people',
        params: { mode: 'followers', userId: userId || '' },
      }}
    />
  );
}
