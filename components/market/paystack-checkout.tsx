import React, { useEffect, useRef } from 'react';
import { PaystackProvider, usePaystack } from 'react-native-paystack-webview';

export interface PaystackCheckoutProps {
  visible: boolean;
  paystackKey: string;
  amount: number;
  billingEmail: string;
  billingName: string;
  refNumber: string;
  onSuccess: (data: any) => void;
  onCancel: () => void;
  onError: (error: any) => void;
}

/**
 * Opens Paystack inline checkout via `react-native-paystack-webview` v5 API
 * (`PaystackProvider` + `usePaystack().popup.checkout`). The v4 `<Paystack />`
 * component no longer exists in this package version.
 */
function PaystackCheckoutSession({
  amount,
  billingEmail,
  billingName,
  refNumber,
  onSuccess,
  onCancel,
  onError,
}: Omit<PaystackCheckoutProps, 'visible' | 'paystackKey'>) {
  const { popup } = usePaystack();
  const onSuccessRef = useRef(onSuccess);
  const onCancelRef = useRef(onCancel);
  const onErrorRef = useRef(onError);
  const openedOnceRef = useRef(false);
  onSuccessRef.current = onSuccess;
  onCancelRef.current = onCancel;
  onErrorRef.current = onError;

  useEffect(() => {
    if (openedOnceRef.current) return;
    openedOnceRef.current = true;
    popup.checkout({
      email: billingEmail,
      amount,
      reference: refNumber,
      metadata: {
        custom_fields: [
          {
            display_name: 'Customer Name',
            variable_name: 'customer_name',
            value: billingName,
          },
        ],
      },
      onSuccess: (data) => onSuccessRef.current(data),
      onCancel: () => onCancelRef.current(),
      onError: (err) => onErrorRef.current(err),
    });
    // Open once for this mounted checkout session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export function PaystackCheckout({
  visible,
  paystackKey,
  amount,
  billingEmail,
  billingName,
  refNumber,
  onSuccess,
  onCancel,
  onError,
}: PaystackCheckoutProps) {
  if (!visible || !paystackKey) return null;

  return (
    <PaystackProvider
      publicKey={paystackKey}
      currency="NGN"
      defaultChannels={['card', 'bank', 'ussd', 'mobile_money', 'bank_transfer']}>
      <PaystackCheckoutSession
        key={refNumber}
        amount={amount}
        billingEmail={billingEmail}
        billingName={billingName}
        refNumber={refNumber}
        onSuccess={onSuccess}
        onCancel={onCancel}
        onError={onError}
      />
    </PaystackProvider>
  );
}
