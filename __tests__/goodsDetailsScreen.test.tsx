import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import GoodsDetailsScreen, {
  GOODS_CATEGORIES,
  isValidWeight,
  isValidDeclaredValue,
  isValidDescription,
  isValidGoodsType,
} from '../src/screens/logistics/GoodsDetailsScreen';
import { BookingContext } from '../src/state/BookingContext';

describe('GoodsDetailsScreen — Unit & Integration Tests', () => {
  const mockNavigate = jest.fn();
  const mockGoBack = jest.fn();
  const mockSetGoods = jest.fn();
  const mockOnContinue = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const queryAllByTestId = (renderer: ReactTestRenderer, testID: string): any[] =>
    (renderer.root as any).findAll((node: any) => node.props?.testID === testID);

  const renderScreen = (customDraft: any = {}, customProps: any = {}): ReactTestRenderer => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <BookingContext.Provider
          value={{
            customerId: 'user-123',
            draft: { drops: [], ...customDraft },
            primaryDrop: undefined,
            canEstimate: false,
            setPickup: jest.fn(),
            setPendingDrop: jest.fn(),
            commitPendingDrop: jest.fn(),
            addDrop: jest.fn(),
            replaceDrop: jest.fn(),
            removeDrop: jest.fn(),
            setVehicleType: jest.fn(),
            setGoods: mockSetGoods,
            setInsured: jest.fn(),
            setSender: jest.fn(),
            setReceiver: jest.fn(),
            setQuote: jest.fn(),
            setPaymentMethod: jest.fn(),
            resetDraft: jest.fn(),
            startNewBooking: jest.fn(),
            ride: undefined,
            trip: undefined,
            assignedDriver: undefined,
            setRide: jest.fn(),
            setTrip: jest.fn(),
            setAssignedDriver: jest.fn(),
            clearActiveRide: jest.fn(),
          }}
        >
          <GoodsDetailsScreen
            navigation={{ navigate: mockNavigate, goBack: mockGoBack }}
            onContinue={mockOnContinue}
            {...customProps}
          />
        </BookingContext.Provider>
      );
    });
    return renderer;
  };

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Validator Functions
  // ───────────────────────────────────────────────────────────────────────────
  describe('Field validation helper functions', () => {
    it('validates goods type against supported categories', () => {
      expect(isValidGoodsType('Furniture')).toBe(true);
      expect(isValidGoodsType('Electronics')).toBe(true);
      expect(isValidGoodsType('Household Goods')).toBe(true);
      expect(isValidGoodsType('Construction Materials')).toBe(true);
      expect(isValidGoodsType('Commercial Goods')).toBe(true);
      expect(isValidGoodsType('Other')).toBe(true);
      expect(isValidGoodsType('')).toBe(false);
      expect(isValidGoodsType('Invalid Category')).toBe(false);
    });

    it('validates description (rejects empty and whitespace-only)', () => {
      expect(isValidDescription('3 boxes of books')).toBe(true);
      expect(isValidDescription('   ')).toBe(false);
      expect(isValidDescription('')).toBe(false);
    });

    it('validates weight (accepts positive numbers, rejects 0, negatives, and non-numeric)', () => {
      expect(isValidWeight('10')).toBe(true);
      expect(isValidWeight('25.5')).toBe(true);
      expect(isValidWeight('0.5')).toBe(true);
      expect(isValidWeight('0')).toBe(false);
      expect(isValidWeight('0.00')).toBe(false);
      expect(isValidWeight('-5')).toBe(false);
      expect(isValidWeight('abc')).toBe(false);
      expect(isValidWeight('10.5.2')).toBe(false);
      expect(isValidWeight('')).toBe(false);
    });

    it('validates declared value (accepts strictly positive numbers, rejects 0, negatives, and non-numeric)', () => {
      expect(isValidDeclaredValue('0')).toBe(false);
      expect(isValidDeclaredValue('0.00')).toBe(false);
      expect(isValidDeclaredValue('5000')).toBe(true);
      expect(isValidDeclaredValue('50,000')).toBe(true);
      expect(isValidDeclaredValue('1250.75')).toBe(true);
      expect(isValidDeclaredValue('-100')).toBe(false);
      expect(isValidDeclaredValue('abc')).toBe(false);
      expect(isValidDeclaredValue('')).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Functional Dropdown
  // ───────────────────────────────────────────────────────────────────────────
  describe('Goods/Load Type — Functional Dropdown', () => {
    it('opens dropdown menu modal when tapped and shows all supported categories', () => {
      const renderer = renderScreen();
      const selector = (renderer.root as any).findByProps({ testID: 'goods-type-selector' });

      // Initially closed
      expect(queryAllByTestId(renderer, 'goods-type-dropdown-menu').length).toBe(0);

      // Tap to open
      act(() => {
        selector.props.onPress();
      });

      const dropdown = (renderer.root as any).findByProps({ testID: 'goods-type-dropdown-menu' });
      expect(dropdown).toBeDefined();

      // Check all categories are present
      for (const cat of GOODS_CATEGORIES) {
        const optionTestId = `goods-type-option-${cat.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
        const option = (renderer.root as any).findByProps({ testID: optionTestId });
        expect(option).toBeDefined();
      }
    });

    it('selects an option, closes dropdown modal, and updates display field', () => {
      const renderer = renderScreen();
      const selector = (renderer.root as any).findByProps({ testID: 'goods-type-selector' });

      // Open dropdown
      act(() => {
        selector.props.onPress();
      });

      // Select 'Construction Materials'
      const optionTestId = 'goods-type-option-construction-materials';
      const option = (renderer.root as any).findByProps({ testID: optionTestId });
      act(() => {
        option.props.onPress();
      });

      // Dropdown should be closed
      expect(queryAllByTestId(renderer, 'goods-type-dropdown-menu').length).toBe(0);

      // Selector text should now display 'Construction Materials'
      const selectorTexts = selector.findAllByType(Text).map((t: any) => t.props.children).flat().join(' ');
      expect(selectorTexts).toContain('Construction Materials');
    });

    it('toggles dropdown closed when tapped again', () => {
      const renderer = renderScreen();
      const selector = (renderer.root as any).findByProps({ testID: 'goods-type-selector' });

      // Open
      act(() => {
        selector.props.onPress();
      });
      expect(queryAllByTestId(renderer, 'goods-type-dropdown-menu').length).toBeGreaterThanOrEqual(1);

      // Close
      act(() => {
        selector.props.onPress();
      });
      expect(queryAllByTestId(renderer, 'goods-type-dropdown-menu').length).toBe(0);
    });

    it('dismisses dropdown when backdrop is tapped without selecting', () => {
      const renderer = renderScreen();
      const selector = (renderer.root as any).findByProps({ testID: 'goods-type-selector' });

      // Open
      act(() => {
        selector.props.onPress();
      });
      expect(queryAllByTestId(renderer, 'goods-type-dropdown-menu').length).toBeGreaterThanOrEqual(1);

      // Tap backdrop
      const backdrop = (renderer.root as any).findByProps({ testID: 'goods-type-dropdown-backdrop' });
      act(() => {
        backdrop.props.onPress();
      });

      // Closed without selecting
      expect(queryAllByTestId(renderer, 'goods-type-dropdown-menu').length).toBe(0);
    });

    it('dismisses dropdown when header close button is pressed', () => {
      const renderer = renderScreen();
      const selector = (renderer.root as any).findByProps({ testID: 'goods-type-selector' });

      act(() => {
        selector.props.onPress();
      });
      expect(queryAllByTestId(renderer, 'goods-type-dropdown-menu').length).toBeGreaterThanOrEqual(1);

      const closeBtn = (renderer.root as any).findByProps({ testID: 'goods-type-close-button' });
      act(() => {
        closeBtn.props.onPress();
      });
      expect(queryAllByTestId(renderer, 'goods-type-dropdown-menu').length).toBe(0);
    });

    it('dismisses dropdown on Android back button request', () => {
      const renderer = renderScreen();
      const selector = (renderer.root as any).findByProps({ testID: 'goods-type-selector' });

      act(() => {
        selector.props.onPress();
      });
      expect(queryAllByTestId(renderer, 'goods-type-dropdown-menu').length).toBeGreaterThanOrEqual(1);

      const modal = (renderer.root as any).findByProps({ testID: 'goods-type-dropdown-modal' });
      act(() => {
        modal.props.onRequestClose();
      });
      expect(queryAllByTestId(renderer, 'goods-type-dropdown-menu').length).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2b. Declared Goods Value Placeholder & Validation
  // ───────────────────────────────────────────────────────────────────────────
  describe('Declared Goods Value — Placeholder and Validation', () => {
    it('starts empty with ₹ prefix and 0.00 grey placeholder, not prefilled', () => {
      const renderer = renderScreen();
      const valInput = (renderer.root as any).findByProps({ testID: 'input-declared-value' });

      // Value must start empty
      expect(valInput.props.value).toBe('');
      // Placeholder must be 0.00
      expect(valInput.props.placeholder).toBe('0.00');

      // Prefix ₹ is rendered
      const prefix = (renderer.root as any).findByProps({ testID: 'currency-prefix' });
      expect(prefix.props.children).toBe('₹');
    });

    it('clears declared value error when a positive value is entered', () => {
      const renderer = renderScreen();

      // Trigger error via continue press
      const continueBtn = (renderer.root as any).findByProps({ testID: 'goods-details-continue-button' });
      act(() => {
        continueBtn.props.onPress();
      });

      // Declared value error should be shown
      expect((renderer.root as any).findByProps({ testID: 'error-declared-value' })).toBeDefined();

      // Enter valid positive value
      const valInput = (renderer.root as any).findByProps({ testID: 'input-declared-value' });
      act(() => {
        valInput.props.onChangeText('2500');
      });

      // Error must be cleared immediately
      expect(queryAllByTestId(renderer, 'error-declared-value').length).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Approximate Weight Validation & Real-time Error Handling
  // ───────────────────────────────────────────────────────────────────────────
  describe('Approximate Weight — Real-time Validation & Unit Toggle', () => {
    it('does not display weight error initially before user interaction', () => {
      const renderer = renderScreen();
      expect(queryAllByTestId(renderer, 'error-weight').length).toBe(0);

      const weightInput = (renderer.root as any).findByProps({ testID: 'input-approximate-weight' });
      // Should not have inputError style initially
      const styleArray = [weightInput.props.style].flat();
      const hasErrorStyle = styleArray.some((s: any) => s && s.borderColor === '#BA1A1A');
      expect(hasErrorStyle).toBe(false);
    });

    it('clears weight error immediately when user enters a valid weight', () => {
      const renderer = renderScreen();

      // Attempt submit with empty form to trigger error hints
      const continueBtn = (renderer.root as any).findByProps({ testID: 'goods-details-continue-button' });
      act(() => {
        continueBtn.props.onPress();
      });

      // Error message is displayed
      let weightError = (renderer.root as any).findByProps({ testID: 'error-weight' });
      expect(weightError.props.children).toContain('Weight is required for accurate pricing.');

      // Enter valid weight
      const weightInput = (renderer.root as any).findByProps({ testID: 'input-approximate-weight' });
      act(() => {
        weightInput.props.onChangeText('15.5');
      });

      // Error must be cleared immediately
      expect(queryAllByTestId(renderer, 'error-weight').length).toBe(0);
    });

    it('displays error when invalid non-positive or non-numeric weight is entered after error was triggered', () => {
      const renderer = renderScreen();

      // Trigger validation errors
      const continueBtn = (renderer.root as any).findByProps({ testID: 'goods-details-continue-button' });
      act(() => {
        continueBtn.props.onPress();
      });

      const weightInput = (renderer.root as any).findByProps({ testID: 'input-approximate-weight' });

      // Enter 0
      act(() => {
        weightInput.props.onChangeText('0');
      });
      let weightError = (renderer.root as any).findByProps({ testID: 'error-weight' });
      expect(weightError.props.children).toContain('Weight must be greater than zero.');

      // Enter non-numeric
      act(() => {
        weightInput.props.onChangeText('abc');
      });
      weightError = (renderer.root as any).findByProps({ testID: 'error-weight' });
      expect(weightError.props.children).toContain('Please enter a valid numeric weight.');
    });

    it('switches between kg and lbs units seamlessly without modifying entered text', () => {
      const renderer = renderScreen();
      const weightInput = (renderer.root as any).findByProps({ testID: 'input-approximate-weight' });
      const toggleKg = (renderer.root as any).findByProps({ testID: 'unit-toggle-kg' });
      const toggleLbs = (renderer.root as any).findByProps({ testID: 'unit-toggle-lbs' });

      act(() => {
        weightInput.props.onChangeText('50');
      });

      // Default is kg
      expect(toggleKg.props.accessibilityState.selected).toBe(true);

      // Switch to lbs
      act(() => {
        toggleLbs.props.onPress();
      });
      expect(toggleLbs.props.accessibilityState.selected).toBe(true);
      expect(weightInput.props.value).toBe('50');

      // Switch back to kg
      act(() => {
        toggleKg.props.onPress();
      });
      expect(toggleKg.props.accessibilityState.selected).toBe(true);
      expect(weightInput.props.value).toBe('50');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Required Fields & Continue Button Disabling
  // ───────────────────────────────────────────────────────────────────────────
  describe('Required Fields & Continue Button State', () => {
    it('keeps Continue button disabled when any of the 4 required fields is missing', () => {
      const renderer = renderScreen();
      const continueBtn = (renderer.root as any).findByProps({ testID: 'goods-details-continue-button' });

      // 1. All empty: disabled
      expect(continueBtn.props.accessibilityState.disabled).toBe(true);

      // 2. Select Type only: still disabled
      const selector = (renderer.root as any).findByProps({ testID: 'goods-type-selector' });
      act(() => {
        selector.props.onPress();
      });
      const optionFurniture = (renderer.root as any).findByProps({ testID: 'goods-type-option-furniture' });
      act(() => {
        optionFurniture.props.onPress();
      });
      expect(continueBtn.props.accessibilityState.disabled).toBe(true);

      // 3. Enter Description: still disabled
      const descInput = (renderer.root as any).findByProps({ testID: 'input-goods-description' });
      act(() => {
        descInput.props.onChangeText('Solid wood dining table and 4 chairs');
      });
      expect(continueBtn.props.accessibilityState.disabled).toBe(true);

      // 4. Enter Weight: still disabled (declared value missing)
      const weightInput = (renderer.root as any).findByProps({ testID: 'input-approximate-weight' });
      act(() => {
        weightInput.props.onChangeText('45');
      });
      expect(continueBtn.props.accessibilityState.disabled).toBe(true);

      // 5. Enter Declared Value (must be positive > 0): entering '0' keeps disabled, entering '5000' enables!
      const valInput = (renderer.root as any).findByProps({ testID: 'input-declared-value' });
      act(() => {
        valInput.props.onChangeText('0');
      });
      expect(continueBtn.props.accessibilityState.disabled).toBe(true);

      act(() => {
        valInput.props.onChangeText('5000');
      });
      expect(continueBtn.props.accessibilityState.disabled).toBe(false);
    });

    it('rejects whitespace-only description and disables Continue', () => {
      const renderer = renderScreen();
      const continueBtn = (renderer.root as any).findByProps({ testID: 'goods-details-continue-button' });
      const selector = (renderer.root as any).findByProps({ testID: 'goods-type-selector' });
      act(() => {
        selector.props.onPress();
      });
      act(() => {
        (renderer.root as any).findByProps({ testID: 'goods-type-option-electronics' }).props.onPress();
      });

      const descInput = (renderer.root as any).findByProps({ testID: 'input-goods-description' });
      act(() => {
        descInput.props.onChangeText('     ');
      });

      const weightInput = (renderer.root as any).findByProps({ testID: 'input-approximate-weight' });
      act(() => {
        weightInput.props.onChangeText('10');
      });

      const valInput = (renderer.root as any).findByProps({ testID: 'input-declared-value' });
      act(() => {
        valInput.props.onChangeText('15000');
      });

      // Whitespace-only description must keep button disabled
      expect(continueBtn.props.accessibilityState.disabled).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Submission & Data Integrity
  // ───────────────────────────────────────────────────────────────────────────
  describe('Form Submission & Navigation Flow', () => {
    it('submits form with normalized kg weight when unit is kg', () => {
      const renderer = renderScreen();
      const continueBtn = (renderer.root as any).findByProps({ testID: 'goods-details-continue-button' });

      // Fill in all required fields
      const selector = (renderer.root as any).findByProps({ testID: 'goods-type-selector' });
      act(() => {
        selector.props.onPress();
      });
      act(() => {
        (renderer.root as any).findByProps({ testID: 'goods-type-option-commercial-goods' }).props.onPress();
      });

      const descInput = (renderer.root as any).findByProps({ testID: 'input-goods-description' });
      act(() => {
        descInput.props.onChangeText('  Cartons of stationery goods  ');
      });

      const weightInput = (renderer.root as any).findByProps({ testID: 'input-approximate-weight' });
      act(() => {
        weightInput.props.onChangeText('25');
      });

      const valInput = (renderer.root as any).findByProps({ testID: 'input-declared-value' });
      act(() => {
        valInput.props.onChangeText('20,000');
      });

      const instrInput = (renderer.root as any).findByProps({ testID: 'input-special-instructions' });
      act(() => {
        instrInput.props.onChangeText('Handle with care');
      });

      // Submit
      act(() => {
        continueBtn.props.onPress();
      });

      expect(mockSetGoods).toHaveBeenCalledWith({
        weightKg: 25,
        goodsDescription: 'Cartons of stationery goods',
        declaredValue: '20000',
        goodsType: 'Commercial Goods',
        weightUnit: 'kg',
        specialInstructions: 'Handle with care',
      });

      expect(mockOnContinue).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('GoodsInsuranceScreen');
    });

    it('converts weight to canonical kilograms when unit is lbs on submission', () => {
      const renderer = renderScreen();
      const continueBtn = (renderer.root as any).findByProps({ testID: 'goods-details-continue-button' });

      // Select type
      const selector = (renderer.root as any).findByProps({ testID: 'goods-type-selector' });
      act(() => {
        selector.props.onPress();
      });
      act(() => {
        (renderer.root as any).findByProps({ testID: 'goods-type-option-other' }).props.onPress();
      });

      // Description
      act(() => {
        (renderer.root as any).findByProps({ testID: 'input-goods-description' }).props.onChangeText('Machine spare parts');
      });

      // Weight & lbs
      act(() => {
        (renderer.root as any).findByProps({ testID: 'input-approximate-weight' }).props.onChangeText('100');
      });
      act(() => {
        (renderer.root as any).findByProps({ testID: 'unit-toggle-lbs' }).props.onPress();
      });

      // Declared value
      act(() => {
        (renderer.root as any).findByProps({ testID: 'input-declared-value' }).props.onChangeText('5000');
      });

      // Submit
      act(() => {
        continueBtn.props.onPress();
      });

      // 100 lbs * 0.45359237 = 45.359 kg
      expect(mockSetGoods).toHaveBeenCalledWith(
        expect.objectContaining({
          weightKg: 45.359,
          weightUnit: 'lbs',
          goodsType: 'Other',
        })
      );
      expect(mockNavigate).toHaveBeenCalledWith('GoodsInsuranceScreen');
    });

    it('allows optional Special Instructions to be omitted', () => {
      const renderer = renderScreen();
      const continueBtn = (renderer.root as any).findByProps({ testID: 'goods-details-continue-button' });

      const selector = (renderer.root as any).findByProps({ testID: 'goods-type-selector' });
      act(() => {
        selector.props.onPress();
      });
      act(() => {
        (renderer.root as any).findByProps({ testID: 'goods-type-option-household-goods' }).props.onPress();
      });

      act(() => {
        (renderer.root as any).findByProps({ testID: 'input-goods-description' }).props.onChangeText('Clothes and utensils');
      });
      act(() => {
        (renderer.root as any).findByProps({ testID: 'input-approximate-weight' }).props.onChangeText('30');
      });
      act(() => {
        (renderer.root as any).findByProps({ testID: 'input-declared-value' }).props.onChangeText('10000');
      });

      // No special instructions entered
      act(() => {
        continueBtn.props.onPress();
      });

      expect(mockSetGoods).toHaveBeenCalledWith(
        expect.objectContaining({
          specialInstructions: undefined,
        })
      );
      expect(mockNavigate).toHaveBeenCalledWith('GoodsInsuranceScreen');
    });

    it('hydrates initial field state from BookingContext draft', () => {
      const renderer = renderScreen({
        goodsType: 'Electronics',
        goodsDescription: 'Television 55-inch in original packing',
        weightKg: 18,
        weightUnit: 'kg',
        declaredValue: '45000',
        specialInstructions: 'Fragile: do not stack',
      });

      const selector = (renderer.root as any).findByProps({ testID: 'goods-type-selector' });
      const selectorTexts = selector.findAllByType(Text).map((t: any) => t.props.children).flat().join(' ');
      expect(selectorTexts).toContain('Electronics');

      const descInput = (renderer.root as any).findByProps({ testID: 'input-goods-description' });
      expect(descInput.props.value).toBe('Television 55-inch in original packing');

      const weightInput = (renderer.root as any).findByProps({ testID: 'input-approximate-weight' });
      expect(weightInput.props.value).toBe('18');

      const valInput = (renderer.root as any).findByProps({ testID: 'input-declared-value' });
      expect(valInput.props.value).toBe('45000');

      const instrInput = (renderer.root as any).findByProps({ testID: 'input-special-instructions' });
      expect(instrInput.props.value).toBe('Fragile: do not stack');

      // Continue button should be enabled immediately since all 4 fields are valid
      const continueBtn = (renderer.root as any).findByProps({ testID: 'goods-details-continue-button' });
      expect(continueBtn.props.accessibilityState.disabled).toBe(false);
    });
  });
});
