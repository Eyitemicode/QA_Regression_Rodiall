#!/usr/bin/env node
/**
 * Rodial API Collection Automation Script v2
 *
 * Fixes:
 *  1. Deprecated postman.setEnvironmentVariable → pm.environment.set
 *  2. pm.test(true/false, ...) → pm.test("string name", ...)
 *  3. Nested pm.test() calls inside another pm.test callback → flatten to top-level
 *  4. Adds test scripts to all requests that have none
 *  5. Ensures every request has a prerequest event (newman compatibility)
 */

const fs = require('fs');

const COLLECTION_FILE = 'Rodiall API .postman_collection.json';
const OUTPUT_FILE     = 'Rodiall API .postman_collection.json';

const collection = JSON.parse(fs.readFileSync(COLLECTION_FILE, 'utf8'));

// ─── Counters ─────────────────────────────────────────────────────────────────
const stats = { added: 0, fixed: 0, nestedFixed: 0, boolFixed: 0 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(listen, execLines) {
  return {
    listen,
    script: {
      exec: execLines,
      type: 'text/javascript',
      packages: {},
      requests: {}
    }
  };
}

function getUrl(item) {
  if (!item.request || !item.request.url) return '';
  if (typeof item.request.url === 'string') return item.request.url;
  return item.request.url.raw || '';
}

function isDownload(name, url) {
  const n = name.toLowerCase();
  return n.includes('download') || n.includes('export') ||
         n.includes('bulk sample') || n.includes('batch sample') ||
         url.includes('/download') || url.includes('/export');
}

function isExternal(url) {
  return url.includes('momodeveloper.mtn.com') || url.includes('sandbox.');
}

// ─── Test generators ──────────────────────────────────────────────────────────

const GET_TESTS = [
  "pm.test('Response status code is 200', function () {",
  "    pm.response.to.have.status(200);",
  "});",
  "",
  "pm.test('Content-Type header is application/json', function () {",
  "    pm.expect(pm.response.headers.get('Content-Type')).to.include('application/json');",
  "});",
  "",
  "pm.test('Response has success and data fields', function () {",
  "    const responseData = pm.response.json();",
  "    pm.expect(responseData).to.be.an('object');",
  "    pm.expect(responseData).to.have.property('success');",
  "    pm.expect(responseData).to.have.property('data');",
  "});",
  "",
  "pm.test('Success field is true', function () {",
  "    const responseData = pm.response.json();",
  "    pm.expect(responseData.success).to.be.true;",
  "});",
];

const DOWNLOAD_TESTS = [
  "pm.test('Response status code is 200', function () {",
  "    pm.response.to.have.status(200);",
  "});",
  "",
  "pm.test('Content-Type header is present', function () {",
  "    pm.expect(pm.response.headers.get('Content-Type')).to.exist;",
  "});",
];

const POST_TESTS = [
  "pm.test('Response status code is 200 or 201', function () {",
  "    pm.expect(pm.response.code).to.be.oneOf([200, 201]);",
  "});",
  "",
  "pm.test('Content-Type header is application/json', function () {",
  "    pm.expect(pm.response.headers.get('Content-Type')).to.include('application/json');",
  "});",
  "",
  "pm.test('Response has success and message fields', function () {",
  "    const responseData = pm.response.json();",
  "    pm.expect(responseData).to.be.an('object');",
  "    pm.expect(responseData).to.have.property('success');",
  "    pm.expect(responseData).to.have.property('message');",
  "});",
];

const PUT_PATCH_TESTS = [
  "pm.test('Response status code is 200', function () {",
  "    pm.response.to.have.status(200);",
  "});",
  "",
  "pm.test('Content-Type header is application/json', function () {",
  "    pm.expect(pm.response.headers.get('Content-Type')).to.include('application/json');",
  "});",
  "",
  "pm.test('Response has success and message fields', function () {",
  "    const responseData = pm.response.json();",
  "    pm.expect(responseData).to.be.an('object');",
  "    pm.expect(responseData).to.have.property('success');",
  "    pm.expect(responseData).to.have.property('message');",
  "});",
];

const DELETE_TESTS = [
  "pm.test('Response status code is 200', function () {",
  "    pm.response.to.have.status(200);",
  "});",
  "",
  "pm.test('Content-Type header is application/json', function () {",
  "    pm.expect(pm.response.headers.get('Content-Type')).to.include('application/json');",
  "});",
  "",
  "pm.test('Response has success and message fields', function () {",
  "    const responseData = pm.response.json();",
  "    pm.expect(responseData).to.be.an('object');",
  "    pm.expect(responseData).to.have.property('success');",
  "    pm.expect(responseData).to.have.property('message');",
  "});",
];

const EXTERNAL_TESTS = [
  "pm.test('Response status code is 2xx', function () {",
  "    pm.expect(pm.response.code).to.be.within(200, 299);",
  "});",
];

function chooseTests(item) {
  const method = (item.request && item.request.method) || 'GET';
  const name = item.name || '';
  const url = getUrl(item);

  if (isExternal(url))    return EXTERNAL_TESTS;
  if (isDownload(name, url)) return DOWNLOAD_TESTS;
  switch (method) {
    case 'POST':   return POST_TESTS;
    case 'PUT':    return PUT_PATCH_TESTS;
    case 'PATCH':  return PUT_PATCH_TESTS;
    case 'DELETE': return DELETE_TESTS;
    default:       return GET_TESTS;
  }
}

// ─── Fix 1: deprecated postman.* API calls ────────────────────────────────────

function fixDeprecated(lines) {
  let changed = false;
  const result = lines.map(line => {
    const fixed = line
      .replace(/postman\.setEnvironmentVariable\(/g, 'pm.environment.set(')
      .replace(/postman\.getEnvironmentVariable\(/g, 'pm.environment.get(')
      .replace(/postman\.setGlobalVariable\(/g,       'pm.globals.set(')
      .replace(/postman\.getGlobalVariable\(/g,        'pm.globals.get(')
      // Hard-coded IP URL assertions → flexible check
      .replace(
        /pm\.expect\(jsonData\.url\)\.to\.equal\("http:\/\/[\d.]+[^"]*"\);/g,
        "pm.expect(jsonData.url).to.be.a('string').and.to.include('/api/v1/');"
      );
    if (fixed !== line) changed = true;
    return fixed;
  });
  if (changed) stats.fixed++;
  return result;
}

// ─── Fix 2: pm.test(true/false, fn) → pm.test("string name", fn) ─────────────

function fixBoolTestName(lines) {
  let changed = false;
  const result = lines.map(line => {
    const fixed = line
      .replace(/pm\.test\(true,\s*/g,  'pm.test("Success is true", ')
      .replace(/pm\.test\(false,\s*/g, 'pm.test("Failure case", ');
    if (fixed !== line) changed = true;
    return fixed;
  });
  if (changed) stats.boolFixed++;
  return result;
}

// ─── Fix 3: nested pm.test() → flatten to top-level ─────────────────────────
//
// Only triggers when pm.test( appears DIRECTLY inside another pm.test callback,
// not when it is wrapped inside an if/forEach/etc. block first.
// We track "pm.test callback depth" separately from total brace depth to avoid
// mis-closing legitimate if/for blocks that happen to contain a pm.test call.

function countBraces(line) {
  let open = 0, close = 0;
  let inStr = false, strChar = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === strChar) inStr = false;
    } else {
      if (c === '"' || c === "'" || c === '`') { inStr = true; strChar = c; }
      else if (c === '{') open++;
      else if (c === '}') close++;
    }
  }
  return { open, close };
}

// Returns true when a line opens a pm.test callback: pm.test("...", function () {
function opensPmTestCallback(line) {
  return /pm\.test\(/.test(line) && /function\s*\(\s*\)\s*\{/.test(line);
}

function fixNestedTests(lines) {
  const result = [];
  let changed = false;

  // Stack of brace depths at which each pm.test callback was opened.
  // pmTestOpenDepths[i] = totalBraceDepth BEFORE the '{' of that pm.test's function body.
  const pmTestOpenDepths = [];
  let totalDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const { open, close } = countBraces(line);

    // If we're directly inside a pm.test callback (pmTestOpenDepths.length > 0)
    // AND the CURRENT nesting equals that pm.test's depth + 1 (meaning we are
    // at the direct body level, not inside a nested if/for)
    // AND this line starts another pm.test — close the outer one first.
    if (
      pmTestOpenDepths.length > 0 &&
      totalDepth === pmTestOpenDepths[pmTestOpenDepths.length - 1] + 1 &&
      /^pm\.test\(/.test(trimmed)
    ) {
      result.push('});');
      totalDepth--;
      pmTestOpenDepths.pop();
      changed = true;
    }

    result.push(line);
    totalDepth = Math.max(0, totalDepth + open - close);

    // Track when a pm.test callback is opened
    if (opensPmTestCallback(line)) {
      // The '{' at the end of this line pushed depth by 1; record depth before that '{'
      pmTestOpenDepths.push(totalDepth - 1);
    }

    // Pop any pm.test levels that were closed by this line's '}'
    while (
      pmTestOpenDepths.length > 0 &&
      totalDepth <= pmTestOpenDepths[pmTestOpenDepths.length - 1]
    ) {
      pmTestOpenDepths.pop();
    }
  }

  if (changed) stats.nestedFixed++;
  return result;
}

// ─── Apply all fixes to a set of exec lines ───────────────────────────────────

function fixExec(lines) {
  let result = lines;
  result = fixDeprecated(result);
  result = fixBoolTestName(result);
  result = fixNestedTests(result);
  return result;
}

// ─── Process collection recursively ──────────────────────────────────────────

function processItems(items) {
  return items.map(item => {
    if (item.item) {
      return { ...item, item: processItems(item.item) };
    }

    let events = item.event ? [...item.event] : [];

    // Fix all existing scripts
    events = events.map(ev => {
      if (ev.script && ev.script.exec && Array.isArray(ev.script.exec)) {
        return { ...ev, script: { ...ev.script, exec: fixExec(ev.script.exec) } };
      }
      return ev;
    });

    // Add tests if missing
    const testIdx = events.findIndex(e => e.listen === 'test');
    const testEvent = testIdx >= 0 ? events[testIdx] : null;
    const hasContent = testEvent &&
      testEvent.script && testEvent.script.exec &&
      testEvent.script.exec.join('').trim().length > 0;

    if (!hasContent) {
      const newEvent = makeEvent('test', chooseTests(item));
      if (testIdx >= 0) events[testIdx] = newEvent;
      else events = [newEvent, ...events];
      stats.added++;
    }

    // Ensure prerequest event exists
    if (!events.some(e => e.listen === 'prerequest')) {
      events.push(makeEvent('prerequest', ['']));
    }

    return { ...item, event: events };
  });
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const updated = { ...collection, item: processItems(collection.item) };
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(updated, null, 2));

console.log('Collection updated:', OUTPUT_FILE);
console.log('  Tests added:             ', stats.added);
console.log('  Deprecated API fixed:    ', stats.fixed);
console.log('  Boolean test names fixed:', stats.boolFixed);
console.log('  Nested pm.test fixed:    ', stats.nestedFixed);
