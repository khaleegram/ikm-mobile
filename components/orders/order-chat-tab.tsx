import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OrderMessage } from '@/types';
import { orderChatApi } from '@/lib/api/order-chat';
import { useUser } from '@/lib/firebase/auth/use-user';
import { haptics } from '@/lib/utils/haptics';
import { IconSymbol } from '@/components/ui/icon-symbol';

const lightBrown = '#A67C52';

interface OrderChatTabProps {
  orderId: string;
  buyerId: string;
  sellerId: string;
  messages: OrderMessage[];
  loading: boolean;
  onMessagesRead: () => void;
}

function SystemBubble({ text }: { text: string }) {
  return (
    <View style={chatStyles.systemBubble}>
      <Text style={chatStyles.systemText}>{text}</Text>
    </View>
  );
}

function MessageBubbleRow({
  message,
  isOwn,
}: {
  message: OrderMessage;
  isOwn: boolean;
}) {
  const time = message.createdAt
    ? new Date(
        (message.createdAt as any).seconds
          ? (message.createdAt as any).seconds * 1000
          : message.createdAt
      ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  if (message.type === 'system') {
    return <SystemBubble text={message.text || ''} />;
  }

  return (
    <View style={[chatStyles.bubbleRow, isOwn ? chatStyles.bubbleRowOwn : chatStyles.bubbleRowOther]}>
      <View
        style={[
          chatStyles.bubble,
          isOwn ? chatStyles.bubbleOwn : chatStyles.bubbleOther,
        ]}>
        {message.type === 'image' || message.type === 'proof' ? (
          <View>
            {message.mediaUrl ? (
              <Image
                source={{ uri: message.mediaUrl }}
                style={chatStyles.mediaImage}
                contentFit="cover"
              />
            ) : null}
            {message.text ? (
              <Text
                style={[
                  chatStyles.bubbleText,
                  { color: isOwn ? '#FFFFFF' : '#111' },
                ]}>
                {message.text}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text
            style={[
              chatStyles.bubbleText,
              { color: isOwn ? '#FFFFFF' : '#111' },
            ]}>
            {message.text}
          </Text>
        )}
        <Text
          style={[
            chatStyles.bubbleTime,
            { color: isOwn ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.4)' },
          ]}>
          {time}
        </Text>
      </View>
    </View>
  );
}

export function OrderChatTab({
  orderId,
  buyerId,
  sellerId,
  messages,
  loading,
  onMessagesRead,
}: OrderChatTabProps) {
  const { user } = useUser();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const currentUserId = user?.uid || '';
  const isBuyer = currentUserId === buyerId;
  const isSeller = currentUserId === sellerId;

  useEffect(() => {
    if (messages.length > 0) {
      onMessagesRead();
    }
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    haptics.light();

    try {
      await orderChatApi.sendMessage({
        orderId,
        text: trimmed,
        type: 'text',
      });
      setText('');
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (err: any) {
      console.error('Error sending message:', err);
    } finally {
      setSending(false);
    }
  }, [text, sending, orderId]);

  const renderItem = useCallback(
    ({ item }: { item: OrderMessage }) => {
      if (item.type === 'system') {
        return <SystemBubble text={item.text || ''} />;
      }
      return (
        <MessageBubbleRow
          message={item}
          isOwn={item.senderId === currentUserId}
        />
      );
    },
    [currentUserId]
  );

  const keyExtractor = useCallback(
    (item: OrderMessage) => item.id || Math.random().toString(),
    []
  );

  if (!isBuyer && !isSeller) {
    return (
      <View style={chatStyles.emptyContainer}>
        <IconSymbol name="lock.fill" size={32} color="#666" />
        <Text style={chatStyles.emptyText}>
          You do not have access to this conversation.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={chatStyles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 100}>
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        style={chatStyles.list}
        contentContainerStyle={chatStyles.listContent}
        onContentSizeChange={() => {
          if (messages.length > 0) {
            flatListRef.current?.scrollToEnd({ animated: false });
          }
        }}
      />
      <View style={[chatStyles.composer, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          style={chatStyles.input}
          value={text}
          onChangeText={setText}
          placeholder="Type a message..."
          placeholderTextColor="#888"
          multiline
          maxLength={1000}
        />
        <TouchableOpacity
          style={[
            chatStyles.sendButton,
            { opacity: text.trim() && !sending ? 1 : 0.4 },
          ]}
          onPress={handleSend}
          disabled={!text.trim() || sending}>
          <IconSymbol name="arrow.up.circle.fill" size={34} color={lightBrown} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const chatStyles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  bubbleRow: {
    flexDirection: 'row',
    marginVertical: 3,
  },
  bubbleRowOwn: {
    justifyContent: 'flex-end',
  },
  bubbleRowOther: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  bubbleOwn: {
    backgroundColor: lightBrown,
    borderBottomRightRadius: 6,
  },
  bubbleOther: {
    backgroundColor: '#E8E8E8',
    borderBottomLeftRadius: 6,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 20,
  },
  bubbleTime: {
    fontSize: 10,
    marginTop: 4,
    textAlign: 'right',
  },
  mediaImage: {
    width: 200,
    height: 200,
    borderRadius: 10,
    marginBottom: 6,
  },
  systemBubble: {
    alignSelf: 'center',
    backgroundColor: 'rgba(127,127,127,0.1)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
    marginVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.12)',
  },
  systemText: {
    color: 'rgba(127,127,127,0.6)',
    fontSize: 12,
    fontWeight: '600',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 8,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(127,127,127,0.15)',
    backgroundColor: '#F5F5F5',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: '#E8E8E8',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#111',
    fontSize: 15,
  },
  sendButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  emptyText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
  },
});
