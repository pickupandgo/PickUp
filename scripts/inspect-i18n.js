const fs = require('fs');

const content = fs.readFileSync('src/i18n/index.tsx', 'utf8');

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

console.log('EN key count:', Object.keys(en).length);
console.log('HI key count:', Object.keys(hi).length);

const query = process.argv[2];
if (query) {
  console.log(`\nKeys matching "${query}":`);
  for (const k of Object.keys(en)) {
    if (k.toLowerCase().includes(query.toLowerCase()) || en[k].toLowerCase().includes(query.toLowerCase())) {
      console.log(`  ${k} -> EN: "${en[k]}" | HI: "${hi[k]}"`);
    }
  }
} else {
  const namespaces = {};
  for (const k of Object.keys(en)) {
    const ns = k.split('.')[0];
    namespaces[ns] = (namespaces[ns] || 0) + 1;
  }
  console.log('Namespaces:', namespaces);
}
