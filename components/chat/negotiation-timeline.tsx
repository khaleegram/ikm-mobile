import React from 'react';
import { ScrollView, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme/theme-context';
import type { ChatMessage } from '@/types/chat';

type NegotiationTimelineProps = {
  messages: ChatMessage[];
};

export function NegotiationTimeline({ messages }: NegotiationTimelineProps) {
  const { colors } = useTheme();

  const steps = messages
    .filter((m) => m.offer && (m.type === 'offer' || m.type === 'counter'))
    .map((m) => ({
      id: m.id,
      amount: m.offer!.amount,
      currency: m.offer!.currency,
      status: m.offer!.status,
    }));

  if (steps.length < 2) return null;

  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}>
      <Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 4 }}>
        Negotiation
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {steps.map((step, index) => (
          <View
            key={step.id}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 16,
              backgroundColor:
                step.status === 'accepted'
                  ? `${colors.primary}22`
                  : colors.backgroundSecondary,
              borderWidth: 1,
              borderColor: colors.border,
            }}>
            <Text style={{ fontSize: 12, color: colors.text, fontWeight: '600' }}>
              {index + 1}. {step.currency} {step.amount.toLocaleString()}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
