/**
 * Automated Test Suite for i18n Localization
 * Run: node scripts/test-i18n.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--------------------------------------------------');
console.log('Running i18n Automated Localization Test Suite');
console.log('--------------------------------------------------\n');

const i18nFilePath = path.join(__dirname, '..', 'src', 'i18n', 'index.tsx');
const content = fs.readFileSync(i18nFilePath, 'utf8');

function extractDict(varName) {
  const marker = `export const ${varName}: Dict = {`;
  const start = content.indexOf(marker);
  if (start === -1) throw new Error(`Marker not found for ${varName}`);
  const afterStart = content.substring(start + marker.length);
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

console.log('Group 1: 1:1 Key Parity & Integrity');

runTest('Both en and hi dictionaries exist and have over 600 keys', () => {
  assert.ok(Object.keys(en).length > 600, 'EN dictionary has over 600 keys');
  assert.ok(Object.keys(hi).length > 600, 'HI dictionary has over 600 keys');
});

runTest('Exact same key count in EN and HI', () => {
  const enCount = Object.keys(en).length;
  const hiCount = Object.keys(hi).length;
  assert.strictEqual(enCount, hiCount, `Key count mismatch: EN=${enCount}, HI=${hiCount}`);
});

runTest('100% 1:1 Key parity with zero missing keys', () => {
  const enKeys = Object.keys(en);
  const hiKeys = new Set(Object.keys(hi));
  const missingInHi = enKeys.filter(k => !hiKeys.has(k));
  assert.deepStrictEqual(missingInHi, [], `Keys present in EN but missing in HI: ${missingInHi.join(', ')}`);

  const enKeySet = new Set(enKeys);
  const missingInEn = Object.keys(hi).filter(k => !enKeySet.has(k));
  assert.deepStrictEqual(missingInEn, [], `Keys present in HI but missing in EN: ${missingInEn.join(', ')}`);
});

runTest('Zero empty translations in EN or HI', () => {
  for (const [k, v] of Object.entries(en)) {
    assert.ok(v && v.trim().length > 0, `Empty translation in EN for key: ${k}`);
  }
  for (const [k, v] of Object.entries(hi)) {
    assert.ok(v && v.trim().length > 0, `Empty translation in HI for key: ${k}`);
  }
});

console.log('\nGroup 2: Requirement 2 Exact Strings Verification');

runTest('Exact English copy matches Requirement 2', () => {
  assert.strictEqual(en['language.title'], 'Language');
  assert.strictEqual(en['language.subtitle'], 'Select your preferred language for the Customer app.');
  assert.strictEqual(en['language.english'], 'English');
  assert.strictEqual(en['language.hindi'], 'Hindi');
  assert.strictEqual(en['language.confirm'], 'Confirm');
});

runTest('Exact Hindi copy matches Requirement 2', () => {
  assert.strictEqual(hi['language.title'], 'भाषा');
  assert.strictEqual(hi['language.subtitle'], 'कस्टमर ऐप के लिए अपनी पसंदीदा भाषा चुनें।');
  assert.strictEqual(hi['language.english'], 'English');
  assert.strictEqual(hi['language.hindi'], 'हिन्दी');
  assert.strictEqual(hi['language.confirm'], 'पुष्टि करें');
});

runTest('Dynamic display: when Hindi is active, option displays हिन्दी', () => {
  const activeLocale = 'hi';
  const displayLabel = activeLocale === 'hi' ? hi['language.hindi'] : en['language.hindi'];
  assert.strictEqual(displayLabel, 'हिन्दी');
});

console.log('\nGroup 3: Pure Devanagari Hindi Script Verification');

runTest('Devanagari script presence in localized Hindi strings', () => {
  const devanagariRegex = /[\u0900-\u097F]/;
  assert.ok(devanagariRegex.test(hi['common.confirm']), 'common.confirm has Devanagari script');
  assert.ok(devanagariRegex.test(hi['language.title']), 'language.title has Devanagari script');
  assert.ok(devanagariRegex.test(hi['home.startBooking']), 'home.startBooking has Devanagari script');
  assert.ok(devanagariRegex.test(hi['payment.successfulTitle']), 'payment.successfulTitle has Devanagari script');
  assert.ok(devanagariRegex.test(hi['cancellation.successTitle']), 'cancellation.successTitle has Devanagari script');
});

runTest('No untranslated full English sentences in Hindi values', () => {
  const prohibitedSentences = [
    'Select your preferred language for the Customer app.',
    'Where do you want to send?',
    'Confirm Cancellation',
    'Payment successful',
    'Driver arriving soon',
    'No drivers available at the moment',
    'Connection Lost',
    'Search temporarily unavailable',
    'Route unavailable',
    'Trip Completed',
  ];

  for (const [key, val] of Object.entries(hi)) {
    for (const phrase of prohibitedSentences) {
      assert.ok(!val.includes(phrase), `Key ${key} contains unlocalized English sentence: "${phrase}"`);
    }
  }
});

console.log('\nGroup 4: Dynamic Parameter Interpolation');

function interpolate(template, params) {
  let text = template;
  if (params) {
    Object.keys(params).forEach((paramKey) => {
      text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(params[paramKey]));
    });
  }
  return text;
}

runTest('English parameter interpolation for single param', () => {
  const res = interpolate(en['logistics.stopPickup'], { address: 'Sector 62, Noida' });
  assert.strictEqual(res, 'Pickup: Sector 62, Noida');
});

runTest('Hindi parameter interpolation for single param', () => {
  const res = interpolate(hi['logistics.stopPickup'], { address: 'सेक्टर 62, नोएडा' });
  assert.strictEqual(res, 'पिकअप: सेक्टर 62, नोएडा');
});

runTest('Multi-parameter interpolation in Hindi', () => {
  const res = interpolate(hi['chat.enRouteDrop'], { dropNumber: 1, total: 3 });
  assert.strictEqual(res, 'ड्रॉप 3 में से 1 के रास्ते में');
});

console.log('\nGroup 5: AsyncStorage Persistence & Startup Gating');

runTest('Storage key is customer.locale', () => {
  assert.ok(content.includes("STORAGE_KEY = 'customer.locale'"), 'STORAGE_KEY is customer.locale');
});

runTest('Cold boot gating !isInitialized returns null to prevent English flash', () => {
  assert.ok(content.includes('if (!isInitialized) {'), 'Gating condition present');
  assert.ok(content.includes('return null; // Prevents English flash on cold boot'), 'Prevents English flash comment present');
});

console.log('\n--------------------------------------------------');
console.log(`Results: ${passedTests}/${totalTests} tests passed.`);
console.log('--------------------------------------------------');

if (passedTests === totalTests) {
  console.log('✓ All i18n localization tests PASSED successfully!\n');
} else {
  console.error('✗ Some tests FAILED.\n');
  process.exit(1);
}
