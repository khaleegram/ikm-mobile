/**
 * The call button in a deal room header.
 *
 * One button, not two. The header already carries the store name and an Offer pill, and two
 * permanent call icons would squeeze the name that people actually need to read. Tapping opens a
 * two-choice sheet, which costs one tap for video and keeps the header calm.
 */
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { callManager } from '@/lib/calls/call-manager';
import type { CallKind } from '@/lib/api/calls';

import { lightBrown } from './utils';
import { styles } from './styles';

type CallButtonsProps = {
  colors: any;
  threadId: string;
  peerId: string;
  peerName: string;
  peerAvatarUri?: string;
  /** Blocked or not-yet-ready rooms should not be callable. */
  disabled?: boolean;
};

export function CallButtons({
  colors,
  threadId,
  peerId,
  peerName,
  peerAvatarUri,
  disabled = false,
}: CallButtonsProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const startCall = (kind: CallKind) => {
    setSheetOpen(false);
    void callManager.start({
      threadId,
      kind,
      peer: { id: peerId, name: peerName || 'Store', avatarUri: peerAvatarUri },
    });
  };

  return (
    <>
      <Pressable
        onPress={() => setSheetOpen(true)}
        disabled={disabled || !peerId}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Call ${peerName || 'store'}`}
        style={({ pressed }) => ({
          width: 38,
          height: 38,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled || !peerId ? 0.4 : pressed ? 0.6 : 1,
        })}>
        <IconSymbol name="phone.fill" size={19} color={colors.text} />
      </Pressable>

      <Modal
        visible={sheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSheetOpen(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
          onPress={() => setSheetOpen(false)}>
          {/* Stop taps inside the sheet from closing it. */}
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              backgroundColor: colors.card,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingTop: 10,
              paddingBottom: 28,
              paddingHorizontal: 16,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderColor: colors.border,
            }}>
            <View
              style={{
                alignSelf: 'center',
                width: 38,
                height: 4,
                borderRadius: 2,
                backgroundColor: colors.border,
                marginBottom: 16,
              }}
            />

            <Text
              numberOfLines={1}
              style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 12, paddingHorizontal: 4 }}>
              Call {peerName || 'this store'}
            </Text>

            {(
              [
                { kind: 'audio' as CallKind, icon: 'phone.fill' as const, label: 'Voice call' },
                { kind: 'video' as CallKind, icon: 'video.fill' as const, label: 'Video call' },
              ]
            ).map((option) => (
              <Pressable
                key={option.kind}
                onPress={() => startCall(option.kind)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  paddingVertical: 15,
                  paddingHorizontal: 12,
                  borderRadius: 14,
                  backgroundColor: pressed ? `${lightBrown}14` : 'transparent',
                })}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: `${lightBrown}1F`,
                  }}>
                  <IconSymbol name={option.icon} size={19} color={lightBrown} />
                </View>
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: '500' }}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
