// Fragrance category fields
import { View, Text, TextInput, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useState } from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface FragranceFieldsProps {
  formData: Record<string, any>;
  onChange: (field: string, value: any) => void;
  errors: Record<string, string>;
}

const FRAGRANCE_TYPES = [
  'oil-based',
  'spray',
  'incense',
];

const CONTAINER_TYPES = [
  'pocket-size',
  'standard-bottle',
  'refill-unboxed',
];

const VOLUME_OPTIONS = [
  '3ml',
  '6ml',
  '12ml',
  '30ml',
  '50ml',
  '100ml',
  'other',
];

export function FragranceFields({ formData, onChange, errors }: FragranceFieldsProps) {
  const { colors } = useTheme();
  const [showVolumePicker, setShowVolumePicker] = useState(false);
  const [showFragranceTypePicker, setShowFragranceTypePicker] = useState(false);
  const [showContainerPicker, setShowContainerPicker] = useState(false);
  const [customVolume, setCustomVolume] = useState('');
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Fragrance Details</Text>

      {/* Volume */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>
          Volume <Text style={styles.required}>*</Text>
        </Text>
        <TouchableOpacity
          style={[
            styles.pickerButton,
            {
              backgroundColor: colors.backgroundSecondary,
              borderColor: errors.volume ? colors.error : colors.cardBorder,
            },
          ]}
          onPress={() => setShowVolumePicker(true)}>
          <Text style={[styles.pickerText, { color: formData.volume ? colors.text : colors.textSecondary }]}>
            {formData.volume || 'Select volume'}
          </Text>
          <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        {formData.volume === 'other' && (
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.backgroundSecondary,
                borderColor: errors.volume ? colors.error : colors.cardBorder,
                color: colors.text,
                marginTop: 8,
              },
            ]}
            placeholder="Enter custom volume"
            placeholderTextColor={colors.textSecondary}
            value={customVolume}
            onChangeText={(value) => {
              setCustomVolume(value);
              onChange('volume', value);
            }}
          />
        )}
        {errors.volume && (
          <Text style={[styles.errorText, { color: colors.error }]}>{errors.volume}</Text>
        )}
      </View>

      {/* Fragrance Type */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>
          Fragrance Type <Text style={styles.required}>*</Text>
        </Text>
        <TouchableOpacity
          style={[
            styles.pickerButton,
            {
              backgroundColor: colors.backgroundSecondary,
              borderColor: errors.fragranceType ? colors.error : colors.cardBorder,
            },
          ]}
          onPress={() => setShowFragranceTypePicker(true)}>
          <Text style={[styles.pickerText, { color: formData.fragranceType ? colors.text : colors.textSecondary }]}>
            {formData.fragranceType || 'Select fragrance type'}
          </Text>
          <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        {errors.fragranceType && (
          <Text style={[styles.errorText, { color: colors.error }]}>{errors.fragranceType}</Text>
        )}
      </View>

      {/* Container */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>
          Container <Text style={styles.required}>*</Text>
        </Text>
        <TouchableOpacity
          style={[
            styles.pickerButton,
            {
              backgroundColor: colors.backgroundSecondary,
              borderColor: errors.container ? colors.error : colors.cardBorder,
            },
          ]}
          onPress={() => setShowContainerPicker(true)}>
          <Text style={[styles.pickerText, { color: formData.container ? colors.text : colors.textSecondary }]}>
            {formData.container || 'Select container'}
          </Text>
          <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        {errors.container && (
          <Text style={[styles.errorText, { color: colors.error }]}>{errors.container}</Text>
        )}
      </View>

      {/* Volume Picker Modal */}
      <Modal
        visible={showVolumePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowVolumePicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Select Volume</Text>
              <TouchableOpacity onPress={() => setShowVolumePicker(false)}>
                <IconSymbol name="xmark" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              {VOLUME_OPTIONS.map((volume) => (
                <TouchableOpacity
                  key={volume}
                  style={[
                    styles.modalOption,
                    {
                      backgroundColor: formData.volume === volume ? colors.primary : colors.backgroundSecondary,
                    },
                  ]}
                  onPress={() => {
                    onChange('volume', volume);
                    setShowVolumePicker(false);
                    if (volume !== 'other') {
                      setCustomVolume('');
                    }
                  }}
                  activeOpacity={0.7}>
                  <Text
                    style={[
                      styles.modalOptionText,
                      { color: formData.volume === volume ? '#FFFFFF' : colors.text },
                    ]}>
                    {volume}
                  </Text>
                  {formData.volume === volume && (
                    <IconSymbol name="checkmark" size={20} color="#FFFFFF" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Fragrance Type Picker Modal */}
      <Modal
        visible={showFragranceTypePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFragranceTypePicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Select Fragrance Type</Text>
              <TouchableOpacity onPress={() => setShowFragranceTypePicker(false)}>
                <IconSymbol name="xmark" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              {FRAGRANCE_TYPES.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.modalOption,
                    {
                      backgroundColor: formData.fragranceType === type ? colors.primary : colors.backgroundSecondary,
                    },
                  ]}
                  onPress={() => {
                    onChange('fragranceType', type);
                    setShowFragranceTypePicker(false);
                  }}
                  activeOpacity={0.7}>
                  <Text
                    style={[
                      styles.modalOptionText,
                      { color: formData.fragranceType === type ? '#FFFFFF' : colors.text },
                    ]}>
                    {type}
                  </Text>
                  {formData.fragranceType === type && (
                    <IconSymbol name="checkmark" size={20} color="#FFFFFF" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Container Picker Modal */}
      <Modal
        visible={showContainerPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowContainerPicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Select Container</Text>
              <TouchableOpacity onPress={() => setShowContainerPicker(false)}>
                <IconSymbol name="xmark" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              {CONTAINER_TYPES.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.modalOption,
                    {
                      backgroundColor: formData.container === type ? colors.primary : colors.backgroundSecondary,
                    },
                  ]}
                  onPress={() => {
                    onChange('container', type);
                    setShowContainerPicker(false);
                  }}
                  activeOpacity={0.7}>
                  <Text
                    style={[
                      styles.modalOptionText,
                      { color: formData.container === type ? '#FFFFFF' : colors.text },
                    ]}>
                    {type}
                  </Text>
                  {formData.container === type && (
                    <IconSymbol name="checkmark" size={20} color="#FFFFFF" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function createStyles(colors: any) {
  return StyleSheet.create({
    container: {
      marginTop: 16,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 16,
    },
    fieldContainer: {
      marginBottom: 16,
    },
    label: {
      fontSize: 14,
      fontWeight: '500',
      marginBottom: 8,
    },
    required: {
      color: '#DC3545',
    },
    input: {
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      fontSize: 16,
    },
    pickerButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
    },
    pickerText: {
      fontSize: 16,
    },
    errorText: {
      fontSize: 12,
      marginTop: 4,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
      maxHeight: '70%',
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '600',
    },
    modalOption: {
      padding: 16,
      borderRadius: 8,
      marginBottom: 8,
    },
    modalOptionText: {
      fontSize: 16,
    },
  });
}

