// Pulls every inline <script> block out of index.html (skipping tags with a
// src= attribute — those load external files, not inline code) and runs
// `node --check` against the concatenated result. index.html has no build
// step, so this is the only automated guard against a typo breaking the
// live app on the next push.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const scriptRe = /<script(?:(?! src=)[^>])*>([\s\S]*?)<\/script>/g;

const blocks = [];
let m;
while ((m = scriptRe.exec(html)) !== null) {
  blocks.push(m[1]);
}

if (blocks.length === 0) {
  console.error('No inline <script> blocks found — the extraction pattern likely needs updating.');
  process.exit(1);
}

console.log(`Found ${blocks.length} inline <script> block(s).`);

const tmpFile = path.join(os.tmpdir(), 'index-extracted.js');
fs.writeFileSync(tmpFile, blocks.join('\n'));

try {
  execFileSync('node', ['--check', tmpFile], { stdio: 'inherit' });
  console.log('Syntax OK.');
} catch (err) {
  console.error('Syntax check failed — see node error above.');
  process.exit(1);
}
