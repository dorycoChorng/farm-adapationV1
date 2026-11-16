#!/usr/bin/env node
/**
 * Writes the licence text and copyright notice of every open-source package that ships
 * in the app to <outDir>/third-party-licenses.txt (default: dist).
 *
 * MIT, BSD, ISC, Apache and Zlib licences ask that their notices go along with every copy
 * of the software. The web build minifies the code and drops those notices, so this file
 * carries them instead. It runs after `expo export` (see vercel.json) and is linked from
 * the app's Sources and credits screen.
 *
 * Which packages: everything in package-lock.json that is not a development-only tool
 * (dev: true), i.e. what `npm ci --omit=dev` would install. Packages for other operating
 * systems that npm skipped are listed from package-lock.json without their text.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.resolve(root, process.argv[2] ?? 'dist');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

const LICENCE_FILE = /^(licen[cs]e|copying|notice|unlicense)(\.|-|$)/i;

function licenceTexts(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => LICENCE_FILE.test(n)).sort();
  } catch {
    return null;
  }
  return names
    .map((n) => {
      try {
        return fs.readFileSync(path.join(dir, n), 'utf8').trim();
      } catch {
        return '';
      }
    })
    .filter(Boolean);
}

function personName(p) {
  if (!p) return '';
  return typeof p === 'string' ? p : [p.name, p.email && `<${p.email}>`].filter(Boolean).join(' ');
}

const entries = [];
const seen = new Set();
for (const [key, info] of Object.entries(lock.packages ?? {})) {
  if (!key || info.dev || info.link) continue; // '' is this app itself
  const dir = path.join(root, key);
  const name = info.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    // Not installed here (for example a package for another operating system).
  }
  const version = pkg.version ?? info.version ?? '';
  const id = `${name}@${version}`;
  if (seen.has(id)) continue;
  seen.add(id);
  const licence = (typeof pkg.license === 'string' ? pkg.license : pkg.license?.type) ?? info.license ?? 'see package';
  entries.push({ id, licence, author: personName(pkg.author), repo: typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? '', texts: licenceTexts(dir) });
}
// Code or data copied into the app at build time rather than installed from npm.
const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
const COPIED = [
  {
    id: 'country-to-currency (country → currency table in src/data/currencies.json)',
    licence: 'MIT',
    author: 'Thiago Delgado Pinto',
    repo: 'https://www.npmjs.com/package/country-to-currency',
    texts: [`MIT License\n\nCopyright (c) Thiago Delgado Pinto\n\n${MIT_TEXT}`],
  },
  {
    id: '@fawazahmed0/currency-api (exchange rates in src/data/currencies.json)',
    licence: 'CC0-1.0',
    author: 'Fawaz Ahmed',
    repo: 'https://github.com/fawazahmed0/exchange-api',
    texts: ['Released to the public domain under CC0 1.0 Universal; no notice is required. Credited anyway.'],
  },
];
for (const e of COPIED) if (!seen.has(e.id)) entries.push(e);
entries.sort((a, b) => a.id.localeCompare(b.id));

const rule = '-'.repeat(78);
const out = [
  'Farm Adaptation: third-party software licences',
  '',
  'The app’s own code is licensed under the Apache License 2.0 (Copyright 2026 Doryco Chorng).',
  'It is built with the open-source packages below. Each keeps its own licence; the full',
  'licence text and copyright notice of each package follows.',
  'Data, maps and photos are credited in the app (Sources and credits) and in README.md.',
  '',
  `${entries.length} packages`,
  '',
];
for (const e of entries) {
  out.push(rule, e.id, `Licence: ${e.licence}`);
  if (e.author) out.push(`Author: ${e.author}`);
  if (e.repo) out.push(`Source: ${e.repo.replace(/^git\+/, '')}`);
  out.push('');
  if (e.texts === null) out.push('(Not installed on the build machine; licence as listed in package-lock.json.)');
  else if (!e.texts.length) out.push(`(No licence file in the package; it is published under ${e.licence}.)`);
  else out.push(e.texts.join('\n\n'));
  out.push('');
}

fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, 'third-party-licenses.txt');
fs.writeFileSync(file, out.join('\n'));
const missing = entries.filter((e) => e.texts === null).length;
console.log(`Wrote ${path.relative(root, file)}: ${entries.length} packages${missing ? `, ${missing} not installed here` : ''}.`);
