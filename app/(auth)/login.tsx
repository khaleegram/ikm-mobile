import { Redirect } from 'expo-router';

import { getLoginRoute } from '@/lib/utils/auth-routes';

export default function LoginAliasScreen() {
  return <Redirect href={getLoginRoute() as any} />;
}
