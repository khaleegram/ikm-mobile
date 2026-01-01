// Fashion category fields
import { View, Text, TextInput, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useState } from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface FashionFieldsProps {
  formData: Record<string, any>;
  onChange: (field: string, value: any) => void;
  errors: Record<string, string>;
  readOnly?: boolean;
}

const SIZE_TYPES = ['free-size', 'abaya-length', 'standard'];
const STANDARD_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const ABAYA_LENGTHS = ['52', '54', '56', '58', '60']; // in inches
const SET_INCLUDES_OPTIONS = ['dress-only', 'with-veil', '3-piece-set'];
const MATERIALS = ['soft-silk', 'stiff-cotton', 'heavy-premium'];

export function FashionFields({ formData, onChange, errors, readOnly = false }: FashionFieldsProps) {
  const { colors } = useTheme();
  const [showSizeTypePicker, setShowSizeTypePicker] = useState(false);
  const [showStandardSizePicker, setShowStandardSizePicker] = useState(false);
  const [showAbayaLengthPicker, setShowAbayaLengthPicker] = useState(false);
  const [showMaterialPicker, setShowMaterialPicker] = useState(false);
  const [showSetIncludesPicker, setShowSetIncludesPicker] = useState(false);
  const styles = createStyles(colors);

  // Format display values
  const formatSizeType = (value?: string) => {
    if (!value) return 'Not set';
    return value.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const formatValue = (value?: string) => {
    if (!value) return 'Not set';
    return value.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };


  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Fashion Details</Text>

      {/* Size Type */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>
          Size Type {!readOnly && <Text style={styles.required}>*</Text>}
        </Text>
        {readOnly ? (
          <Text style={[styles.readOnlyValue, { color: colors.text }]}>
            {formatSizeType(formData.sizeType)}
          </Text>
        ) : (
          <>
            <TouchableOpacity
              style={[
                styles.pickerButton,
                {
                  backgroundColor: colors.backgroundSecondary,
                  borderColor: errors.sizeType ? colors.error : colors.cardBorder,
                },
              ]}
              onPress={() => setShowSizeTypePicker(true)}>
              <Text style={[styles.pickerText, { color: formData.sizeType ? colors.text : colors.textSecondary }]}>
                {formData.sizeType ? formatSizeType(formData.sizeType) : 'Select size type'}
              </Text>
              <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            {errors.sizeType && (
              <Text style={[styles.errorText, { color: colors.error }]}>{errors.sizeType}</Text>
            )}
          </>
        )}
      </View>

      {/* Standard Size (if sizeType === 'standard') */}
      {(formData.sizeType === 'standard' || (readOnly && formData.standardSize)) && (
        <View style={styles.fieldContainer}>
          <Text style={[styles.label, { color: colors.text }]}>
            Standard Size {!readOnly && <Text style={styles.required}>*</Text>}
          </Text>
          {readOnly ? (
            <Text style={[styles.readOnlyValue, { color: colors.text }]}>
              {formData.standardSize || 'Not set'}
            </Text>
          ) : (
            <>
              <TouchableOpacity
                style={[
                  styles.pickerButton,
                  {
                    backgroundColor: colors.backgroundSecondary,
                    borderColor: errors.standardSize ? colors.error : colors.cardBorder,
                  },
                ]}
                onPress={() => setShowStandardSizePicker(true)}>
                <Text style={[styles.pickerText, { color: formData.standardSize ? colors.text : colors.textSecondary }]}>
                  {formData.standardSize || 'Select size'}
                </Text>
                <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              {errors.standardSize && (
                <Text style={[styles.errorText, { color: colors.error }]}>{errors.standardSize}</Text>
              )}
            </>
          )}
        </View>
      )}

      {/* Abaya Length (if sizeType === 'abaya-length') */}
      {(formData.sizeType === 'abaya-length' || (readOnly && formData.abayaLength)) && (
        <View style={styles.fieldContainer}>
          <Text style={[styles.label, { color: colors.text }]}>
            Abaya Length (inches) {!readOnly && <Text style={styles.required}>*</Text>}
          </Text>
          {readOnly ? (
            <Text style={[styles.readOnlyValue, { color: colors.text }]}>
              {formData.abayaLength ? `${formData.abayaLength} inches` : 'Not set'}
            </Text>
          ) : (
            <>
              <TouchableOpacity
                style={[
                  styles.pickerButton,
                  {
                    backgroundColor: colors.backgroundSecondary,
                    borderColor: errors.abayaLength ? colors.error : colors.cardBorder,
                  },
                ]}
                onPress={() => setShowAbayaLengthPicker(true)}>
                <Text style={[styles.pickerText, { color: formData.abayaLength ? colors.text : colors.textSecondary }]}>
                  {formData.abayaLength ? `${formData.abayaLength} inches` : 'Select length'}
                </Text>
                <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              {errors.abayaLength && (
                <Text style={[styles.errorText, { color: colors.error }]}>{errors.abayaLength}</Text>
              )}
            </>
          )}
        </View>
      )}

      {/* Material */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>
          Material {!readOnly && <Text style={styles.required}>*</Text>}
        </Text>
        {readOnly ? (
          <Text style={[styles.readOnlyValue, { color: colors.text }]}>
            {formatValue(formData.material)}
          </Text>
        ) : (
          <>
            <TouchableOpacity
              style={[
                styles.pickerButton,
                {
                  backgroundColor: colors.backgroundSecondary,
                  borderColor: errors.material ? colors.error : colors.cardBorder,
                },
              ]}
              onPress={() => setShowMaterialPicker(true)}>
              <Text style={[styles.pickerText, { color: formData.material ? colors.text : colors.textSecondary }]}>
                {formData.material ? formatValue(formData.material) : 'Select material'}
              </Text>
              <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            {errors.material && (
              <Text style={[styles.errorText, { color: colors.error }]}>{errors.material}</Text>
            )}
          </>
        )}
      </View>

      {/* Set Includes */}
      <View style={styles.fieldContainer}>
        <Text style={[styles.label, { color: colors.text }]}>
          Set Includes {!readOnly && <Text style={styles.required}>*</Text>}
        </Text>
        {readOnly ? (
          <Text style={[styles.readOnlyValue, { color: colors.text }]}>
            {formatValue(formData.setIncludes)}
          </Text>
        ) : (
          <>
            <TouchableOpacity
              style={[
                styles.pickerButton,
                {
                  backgroundColor: colors.backgroundSecondary,
                  borderColor: errors.setIncludes ? colors.error : colors.cardBorder,
                },
              ]}
              onPress={() => setShowSetIncludesPicker(true)}>
              <Text style={[styles.pickerText, { color: formData.setIncludes ? colors.text : colors.textSecondary }]}>
                {formData.setIncludes ? formatValue(formData.setIncludes) : 'Select set includes'}
              </Text>
              <IconSymbol name="chevron.down" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            {errors.setIncludes && (
              <Text style={[styles.errorText, { color: colors.error }]}>{errors.setIncludes}</Text>
            )}
          </>
        )}
      </View>

      {/* Modals - Only show if not read-only */}
      {!readOnly && (
        <>
          <PickerModal
            visible={showSizeTypePicker}
            title="Select Size Type"
            options={SIZE_TYPES.map((t) => ({ label: t.replace('-', ' '), value: t }))}
            selectedValue={formData.sizeType}
            onSelect={(value) => {
              onChange('sizeType', value);
              // Clear dependent fields when size type changes
              if (value !== 'standard') onChange('standardSize', '');
              if (value !== 'abaya-length') onChange('abayaLength', '');
              setShowSizeTypePicker(false);
            }}
            onClose={() => setShowSizeTypePicker(false)}
            colors={colors}
          />

      <PickerModal
        visible={showStandardSizePicker}
        title="Select Standard Size"
        options={STANDARD_SIZES.map((s) => ({ label: s, value: s }))}
        selectedValue={formData.standardSize}
        onSelect={(value) => {
          onChange('standardSize', value);
          setShowStandardSizePicker(false);
        }}
        onClose={() => setShowStandardSizePicker(false)}
        colors={colors}
      />

      <PickerModal
        visible={showAbayaLengthPicker}
        title="Select Abaya Length (inches)"
        options={ABAYA_LENGTHS.map((l) => ({ label: `${l} inches`, value: l }))}
        selectedValue={formData.abayaLength}
        onSelect={(value) => {
          onChange('abayaLength', value);
          setShowAbayaLengthPicker(false);
        }}
        onClose={() => setShowAbayaLengthPicker(false)}
        colors={colors}
      />

      <PickerModal
        visible={showMaterialPicker}
        title="Select Material"
        options={MATERIALS.map((m) => ({ label: m.replace('-', ' '), value: m }))}
        selectedValue={formData.material}
        onSelect={(value) => {
          onChange('material', value);
          setShowMaterialPicker(false);
        }}
        onClose={() => setShowMaterialPicker(false)}
        colors={colors}
      />

      {/* Set Includes Picker Modal */}
      <PickerModal
        visible={showSetIncludesPicker}
        title="Select Set Includes"
        options={SET_INCLUDES_OPTIONS.map((s) => ({ label: s.replace('-', ' '), value: s }))}
        selectedValue={formData.setIncludes}
        onSelect={(value) => {
          onChange('setIncludes', value);
          setShowSetIncludesPicker(false);
        }}
        onClose={() => setShowSetIncludesPicker(false)}
        colors={colors}
      />
        </>
      )}
    </View>
  );
}

// Reusable Picker Modal Component
function PickerModal({
  visible,
  title,
  options,
  selectedValue,
  onSelect,
  onClose,
  colors,
}: {
  visible: boolean;
  title: string;
  options: Array<{ label: string; value: string }>;
  selectedValue?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  colors: any;
}) {
  const styles = createStyles(colors);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{title}</Text>
            <TouchableOpacity onPress={onClose}>
              <IconSymbol name="xmark" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView>
            {options.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.modalOption,
                  {
                    backgroundColor: selectedValue === option.value ? colors.primary : colors.backgroundSecondary,
                  },
                ]}
                onPress={() => onSelect(option.value)}>
                <Text
                  style={[
                    styles.modalOptionText,
                    { color: selectedValue === option.value ? '#FFFFFF' : colors.text },
                  ]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
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
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    modalOptionText: {
      fontSize: 16,
    },
    readOnlyValue: {
      fontSize: 16,
      paddingVertical: 12,
      paddingHorizontal: 4,
    },
  });
}

