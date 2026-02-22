import { AppVariant, getAppVariant } from './app-variant';

export const MARKET_LOGIN_ROUTE = '/(auth)/market-login';
export const MARKET_SIGNUP_ROUTE = '/(auth)/market-signup';
export const SELLER_LOGIN_ROUTE = '/(auth)/seller-login';
export const SELLER_SIGNUP_ROUTE = '/(auth)/seller-signup';

export function getLoginRouteForVariant(variant: AppVariant): string {
  return variant === 'seller' ? SELLER_LOGIN_ROUTE : MARKET_LOGIN_ROUTE;
}

export function getSignupRouteForVariant(variant: AppVariant): string {
  return variant === 'seller' ? SELLER_SIGNUP_ROUTE : MARKET_SIGNUP_ROUTE;
}

export function getLoginRoute(): string {
  return getLoginRouteForVariant(getAppVariant());
}

export function getSignupRoute(): string {
  return getSignupRouteForVariant(getAppVariant());
}
