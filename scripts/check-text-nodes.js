/**
 * Finds raw string children of non-<Text> elements, which crash React Native at
 * runtime with "Text strings must be rendered within a <Text> component."
 *
 * Two cases are reported:
 *   1. Visible text, e.g.  <View>Hello</View>
 *   2. Whitespace with no newline, e.g.  <View /> {comment}
 *      JSX trims whitespace runs containing a newline but keeps a plain space,
 *      so that trailing space becomes a text node inside the parent.
 *
 * Uses the TypeScript compiler's JSX parser so generics and type annotations
 * are not mistaken for JSX tags.
 *
 * Run: node scripts/check-text-nodes.js
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.join(__dirname, '..');

/** Elements that may NOT contain raw strings. */
const VIEW_LIKE = new Set([
  'View',
  'Animated.View',
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'ScrollView',
  'SafeAreaView',
  'KeyboardAvoidingView',
  'ImageBackground',
  'Modal',
]);

/** Elements that MAY contain raw strings. */
const TEXT_LIKE = new Set(['Text', 'Animated.Text']);

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });

const files = [...walk(path.join(root, 'src')), path.join(root, 'App.tsx')].filter((f) =>
  f.endsWith('.tsx')
);

const findings = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const tagName = (node) => {
    const el = ts.isJsxElement(node) ? node.openingElement : node;
    return el.tagName ? el.tagName.getText(sf) : '';
  };

  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      // A fragment is transparent: its string children land in whatever the
      // fragment's own parent renders, so they are never safe to ignore.
      const parent = ts.isJsxFragment(node) ? 'Fragment' : tagName(node);
      if (!TEXT_LIKE.has(parent)) {
        for (const child of node.children) {
          if (!ts.isJsxText(child)) continue;
          // `containsOnlyTriviaWhiteSpaces` is the parser's own answer to
          // "will JSX drop this text node?". When false, the node survives and
          // becomes a real string child. Note JsxText.getText() returns "",
          // so read the raw span for reporting.
          if (child.containsOnlyTriviaWhiteSpaces) continue;

          const raw = src.slice(child.pos, child.end);
          const visible = raw.trim().length > 0;
          const { line } = sf.getLineAndCharacterOfPosition(child.pos);
          findings.push({
            file: rel,
            line: line + 1,
            parent,
            known: VIEW_LIKE.has(parent),
            kind: visible ? 'text' : 'whitespace',
            snippet: JSON.stringify(raw.length > 40 ? `${raw.slice(0, 40)}…` : raw),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
}

if (!findings.length) {
  console.log(`Scanned ${files.length} files. No raw string children of view elements found.`);
  process.exit(0);
}

console.log(`Found ${findings.length} raw string child(ren) of view elements:\n`);
for (const f of findings) {
  const tag = f.known ? '' : '  (custom component — verify it renders a View)';
  console.log(`  ${f.file}:${f.line}  <${f.parent}> ${f.kind} ${f.snippet}${tag}`);
}
process.exit(1);
