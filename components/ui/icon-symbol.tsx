// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolWeight } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

type IconMapping = Record<string, ComponentProps<typeof MaterialIcons>['name']>;
export type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  // Navigation & Home
  'house.fill': 'home',
  'house': 'home',
  'chevron.right': 'chevron-right',
  'chevron.left': 'chevron-left',
  'chevron.up': 'keyboard-arrow-up',
  'chevron.down': 'keyboard-arrow-down',
  'chevron.left.forwardslash.chevron.right': 'code',
  
  // Products & Inventory
  'cube.box.fill': 'inventory-2',
  'cube.box': 'inventory-2',
  
  // Orders & Shopping
  'bag.fill': 'shopping-bag',
  'bag': 'shopping-bag',
  'cart.fill': 'shopping-cart',
  'cart': 'shopping-cart',
  
  // Analytics & Charts
  'chart.bar.fill': 'bar-chart',
  'chart.bar': 'bar-chart',
  
  // Settings & Actions
  'gearshape.fill': 'settings',
  'gearshape': 'settings',
  'plus.circle.fill': 'add-circle',
  'plus.circle': 'add-circle-outline',
  
  // Media & Images
  'photo': 'image',
  'photo.fill': 'image',
  'photo.stack.fill': 'photo-library',
  'photo.stack': 'photo-library',
  'photo.badge.plus': 'add-photo-alternate',
  'photo.badge.plus.fill': 'add-photo-alternate',
  'camera.fill': 'photo-camera',
  'camera': 'photo-camera',
  'play.rectangle.fill': 'smart-display',
  'play.rectangle': 'smart-display',
  
  // Time & Calendar
  'calendar': 'calendar-today',
  'calendar.fill': 'calendar-today',
  
  // Search
  'magnifyingglass': 'search',
  'magnifyingglass.fill': 'search',
  
  // Security & Admin
  'shield.fill': 'security',
  'shield': 'security',
  'shield.checkered': 'verified-user',
  'key.fill': 'vpn-key',
  'key': 'vpn-key',
  'lock.fill': 'lock',
  'lock': 'lock-outline',
  
  // Logout & Exit
  'rectangle.portrait.and.arrow.right': 'exit-to-app',
  
  // People & Users
  'person.2.fill': 'people',
  'person.2': 'people-outline',
  'person.circle.fill': 'account-circle',
  'person.circle': 'account-circle',
  'person.fill': 'person',
  'person': 'person-outline',
  'person.badge.shield.checkmark.fill': 'admin-panel-settings',
  'person.badge.shield.checkmark': 'admin-panel-settings',
  'person.crop.circle.badge.exclamationmark': 'account-circle',
  'person.crop.circle.badge.exclamationmark.fill': 'account-circle',
  
  // Notifications & Alerts
  'exclamationmark.triangle.fill': 'warning',
  'exclamationmark.triangle': 'warning',
  'bell.fill': 'notifications',
  'bell': 'notifications-none',
  
  // Communication
  'paperplane.fill': 'send',
  'paperplane': 'send',
  'message.fill': 'message',
  'message': 'message',
  'tray.fill': 'inbox',
  'envelope.fill': 'mail',
  'envelope': 'mail-outline',
  'envelope.badge.fill': 'mark-email-unread',
  'bubble.right.fill': 'chat-bubble',
  'bubble.right': 'chat-bubble-outline',
  'bubble.left.fill': 'chat-bubble',
  'bubble.left': 'chat-bubble-outline',
  'bubble.left.and.bubble.right.fill': 'forum',
  'arrowshape.turn.up.right.fill': 'share',
  'arrowshape.turn.up.right': 'share',
  'exclamationmark.bubble.fill': 'report',
  'exclamationmark.bubble': 'report',
  
  // Status & Indicators
  'checkmark.circle.fill': 'check-circle',
  'checkmark.circle': 'check-circle-outline',
  'checkmark.seal.fill': 'verified',
  'checkmark.seal': 'verified',
  'xmark.circle.fill': 'cancel',
  'xmark.circle': 'cancel',
  'info.circle.fill': 'info',
  'info.circle': 'info-outline',
  
  // Finance & Money
  'dollarsign.circle.fill': 'attach-money',
  'dollarsign.circle': 'attach-money',
  'creditcard.fill': 'credit-card',
  'creditcard': 'credit-card',
  'percent': 'percent',
  'percent.fill': 'percent',
  
  // Location
  'location.fill': 'location-on',
  'location': 'location-on',
  'building.2.fill': 'apartment',
  'building.2': 'apartment',
  'map.fill': 'map',
  'map': 'map',
  
  // Time & Clock
  'clock.fill': 'access-time',
  'clock': 'access-time',
  
  // Edit & Actions
  'pencil.fill': 'edit',
  'pencil': 'edit',
  'trash.fill': 'delete',
  'trash': 'delete-outline',
  'minus': 'remove',
  'plus': 'add',
  'arrow.up': 'arrow-upward',
  'arrow.down': 'arrow-downward',
  'arrow.left': 'arrow-back',
  'arrow.right': 'arrow-forward',
  'arrow.up.right': 'open-in-new',
  'arrow.up.right.square': 'open-in-new',
  'arrow.clockwise': 'refresh',
  'arrow.up.circle.fill': 'send',
  'square.and.arrow.up': 'share',
  'ellipsis': 'more-horiz',
  
  // More
  'star.fill': 'star',
  'star': 'star-outline',
  'heart.fill': 'favorite',
  'heart': 'favorite-outline',
  'eye.fill': 'visibility',
  'eye': 'visibility',
  'eye.slash.fill': 'visibility-off',
  'eye.slash': 'visibility-off',
  'megaphone.fill': 'campaign',
  'megaphone': 'campaign',
  'doc.text.fill': 'description',
  'doc.text': 'description',
  'globe': 'language',
  'globe.fill': 'language',
  'shippingbox.fill': 'local-shipping',
  'shippingbox': 'local-shipping',
  'paintbrush.fill': 'brush',
  'paintbrush': 'brush',
  'sun.max.fill': 'wb-sunny',
  'moon.fill': 'nightlight',
  'storefront.fill': 'store',
  'storefront': 'store',
  'link': 'link',
  
  // Transportation
  'bus': 'directions-bus',
  'bus.fill': 'directions-bus',
  
  // Design & Customization
  'paintpalette.fill': 'palette',
  'paintpalette': 'palette',
  
  // Royalty & Premium
  'crown.fill': 'workspace-premium',
  'crown': 'workspace-premium',
  
  // Security & Lock
  'lock.shield.fill': 'admin-panel-settings',
  'lock.shield': 'admin-panel-settings',
  
  // Phone & Communication
  'phone.fill': 'phone-enabled',
  'phone': 'phone-enabled',
  
  // Navigation & Exit
  'arrow.left.square.fill': 'logout',
  'arrow.left.square': 'logout',
  
  // Tags & Labels
  'tag.fill': 'local-offer',
  'tag': 'local-offer',
  
  // Close & Cancel
  'xmark': 'close',
  
  // Media
  'video.fill': 'videocam',
  'video': 'videocam',
  'music.note': 'music-note',
  'waveform': 'graphic-eq',
  'waveform.fill': 'graphic-eq',
  
  // Checkmarks
  'checkmark': 'check',
  
  // Grid & Layout
  'square.grid.2x2.fill': 'grid-view',
  'square.grid.2x2': 'grid-view',
  'list.bullet.fill': 'list',
  'list.bullet': 'list',
  'rectangle.split.3x1.fill': 'view-column',
  'rectangle.split.3x1': 'view-column',
} as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  const iconName = MAPPING[name];
  if (!iconName) {
    console.warn(`Icon "${name}" not found in mapping, using default "help" icon`);
    return <MaterialIcons color={color} size={size} name="help" style={style} />;
  }
  
  // For outline icons (without .fill), use reduced opacity to simulate outline effect
  const isOutline = !name.includes('.fill');
  const iconOpacity = isOutline ? 0.6 : 1;

  return <MaterialIcons color={color} size={size} name={iconName} style={[{ opacity: iconOpacity }, style]} />;
}
