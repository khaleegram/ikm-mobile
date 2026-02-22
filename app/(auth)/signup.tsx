import { Redirect } from 'expo-router';

import { getSignupRoute } from '@/lib/utils/auth-routes';

export default function SignupAliasScreen() {
  return <Redirect href={getSignupRoute() as any} />;
}
