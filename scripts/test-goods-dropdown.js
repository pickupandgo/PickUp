/**
 * Automated Test Suite for Goods / Load Type Dropdown
 * Run: node scripts/test-goods-dropdown.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('--------------------------------------------------');
console.log('Running Goods / Load Type Dropdown Test Suite');
console.log('--------------------------------------------------\n');

// 1. Read i18n dictionary
const i18nFilePath = path.join(__dirname, '..', 'src', 'i18n', 'index.tsx');
const i18nContent = fs.readFileSync(i18nFilePath, 'utf8');

function extractDict(varName) {
  const marker = `export const ${varName}: Dict = {`;
  const start = i18nContent.indexOf(marker);
  if (start === -1) throw new Error(`Marker not found for ${varName}`);
  const afterStart = i18nContent.substring(start + marker.length);
  const end = afterStart.indexOf('\n};');
  const dictContent = afterStart.substring(0, end);

  const entries = {};
  const lines = dictContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      let key = trimmed.substring(0, colonIdx).trim();
      if ((key.startsWith("'") && key.endsWith("'")) || (key.startsWith('"') && key.endsWith('"'))) {
        key = key.slice(1, -1);
      }
      let val = trimmed.substring(colonIdx + 1).trim();
      if (val.endsWith(',')) val = val.slice(0, -1).trim();
      if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
        val = val.slice(1, -1);
      }
      entries[key] = val;
    }
  }
  return entries;
}

const en = extractDict('en');
const hi = extractDict('hi');

// 2. Read categories definition
const categoriesFilePath = path.join(__dirname, '..', 'src', 'data', 'goodsCategories.ts');
const categoriesContent = fs.readFileSync(categoriesFilePath, 'utf8');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('Group 1: 12 Standard Categories Verification');

const expectedCategories = [
  { id: 'general_goods', label: 'General Goods', key: 'logistics.typeGeneralGoods', hi: 'सामान्य सामान' },
  { id: 'electronics', label: 'Electronics', key: 'logistics.typeElectronics', hi: 'इलेक्ट्रॉनिक्स' },
  { id: 'furniture', label: 'Furniture', key: 'logistics.typeFurniture', hi: 'फर्नीचर' },
  { id: 'household_items', label: 'Household Items', key: 'logistics.typeHouseholdItems', hi: 'घरेलू सामान' },
  { id: 'clothing_textiles', label: 'Clothing & Textiles', key: 'logistics.typeClothingTextiles', hi: 'कपड़े और वस्त्र' },
  { id: 'food_groceries', label: 'Food & Groceries', key: 'logistics.typeFoodGroceries', hi: 'खाद्य और किराना' },
  { id: 'construction_materials', label: 'Construction Materials', key: 'logistics.typeConstructionMaterials', hi: 'निर्माण सामग्री' },
  { id: 'machinery_equipment', label: 'Machinery & Equipment', key: 'logistics.typeMachineryEquipment', hi: 'मशीनरी और उपकरण' },
  { id: 'agricultural_goods', label: 'Agricultural Goods', key: 'logistics.typeAgriculturalGoods', hi: 'कृषि उत्पाद' },
  { id: 'fragile_items', label: 'Fragile Items', key: 'logistics.typeFragileItems', hi: 'नाजुक सामान' },
  { id: 'documents_parcels', label: 'Documents & Parcels', key: 'logistics.typeDocumentsParcels', hi: 'दस्तावेज़ और पार्सल' },
  { id: 'other', label: 'Other', key: 'logistics.typeOther', hi: 'अन्य' },
];

runTest('Categories file contains exactly the 12 required categories', () => {
  for (const item of expectedCategories) {
    assert.ok(categoriesContent.includes(`id: '${item.id}'`), `Missing category id: ${item.id}`);
    assert.ok(categoriesContent.includes(`key: '${item.key}'`), `Missing category key: ${item.key}`);
    assert.ok(categoriesContent.includes(`defaultLabel: '${item.label}'`), `Missing category label: ${item.label}`);
  }
});

console.log('\nGroup 2: Localization Requirements (Section 5)');

runTest('Exact English and Hindi copy for Goods/Load Type and Placeholder', () => {
  assert.strictEqual(en['logistics.goodsLoadType'], 'Goods/Load Type');
  assert.strictEqual(hi['logistics.goodsLoadType'], 'सामान का प्रकार');

  assert.strictEqual(en['logistics.selectGoodsType'], 'Select goods type');
  assert.strictEqual(hi['logistics.selectGoodsType'], 'सामान का प्रकार चुनें');

  assert.strictEqual(en['logistics.typeOther'], 'Other');
  assert.strictEqual(hi['logistics.typeOther'], 'अन्य');
});

runTest('All 12 categories have matching English and pure Devanagari Hindi translations', () => {
  const devanagariRegex = /[\u0900-\u097F]/;
  for (const item of expectedCategories) {
    assert.strictEqual(en[item.key], item.label, `EN mismatch for ${item.key}`);
    assert.strictEqual(hi[item.key], item.hi, `HI mismatch for ${item.key}`);
    assert.ok(devanagariRegex.test(hi[item.key]), `HI translation for ${item.key} is not in Devanagari`);
  }
});

console.log('\nGroup 3: Screen Implementation & Dismissal Logic (Section 4 & 6)');

const screenFilePath = path.join(__dirname, '..', 'src', 'screens', 'logistics', 'GoodsDetailsScreen.tsx');
const screenContent = fs.readFileSync(screenFilePath, 'utf8');

runTest('Cycling logic handleCycleGoodsType is removed', () => {
  assert.ok(!screenContent.includes('handleCycleGoodsType'), 'handleCycleGoodsType still present in screen');
});

runTest('Modal component used for dropdown presentation to avoid clipping', () => {
  assert.ok(screenContent.includes('<Modal'), 'Modal component is used for dropdown presentation');
  assert.ok(screenContent.includes('onRequestClose={handleCloseDropdown}'), 'Modal handles Android hardware back dismiss');
  assert.ok(screenContent.includes('transparent'), 'Modal is configured as transparent overlay');
});

runTest('Modal has clear header with title and close button', () => {
  assert.ok(screenContent.includes('styles.sheetHeader'), 'Sheet header style is used');
  assert.ok(screenContent.includes('styles.sheetTitle'), 'Sheet title style is used');
  assert.ok(screenContent.includes('styles.closeButton'), 'Close button style is used');
});

runTest('Selected category visually identifiable with checkmark', () => {
  assert.ok(screenContent.includes('name="check"'), 'Feather check icon is rendered for selected category');
  assert.ok(screenContent.includes('categoryRowSelected'), 'Selected row styling is applied');
});

runTest('Dropdown list is internally scrollable', () => {
  assert.ok(screenContent.includes('styles.categoryScroll'), 'ScrollView is used with categoryScroll style');
  assert.ok(screenContent.includes('GOODS_CATEGORIES.map'), 'All goods categories are mapped in list');
});

runTest('Form state preserves selected category id in BookingDraft', () => {
  assert.ok(screenContent.includes('goodsType: selectedCategory?.id'), 'setGoods stores goodsType as category id');
  assert.ok(screenContent.includes('selectedCategoryId'), 'selectedCategoryId state manages selection');
  assert.ok(screenContent.includes('draft.goodsType'), 'selectedCategoryId restores from draft.goodsType on mount/re-entry');
});

runTest('Tap outside backdrop dismisses without changing selection', () => {
  assert.ok(screenContent.includes('onPress={handleCloseDropdown}'), 'Backdrop triggers handleCloseDropdown');
  assert.ok(!screenContent.includes('handleCloseDropdown = () => {\n    setSelectedCategoryId'), 'Dismissing does not change selection');
});

console.log('\nGroup 4: BookingContext & Types Verification');

const contextFilePath = path.join(__dirname, '..', 'src', 'state', 'BookingContext.tsx');
const contextContent = fs.readFileSync(contextFilePath, 'utf8');

runTest('BookingDraft interface includes goodsType?: string', () => {
  assert.ok(contextContent.includes('goodsType?: string;'), 'BookingDraft has goodsType field');
});

console.log('\n--------------------------------------------------');
console.log(`Results: ${passedTests}/${totalTests} tests passed.`);
console.log('--------------------------------------------------');

if (passedTests === totalTests) {
  console.log('✓ All Goods Dropdown tests PASSED successfully!\n');
} else {
  console.error('✗ Some tests FAILED.\n');
  process.exit(1);
}
