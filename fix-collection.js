const fs = require('fs');
const col = JSON.parse(fs.readFileSync('Rodiall API.postman_collection.json', 'utf8'));

let fixes = 0;

// Patch a single event's exec lines
function patchTestScript(exec, requestPath) {
    let changed = false;
    const scriptStr = exec.join('\n');

    // --- Fix 1: Deprecated Login scripts ---
    // Company Admin & Super Admin: var jsonData = JSON.parse(responseBody); postman.setEnvironmentVariable("token",...)
    // Customer: postman.setEnvironmentVariable("customerToken",...)
    if (scriptStr.includes('JSON.parse(responseBody)') && scriptStr.includes('postman.setEnvironmentVariable')) {
        const newScript = scriptStr
            .replace(
                /var jsonData = JSON\.parse\(responseBody\);\s*\npostman\.setEnvironmentVariable\("(token|customerToken|agentToken|investorToken)", jsonData\.data\.accessToken\);/,
                (match, varName) => `const jsonData = pm.response.json();\npm.environment.set("${varName}", jsonData.data.accessToken);`
            );
        if (newScript !== scriptStr) {
            console.log('  [FIX 1] Fixed deprecated login script at: ' + requestPath);
            exec.length = 0;
            newScript.split('\n').forEach(l => exec.push(l));
            fixes++;
            changed = true;
        }
    }

    // Re-join for next checks
    const s = exec.join('\n');

    // --- Fix 2: Top-level `const jsonData = pm.response.json();` (Audit Trail pattern) ---
    if (/^const jsonData = pm\.response\.json\(\);$/m.test(s) && !s.includes('try {')) {
        const newS = s.replace(
            /^const jsonData = pm\.response\.json\(\);$/m,
            'let jsonData;\ntry { jsonData = pm.response.json(); } catch(e) {}'
        );
        if (newS !== s) {
            console.log('  [FIX 2] Wrapped top-level jsonData parse at: ' + requestPath);
            exec.length = 0;
            newS.split('\n').forEach(l => exec.push(l));
            fixes++;
            changed = true;
        }
    }

    // --- Fix 3: Top-level `const responseBody = pm.response.json();` + id extraction (Add Store pattern) ---
    const storePattern = /^const responseBody = pm\.response\.json\(\);\nlet id = responseBody\.data\.id;\nconsole\.log\("id:", id\);\npm\.environment\.set\("store_id", id\);$/m;
    const s2 = exec.join('\n');
    if (storePattern.test(s2)) {
        const newS = s2.replace(
            storePattern,
            'try {\n    const responseBody = pm.response.json();\n    if (responseBody && responseBody.data) {\n        pm.environment.set("store_id", responseBody.data.id);\n    }\n} catch(e) {}'
        );
        if (newS !== s2) {
            console.log('  [FIX 3] Wrapped store_id extraction at: ' + requestPath);
            exec.length = 0;
            newS.split('\n').forEach(l => exec.push(l));
            fixes++;
            changed = true;
        }
    }

    // --- Fix 4: Top-level `const value = pm.response.json().data.id;` (Eligibility Rule pattern) ---
    const s3 = exec.join('\n');
    const eligPattern = /^const value = pm\.response\.json\(\)\.data\.id;\s*\npm\.environment\.set\("([^"]+)", value\);$/m;
    if (eligPattern.test(s3)) {
        const newS = s3.replace(
            eligPattern,
            (match, envVar) => `try {\n    const value = pm.response.json().data.id;\n    pm.environment.set("${envVar}", value);\n} catch(e) {}`
        );
        if (newS !== s3) {
            console.log('  [FIX 4] Wrapped inline value extraction at: ' + requestPath);
            exec.length = 0;
            newS.split('\n').forEach(l => exec.push(l));
            fixes++;
            changed = true;
        }
    }

    // --- Fix 5: Top-level `let response = pm.response.json();` + conditional id set (Batch/DataPool/Policy/Company/NPL/Email pattern) ---
    const s4 = exec.join('\n');
    const conditionalPattern = /^let response = pm\.response\.json\(\);\s*\n\nif \(response\.success\) \{[\s\S]*?\}\s*(?:\n\n|$)/m;
    if (conditionalPattern.test(s4) && !s4.includes('try {')) {
        const newS = s4.replace(
            /^(let response = pm\.response\.json\(\);)\s*\n(\nif \(response\.success\) \{[\s\S]*?\n\})/m,
            (match, line1, rest) => `try {\n    ${line1}\n    ${rest.trim().replace(/\n/g, '\n    ')}\n} catch(e) {}`
        );
        if (newS !== s4) {
            console.log('  [FIX 5] Wrapped conditional response id extraction at: ' + requestPath);
            exec.length = 0;
            newS.split('\n').forEach(l => exec.push(l));
            fixes++;
            changed = true;
        }
    }

    // --- Fix 6: pm.test(true, ...) → pm.test("Success is true", ...) ---
    const s5 = exec.join('\n');
    if (s5.includes('pm.test(true,')) {
        const newS = s5.replace(/pm\.test\(true,/g, 'pm.test("Success is true",');
        if (newS !== s5) {
            console.log('  [FIX 6] Fixed pm.test(true,...) at: ' + requestPath);
            exec.length = 0;
            newS.split('\n').forEach(l => exec.push(l));
            fixes++;
            changed = true;
        }
    }

    return changed;
}

function fixBody(item, path) {
    if (!item.request?.body?.raw) return;
    const raw = item.request.body.raw;

    // Remove //Admin or //Customer comment prefix from Login bodies
    const cleaned = raw.replace(/^[\s\n]*\/\/[^\n]*\n/, '').replace(/^[\s\n]+/, '');
    if (cleaned !== raw && cleaned.trimStart().startsWith('{')) {
        console.log('  [FIX BODY] Removed comment from body at: ' + path);
        item.request.body.raw = cleaned;
        fixes++;
    }
}

function traverse(items, path = '') {
    for (const item of items) {
        const p = path ? path + '/' + item.name : item.name;
        if (item.item) {
            traverse(item.item, p);
        } else {
            fixBody(item, p);
            if (item.event) {
                for (const evt of item.event) {
                    if (evt.listen === 'test' && evt.script?.exec) {
                        patchTestScript(evt.script.exec, p);
                    }
                }
            }
        }
    }
}

traverse(col.item);

fs.writeFileSync('Rodiall API.postman_collection.json', JSON.stringify(col, null, 2));
console.log('\nTotal fixes applied:', fixes);
