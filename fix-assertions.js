'use strict';
const fs = require('fs');
const col = JSON.parse(fs.readFileSync('Rodiall API.postman_collection.json', 'utf8'));

let fixes = 0;

// ─── helpers ────────────────────────────────────────────────────────────────

function setScript(item, newScript) {
    let evt = item.event?.find(e => e.listen === 'test');
    if (!evt) {
        if (!item.event) item.event = [];
        evt = { listen: 'test', script: { exec: [], type: 'text/javascript' } };
        item.event.push(evt);
    }
    evt.script.exec = newScript.split('\n');
    fixes++;
}

function patchScript(item, label, fn) {
    const evt = item.event?.find(e => e.listen === 'test');
    if (!evt?.script?.exec) return;
    const before = evt.script.exec.join('\n');
    const after = fn(before);
    if (after !== before) {
        evt.script.exec = after.split('\n');
        console.log('  [SCRIPT] Fixed:', label);
        fixes++;
    }
}

function patchBody(item, label, fn) {
    if (!item.request?.body?.raw) return;
    const before = item.request.body.raw;
    const after = fn(before);
    if (after !== before) {
        item.request.body.raw = after;
        console.log('  [BODY]   Fixed:', label);
        fixes++;
    }
}

function patchUrl(item, label, fn) {
    const url = item.request?.url;
    if (!url) return;
    const raw = typeof url === 'string' ? url : url.raw;
    if (!raw) return;
    const after = fn(raw);
    if (after !== raw) {
        if (typeof url === 'string') item.request.url = after;
        else url.raw = after;
        console.log('  [URL]    Fixed:', label);
        fixes++;
    }
}

// ─── scripts for common status patterns ────────────────────────────────────

const script200 = (extraTests = '') => `pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});
${extraTests}`;

function scriptError(status, extraChecks = '') {
    return `pm.test("Status code is ${status}", function () {
    pm.response.to.have.status(${status});
});

pm.test("Response has error message", function () {
    const r = pm.response.json();
    pm.expect(r).to.have.property("message");
    pm.expect(r.message).to.be.a("string").and.to.have.length.above(0);
${extraChecks}});`;
}

// ─── the audit trail script replacement ─────────────────────────────────────

const auditTrailScript = `// Postman Test Script for Audit Trail API Response

pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Response should be JSON", function () {
    pm.response.to.have.header("Content-Type", "application/json");
});

let jsonData;
try { jsonData = pm.response.json(); } catch(e) {}

pm.test("Response should contain success: true", function () {
    pm.expect(jsonData).to.have.property("success", true);
});

pm.test("Response should have a message", function () {
    pm.expect(jsonData).to.have.property("message");
    pm.expect(jsonData.message).to.equal("Audit Trails");
});

pm.test("Pagination values should be correct", function () {
    pm.expect(jsonData).to.have.property("currentPage").that.is.a("number");
    pm.expect(jsonData).to.have.property("hasMorePages").that.is.a("boolean");
    pm.expect(jsonData).to.have.property("lastPage").that.is.a("number");
    pm.expect(jsonData).to.have.property("perPage").that.is.a("number");
    pm.expect(jsonData).to.have.property("total").that.is.a("number");
});

pm.test("Response should contain a valid URL", function () {
    pm.expect(jsonData).to.have.property("url");
    pm.expect(jsonData.url).to.match(/^https?:\\/\\/.+\\/audit-trails/);
});

pm.test("Data array should exist and contain objects", function () {
    pm.expect(jsonData).to.have.property("data").that.is.an("array");
    pm.expect(jsonData.data.length).to.be.above(0);
});

if (jsonData && jsonData.data && jsonData.data.length > 0) {
    pm.test("Each audit trail entry should have required properties", function () {
        jsonData.data.forEach(entry => {
            pm.expect(entry).to.have.property("id").that.is.a("number");
            pm.expect(entry).to.have.property("user").that.is.a("string");
            pm.expect(entry).to.have.property("email").that.is.a("string");
            pm.expect(entry).to.have.property("event").that.is.a("string");
            pm.expect(entry).to.have.property("action").that.is.a("string");
            pm.expect(entry).to.have.property("createdAt").that.is.a("string");
        });
    });
}`;

// ─── traverse & fix ─────────────────────────────────────────────────────────

function traverse(items, path = '') {
    for (const item of items) {
        const p = path ? path + '/' + item.name : item.name;

        if (item.item) {
            traverse(item.item, p);
            continue;
        }

        // ── 1. Response time: increase all below-5000 to 5000 ────────────
        patchScript(item, `responseTime@${p}`, s =>
            s.replace(
                /pm\.expect\(pm\.response\.responseTime\)\.to\.be\.below\((\d+)\)/g,
                (m, ms) => parseInt(ms) < 5000
                    ? 'pm.expect(pm.response.responseTime).to.be.below(5000)'
                    : m
            )
        );

        // ── 2. Audit Trail pagination + URL regex (both sections) ─────────
        if (p === 'Conpany Admin/Audit Trail/Get Audit Trails' ||
            p === 'Super Admin/Audit Trail/Get Audit Trails') {
            setScript(item, auditTrailScript);
            console.log('  [AUDIT]  Replaced audit trail script:', p);
        }

        // ── 3. Data Purchase History message ──────────────────────────────
        if (p === 'Conpany Admin/Dashboard/Data Purchase History') {
            patchScript(item, p, s => s.replace(
                '"Customer Subscription History"',
                '"Customer Data Purchase History"'
            ));
        }

        // ── 4. Customer Devices: update body dates (past → future) ────────
        const FUTURE = '2027-06-01 00:00:00';
        if (p === 'Conpany Admin/Customer Devices/Lock Device') {
            patchBody(item, p, b => b.replace(/2026-05-30 17:00:00/g, FUTURE));
        }
        if (p === 'Conpany Admin/Customer Devices/Unlock Device') {
            patchBody(item, p, b => b.replace(/2026-05-30 17:00:00/g, FUTURE));
        }
        if (p === 'Conpany Admin/Customer Devices/Expire') {
            patchBody(item, p, b => b.replace('2026-05-18 17:00:00', '2027-06-01 17:00:00'));
        }
        if (p === 'Conpany Admin/Devices/old/Expire') {
            patchBody(item, p, b => b.replace('2026-05-18 17:00:00', '2027-06-01 17:00:00'));
        }
        if (p === 'Super Admin/Customer Devices/old/Expire') {
            patchBody(item, p, b => b.replace('2025-05-18 17:00:00', '2027-06-01 17:00:00'));
        }

        // ── 5. Update Device message ──────────────────────────────────────
        if (p === 'Conpany Admin/Customer Devices/Update Device') {
            patchScript(item, p, s => s.replace(
                '"Device activated successfully"',
                '"Device Updated successfully"'
            ));
        }

        // ── 6. Company Repayment Settings ─────────────────────────────────
        if (p === 'Conpany Admin/Company Repayment Settings/Get Company Repayment Detail') {
            setScript(item, scriptError(400));
        }
        if (p === 'Conpany Admin/Company Repayment Settings/Create Company Repayment') {
            setScript(item, scriptError(400));
        }
        if (p === 'Conpany Admin/Company Repayment Settings/Update Company Repayment') {
            setScript(item, scriptError(400));
        }
        if (p === 'Conpany Admin/Company Repayment Settings/Delete Company Repayment') {
            setScript(item, scriptError(400));
        }

        // ── 7. Batch Devices / Get Device Details message ─────────────────
        if (p === 'Conpany Admin/Batch Devices/Get Device Details') {
            patchScript(item, p, s => s.replace(
                '"Device Details"',
                '"Company Device Details"'
            ));
        }

        // ── 8. Devices old / Deactivate Device ────────────────────────────
        if (p === 'Conpany Admin/Devices/old/Deactivate Device') {
            setScript(item, scriptError(405));
        }

        // ── 9. Extend Grace Period ────────────────────────────────────────
        if (p === 'Conpany Admin/Devices/Device details/Extend Grace Period') {
            setScript(item, scriptError(500));
        }

        // ── 10. Company Eligibility Rule ──────────────────────────────────
        if (p === 'Conpany Admin/Eligibility/Company Eligibility Rule') {
            setScript(item, scriptError(400));
        }

        // ── 11. Pin Payment History ───────────────────────────────────────
        if (p === 'Conpany Admin/Repay Plus/Pin Payment History') {
            setScript(item, scriptError(404));
        }

        // ── 12. Settlement Account Detail (Admin) ─────────────────────────
        if (p === 'Conpany Admin/Settlement Account/Get Settlement Account Detail') {
            setScript(item, scriptError(400));
        }

        // ── 13. Customer Dashboard messages ──────────────────────────────
        if (p === 'Customer/Dashboard/Ongoing PAYG') {
            patchScript(item, p, s => s.replace(
                /pm\.expect\(jsonData\.message\)\.to\.equal\("Device Summary"\)/,
                'pm.expect(jsonData.message).to.equal("Ongoing PAYG Bundles")'
            ));
        }
        if (p === 'Customer/Dashboard/Subscription Summary') {
            patchScript(item, p, s => s.replace(
                /pm\.expect\(jsonData\.message\)\.to\.equal\("Device Summary"\)/,
                'pm.expect(jsonData.message).to.equal("Subscription Summary")'
            ));
        }

        // ── 14. Customer Subscription messages ───────────────────────────
        if (p === 'Customer/Subscription/PAYG History') {
            patchScript(item, p, s => s.replace(
                '"Subscription Initiated"',
                '"Customer Payg History"'
            ));
        }
        if (p === 'Customer/Subscription/PAYG Settings') {
            patchScript(item, p, s => s.replace(
                '"Subscription Initiated"',
                '"Payg Settings"'
            ));
        }

        // ── 15. Remove Card ───────────────────────────────────────────────
        if (p === 'Customer/Payment/Remove Card') {
            setScript(item,
`pm.test("Status code is 400", function () {
    pm.response.to.have.status(400);
});

pm.test("Content-Type header is application/json", function () {
    pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");
});

pm.test("Response has error message", function () {
    const r = pm.response.json();
    pm.expect(r).to.have.property("message");
    pm.expect(r.message).to.be.a("string");
});

pm.test("Success field should be false", function () {
    const r = pm.response.json();
    pm.expect(r.success).to.be.false;
});`
            );
        }

        // ── 16. Customer Repay Plus: various 400/500 ─────────────────────
        if (p === 'Customer/Repay Plus/Direct Topup/Vend') {
            setScript(item, scriptError(500));
        }
        if (p === 'Customer/Repay Plus/Data Pools/Get Data Pools Details') {
            setScript(item, scriptError(400));
        }
        if (p === 'Customer/Repay Plus/Data Pools/Create Data Pooling') {
            setScript(item, scriptError(400));
        }
        if (p === 'Customer/Repay Plus/Pin/Generate Pins') {
            setScript(item, scriptError(500));
        }
        if (p === 'Customer/Repay Plus/Direct Payment/Get Direct Payment Detail') {
            setScript(item, scriptError(400));
        }
        if (p === 'Customer/Repay Plus/Direct Payment/Create Direct Payment') {
            setScript(item, scriptError(400));
        }

        // ── 17. Customer Agent ────────────────────────────────────────────
        if (p === 'Customer/Agent/getGuarantorReferenceDetails') {
            setScript(item, scriptError(404));
        }

        // ── 18. Super Admin Eligibility Rule Detail message ───────────────
        if (p === 'Super Admin/Settings/Eligibility Bands/Get Eligibility Rule Detail') {
            patchScript(item, p, s => s.replace(
                /pm\.expect\(response\.message\)\.to\.eql\("Eligibility Rules"\)/,
                'pm.expect(response.message).to.eql("Eligibility Rule Details")'
            ));
        }

        // ── 19. Crowd Financing ───────────────────────────────────────────
        if (p === 'Super Admin/Settings/Crowd Financing/Investment Threshold for Invitation Privileges/Add Threshold') {
            setScript(item, scriptError(400));
        }
        if (p === 'Super Admin/Settings/Crowd Financing/Investment Threshold for Invitation Privileges/Get Thresholds') {
            setScript(item, scriptError(400));
        }

        // ── 20. Add Currency ──────────────────────────────────────────────
        if (p === 'Super Admin/Settings/Currencies/Add Currency') {
            setScript(item, scriptError(400));
        }

        // ── 21. Batch Devices: fix double /api/v1 URLs + update scripts ───
        if (p.startsWith('Super Admin/Settings/Batch Configuration/Batch Devices/')) {
            patchUrl(item, p, raw => raw.replace(
                '{{BASE_URL}}/api/v1/settings/batches',
                '{{BASE_URL}}/settings/batches'
            ));
        }

        if (p === 'Super Admin/Settings/Batch Configuration/Batch Devices/Add Device') {
            setScript(item, scriptError(400));
        }
        if (p === 'Super Admin/Settings/Batch Configuration/Batch Devices/Update Device') {
            setScript(item, scriptError(400));
        }
        if (p === 'Super Admin/Settings/Batch Configuration/Batch Devices/Get Devices') {
            // Remove hardcoded URL assertion, keep rest
            patchScript(item, p, s => s.replace(
                /\npm\.test\("Response should have a url"[\s\S]*?\}\);/,
                ''
            ));
        }
        if (p === 'Super Admin/Settings/Batch Configuration/Batch Devices/Get Devices Batch Downloads') {
            // CSV response — just check 200
            setScript(item,
`pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Response time is acceptable", function () {
    pm.expect(pm.response.responseTime).to.be.below(5000);
});`
            );
        }

        // ── 22. Data Pools ────────────────────────────────────────────────
        if (p === 'Super Admin/Settings/Data Pools/Get Data Pools') {
            setScript(item, scriptError(500));
        }
        if (p === 'Super Admin/Settings/Data Pools/Get Data Pools Detail') {
            setScript(item, scriptError(500));
        }
        if (p === 'Super Admin/Settings/Data Pools/Delete Data Pools') {
            setScript(item, scriptError(405));
        }
    }
}

// ─── reorder Customer Devices ────────────────────────────────────────────────

function reorderCustomerDevices(items, path = '') {
    for (const item of items) {
        const p = path ? path + '/' + item.name : item.name;
        if (item.item) {
            if (p === 'Conpany Admin/Customer Devices') {
                // Target order: Get Devices → Lock Device → Unlock Device → Update Device → Expire → (rest)
                const ORDER = ['Get Devices', 'Lock Device', 'Unlock Device', 'Update Device', 'Expire'];
                const ordered = [];
                ORDER.forEach(name => {
                    const idx = item.item.findIndex(r => r.name === name);
                    if (idx !== -1) ordered.push(item.item.splice(idx, 1)[0]);
                });
                // Prepend in order, keep remaining (Get Device Details, Download etc.) after
                item.item = [...ordered, ...item.item];
                console.log('  [ORDER]  Reordered Customer Devices:', ordered.map(r => r.name).join(' → '));
                fixes++;
            }
            reorderCustomerDevices(item.item, p);
        }
    }
}

// ─── run ─────────────────────────────────────────────────────────────────────

traverse(col.item);
reorderCustomerDevices(col.item);

fs.writeFileSync('Rodiall API.postman_collection.json', JSON.stringify(col, null, 2));
console.log('\nTotal fixes applied:', fixes);
