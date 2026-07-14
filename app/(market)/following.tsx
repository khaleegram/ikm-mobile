import { Redirect } from 'expo-router';

export default function FollowingRedirect() {
  return <Redirect href={{ pathname: '/(market)/index', params: { mode: 'following' } }} />;
}
