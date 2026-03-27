import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { useTheme } from '@/lib/theme/theme-context';
import { haptics } from '@/lib/utils/haptics';

const lightBrown = '#A67C52';

export type PaystackCheckoutResult = {
  type: 'success' | 'cancel' | 'dismiss' | 'error';
  url?: string;
};

type PaystackCheckoutModalProps = {
  visible: boolean;
  authorizationUrl: string | null;
  onResult: (result: PaystackCheckoutResult) => void;
};

function extractQueryParam(url: string, name: string): string {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) return '';
  const match = normalizedUrl.match(new RegExp(`[?&]${name}=([^&#]+)`, 'i'));
  if (!match?.[1]) return '';
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return String(match[1]).trim();
  }
}

function resolvePaystackCompletionType(url: string): 'success' | 'cancel' | null {
  const normalized = String(url || '').trim().toLowerCase();
  if (!normalized) return null;

  const status = extractQueryParam(url, 'status').toLowerCase();
  const reference = extractQueryParam(url, 'reference') || extractQueryParam(url, 'trxref');
  const hasReference = Boolean(String(reference || '').trim());
  const hasCallbackPath = normalized.includes('paystack-callback');

  // Paystack close route can appear without callback query params.
  if (normalized.includes('/close')) return 'cancel';

  // Treat callback route as terminal checkout state.
  if (hasCallbackPath) {
    if (status === 'success') return 'success';
    if (status && status !== 'success') return 'cancel';
    if (hasReference) return 'success';
    return null;
  }

  // Some setups may return status in-place without callback URL rewrite.
  if (status === 'success' && hasReference) return 'success';
  if (['failed', 'cancel', 'cancelled', 'abandoned', 'error'].includes(status)) return 'cancel';

  return null;
}

export function PaystackCheckoutModal({
  visible,
  authorizationUrl,
  onResult,
}: PaystackCheckoutModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const lastSeenUrlRef = useRef<string>('');
  const [isLoading, setIsLoading] = useState(true);

  const canRender = Boolean(visible && authorizationUrl);

  const closeWith = useCallback(
    (result: PaystackCheckoutResult) => {
      haptics.light();
      onResult(result);
    },
    [onResult]
  );

  const handleClose = useCallback(() => {
    closeWith({ type: 'cancel', url: lastSeenUrlRef.current || undefined });
  }, [closeWith]);

  const handlePossibleCompletion = useCallback(
    (url: string) => {
      const completionType = resolvePaystackCompletionType(url);
      if (!completionType) return;

      if (completionType === 'cancel') {
        closeWith({ type: 'cancel', url });
        return;
      }

      closeWith({ type: 'success', url });
    },
    [closeWith]
  );

  const headerPaddingTop = useMemo(() => Math.max(insets.top, 10), [insets.top]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            {
              paddingTop: headerPaddingTop,
              borderBottomColor: colors.border,
              backgroundColor: colors.card,
            },
          ]}>
          <TouchableOpacity onPress={handleClose} style={styles.headerButton}>
            <IconSymbol name="xmark" size={18} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Pay to Escrow</Text>
          <View style={styles.headerButton} />
        </View>

        {canRender ? (
          <WebView
            source={{ uri: authorizationUrl! }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            setSupportMultipleWindows={false}
            sharedCookiesEnabled={Platform.OS === 'ios'}
            thirdPartyCookiesEnabled={Platform.OS === 'android'}
            onLoadStart={() => setIsLoading(true)}
            onLoadEnd={() => setIsLoading(false)}
            onNavigationStateChange={(navState: WebViewNavigation) => {
              const nextUrl = String(navState?.url || '').trim();
              if (!nextUrl) return;
              lastSeenUrlRef.current = nextUrl;
              handlePossibleCompletion(nextUrl);
            }}
            onShouldStartLoadWithRequest={(request) => {
              const nextUrl = String(request?.url || '').trim();
              if (!nextUrl) return true;

              // Prevent the OS from opening custom schemes; treat as completion instead.
              if (!nextUrl.startsWith('http://') && !nextUrl.startsWith('https://')) {
                lastSeenUrlRef.current = nextUrl;
                handlePossibleCompletion(nextUrl);
                return false;
              }

              lastSeenUrlRef.current = nextUrl;
              return true;
            }}
            onError={(event) => {
              const failingUrl = String(event?.nativeEvent?.url || '').trim() || lastSeenUrlRef.current;
              closeWith({ type: 'error', url: failingUrl || undefined });
            }}
            style={styles.webview}
          />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={lightBrown} />
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>
              Loading checkout...
            </Text>
          </View>
        )}

        {isLoading ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="small" color={lightBrown} />
          </View>
        ) : null}

        <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
          <TouchableOpacity
            style={[styles.footerButton, { backgroundColor: lightBrown }]}
            onPress={() => closeWith({ type: 'success', url: lastSeenUrlRef.current || undefined })}>
            <Text style={styles.footerButtonText}>I have completed payment</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 66,
    right: 14,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
  },
  helperText: {
    fontSize: 13,
    fontWeight: '600',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
  },
  footerButton: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  footerButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
});
