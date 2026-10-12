const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateResumeReport } = require('./upgrade-survey-saves');
test('resume accepts only a reload-verified destination prefix inside its isolated storage', () => {
    const manifest = path.resolve('evidence/fixture/manifest.json');
    const report = { completed: false, userRoot: path.join(path.dirname(manifest), 'user'), saves: [{ name: 'Peragus', module: '101PER', directory: 'Saves/000100 - Game99', reloadVerified: true }] };
    validateResumeReport(report, manifest);
    for (const patch of [{ completed: true }, { published: [] }, { userRoot: path.dirname(manifest) }, { saves: [{ ...report.saves[0], directory: '../outside' }] }, { saves: [{ ...report.saves[0], reloadVerified: false }] }, { saves: [{ ...report.saves[0], module: '231TEL' }] }]) {
        assert.throws(() => validateResumeReport({ ...report, ...patch }, manifest), /Invalid/);
    }
});
