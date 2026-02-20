import { Redirect } from 'expo-router';

// Expo Router documented not-found route. Useful for dev-client deep links too.
export default function NotFound() {
  return <Redirect href="/" />;
}

