import { Redirect, useLocalSearchParams } from 'expo-router';

export default function LikedRedirect() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  return <Redirect href={{ pathname: '/(market)/saved', params: { mode: mode || 'liked' } }} />;
}
