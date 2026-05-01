import { resolveDefaultPhoneCountryIso2 } from '@/lib/utils/phone-country';
import metadata from 'libphonenumber-js/metadata.min.json';
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/core';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconSymbol } from '@/components/ui/icon-symbol';

type SmartPhoneColors = {
  text: string;
  textSecondary: string;
  border: string;
  background: string;
  backgroundSecondary: string;
  card: string;
};

export type SmartPhoneFieldProps = {
  value: string;
  onChange: (e164OrPartial: string) => void;
  colors: SmartPhoneColors;
  accentColor: string;
  /** When set, used for the country chip and input outlines (e.g. validation state). */
  borderColor?: string;
  disabled?: boolean;
  placeholder?: string;
};

type CountryRow = { code: CountryCode; name: string; dial: string };

const COUNTRY_NAME_OVERRIDES: Partial<Record<CountryCode, string>> = {
  NG: 'Nigeria',
  US: 'United States',
  GB: 'United Kingdom',
};

function getSafeRegionLabel(code: CountryCode): string {
  const override = COUNTRY_NAME_OVERRIDES[code];
  if (override) return override;
  try {
    const DisplayNamesCtor = (Intl as any)?.DisplayNames;
    if (typeof DisplayNamesCtor === 'function') {
      const regionNames = new DisplayNamesCtor(['en'], { type: 'region' });
      const label = regionNames?.of?.(code);
      if (label && typeof label === 'string') return label;
    }
  } catch {
    // fall back to ISO code
  }
  return code;
}

function buildCountryRows(): CountryRow[] {
  const rows = getCountries(metadata)
    .map((code) => ({
      code,
      name: getSafeRegionLabel(code),
      dial: `+${getCountryCallingCode(code, metadata)}`,
    }))
    .sort((a, b) => {
      // Keep Nigeria at the top for fast access.
      if (a.code === 'NG') return -1;
      if (b.code === 'NG') return 1;
      return a.name.localeCompare(b.name);
    });
  return rows;
}

function formatNationalInput(country: CountryCode, digitString: string): string {
  const formatter = new AsYouType(country, metadata);
  let out = '';
  for (const ch of digitString) {
    if (/\d/.test(ch)) out = formatter.input(ch);
  }
  return out;
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

function e164FromCountryAndNational(country: CountryCode, nationalDigits: string): string {
  if (!nationalDigits) return '';
  const parsed = parsePhoneNumberFromString(nationalDigits, country, metadata);
  if (parsed?.isValid()) return parsed.number;
  const cc = getCountryCallingCode(country, metadata);
  return `+${cc}${nationalDigits}`;
}

function syncFromValue(
  raw: string,
  fallbackCountry: CountryCode,
): { country: CountryCode; nationalDigits: string; nationalFormatted: string } {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return { country: fallbackCountry, nationalDigits: '', nationalFormatted: '' };
  }
  const parsed = parsePhoneNumberFromString(trimmed, metadata);
  if (parsed) {
    const c = (parsed.country || fallbackCountry) as CountryCode;
    const nationalDigits = digitsOnly(parsed.nationalNumber || '');
    return {
      country: c,
      nationalDigits,
      nationalFormatted: formatNationalInput(c, nationalDigits),
    };
  }
  const only = digitsOnly(trimmed);
  return {
    country: fallbackCountry,
    nationalDigits: only,
    nationalFormatted: formatNationalInput(fallbackCountry, only),
  };
}

export function SmartPhoneField({
  value,
  onChange,
  colors,
  accentColor,
  borderColor,
  disabled = false,
  placeholder,
}: SmartPhoneFieldProps) {
  const insets = useSafeAreaInsets();
  const deviceDefaultCountry = useMemo(() => resolveDefaultPhoneCountryIso2(), []);

  const [country, setCountry] = useState<CountryCode>(deviceDefaultCountry);
  const [nationalFormatted, setNationalFormatted] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');

  const allRows = useMemo(() => buildCountryRows(), []);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.dial.includes(q),
    );
  }, [allRows, query]);

  useEffect(() => {
    const next = syncFromValue(value, deviceDefaultCountry);
    setCountry(next.country);
    setNationalFormatted(next.nationalFormatted);
  }, [value, deviceDefaultCountry]);

  const emit = useCallback(
    (nextCountry: CountryCode, nationalDigits: string) => {
      onChange(e164FromCountryAndNational(nextCountry, nationalDigits));
    },
    [onChange],
  );

  const onPickCountry = (code: CountryCode) => {
    setCountry(code);
    setPickerOpen(false);
    setQuery('');
    const formatted = formatNationalInput(code, digitsOnly(nationalFormatted));
    setNationalFormatted(formatted);
    emit(code, digitsOnly(formatted));
  };

  const onChangeNational = (text: string) => {
    const rawDigits = digitsOnly(text);
    const formatted = formatNationalInput(country, rawDigits);
    setNationalFormatted(formatted);
    emit(country, rawDigits);
  };

  const outline = borderColor ?? colors.border;
  const dial = `+${getCountryCallingCode(country, metadata)}`;
  const defaultPlaceholder = placeholder ?? 'Phone number';

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={[
          styles.countryButton,
          {
            borderColor: outline,
            backgroundColor: colors.backgroundSecondary,
            opacity: disabled ? 0.6 : 1,
          },
        ]}
        onPress={() => !disabled && setPickerOpen(true)}
        disabled={disabled}
        activeOpacity={0.85}>
        <Text style={[styles.countryButtonText, { color: colors.text }]} numberOfLines={1}>
          {country} {dial}
        </Text>
        <IconSymbol name="chevron.down" size={16} color={colors.textSecondary} />
      </TouchableOpacity>

      <TextInput
        value={nationalFormatted}
        onChangeText={onChangeNational}
        placeholder={defaultPlaceholder}
        placeholderTextColor={colors.textSecondary}
        keyboardType="phone-pad"
        editable={!disabled}
        style={[
          styles.input,
          {
            color: colors.text,
            borderColor: outline,
            backgroundColor: colors.backgroundSecondary,
          },
        ]}
      />

      <Modal visible={pickerOpen} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modalRoot, { paddingTop: insets.top + 8, backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Country / region</Text>
            <Pressable onPress={() => setPickerOpen(false)} hitSlop={12}>
              <Text style={[styles.doneLink, { color: accentColor }]}>Done</Text>
            </Pressable>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.search,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.card,
              },
            ]}
          />
          <FlatList
            data={filteredRows}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onPickCountry(item.code)}
                style={[styles.listRow, item.code === country && { backgroundColor: `${accentColor}18` }]}>
                <Text style={[styles.listName, { color: colors.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.listMeta, { color: colors.textSecondary }]}>
                  {item.code} {item.dial}
                </Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  countryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    minHeight: 52,
    maxWidth: 128,
  },
  countryButtonText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 52,
    paddingHorizontal: 14,
    fontSize: 17,
    fontWeight: '600',
  },
  modalRoot: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  doneLink: {
    fontSize: 17,
    fontWeight: '700',
  },
  search: {
    marginHorizontal: 16,
    marginVertical: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  listRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  listName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  listMeta: {
    fontSize: 14,
    fontWeight: '600',
  },
});
