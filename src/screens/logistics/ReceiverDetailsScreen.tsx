import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import Button from '../../components/atoms/Button';

export interface ReceiverDetailsScreenProps {
  readonly dropNumber?: number;
  readonly dropAddress?: string;
  readonly onBack?: () => void;
  readonly onContinue?: (data: { name: string; phone: string; instructions: string }) => void;
}

const ReceiverDetailsScreen: React.FC<ReceiverDetailsScreenProps & { navigation?: any }> = ({
  dropNumber = 1,
  dropAddress = 'Shastri Nagar, Jodhpur',
  onBack,
  onContinue,
  navigation,
}) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [instructions, setInstructions] = useState('');

  const handleContinue = () => {
    if (name && phone.length >= 10) {
      onContinue?.({ name, phone, instructions });
    }
  };

  const isContinueDisabled = !name || phone.length < 10;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
          accessibilityRole="button"
        >
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Delivery</Text>
        <View style={styles.iconButton} />
      </View>

      <KeyboardAvoidingView 
        style={styles.keyboardAvoid} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          
          {/* Destination Header */}
          <View style={styles.destinationCard}>
            <View style={styles.locationIconCircle}>
              <MaterialIcons name="location-on" size={20} color={colors.onSecondaryContainer} />
            </View>
            <View style={styles.destinationTextContainer}>
              <Text style={styles.dropLabel}>DROP {dropNumber}</Text>
              <Text style={styles.dropAddress}>{dropAddress}</Text>
            </View>
          </View>

          {/* Form Section */}
          <View style={styles.formSection}>
            <Text style={styles.formTitle}>Who is receiving the goods?</Text>

            {/* Input 1 (Name) */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>RECEIVER NAME</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Enter name"
                placeholderTextColor={colors.outlineVariant}
                value={name}
                onChangeText={setName}
              />
            </View>

            {/* Input 2 (Contact) */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>MOBILE NUMBER</Text>
              <View style={styles.phoneInputContainer}>
                <Text style={styles.phonePrefix}>+91</Text>
                <TextInput
                  style={styles.phoneInput}
                  placeholder="Enter 10-digit number"
                  placeholderTextColor={colors.outlineVariant}
                  keyboardType="phone-pad"
                  maxLength={10}
                  value={phone}
                  onChangeText={setPhone}
                />
              </View>
            </View>

            {/* Input 3 (Instructions) */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>DELIVERY INSTRUCTIONS (OPTIONAL)</Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                placeholder="e.g. Near the blue gate, 2nd floor..."
                placeholderTextColor={colors.outlineVariant}
                multiline
                numberOfLines={3}
                value={instructions}
                onChangeText={setInstructions}
                textAlignVertical="top"
              />
            </View>
          </View>

        </ScrollView>

        <View style={styles.footer}>
          <Button
            label="CONTINUE"
            onPress={() => {
              handleContinue();
              navigation?.navigate('FareEstimateScreen');
            }}
            variant="primary"
            disabled={isContinueDisabled}
            fullWidth
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoid: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl,
  },
  destinationCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surfaceContainerLow,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
  },
  locationIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  destinationTextContainer: {
    flex: 1,
  },
  dropLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.secondary,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
    marginBottom: 4,
  },
  dropAddress: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  formSection: {
    gap: spacing.lg,
  },
  formTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: spacing.xs,
  },
  inputGroup: {
    gap: spacing.xs,
  },
  inputLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  textInput: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
  },
  phoneInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  phonePrefix: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyLg.fontFamily,
    borderRightWidth: 1,
    borderRightColor: colors.outlineVariant + '4D', // 30% opacity
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
  },
  textArea: {
    minHeight: 100,
  },
  footer: {
    padding: spacing.marginMobile,
    backgroundColor: colors.surfaceContainerLowest + 'CC', // 80% opacity
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerHighest,
  },
});

export default ReceiverDetailsScreen;
