// Builds src/data/currencies.json: each country's currency and a snapshot of exchange
// rates against the US dollar, so crop values can be shown in local money offline.
// The app refreshes the rates online when it can (src/money/currency.ts).
//
// Sources (fetched with `npm pack` into a folder given as the first argument):
//   - @fawazahmed0/currency-api (CC0, https://github.com/fawazahmed0/exchange-api): daily rates
//   - country-to-currency (MIT): ISO 3166 alpha-2 country → ISO 4217 currency
//
//   cd /tmp/fx && npm pack @fawazahmed0/currency-api country-to-currency && for f in *.tgz; do mkdir -p ${f%.tgz} && tar xzf $f -C ${f%.tgz}; done
//   node scripts/build-currencies.mjs /tmp/fx
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const find = (prefix) => join(dir, readdirSync(dir).find((d) => d.startsWith(prefix) && !d.endsWith('.tgz')), 'package');
const api = find('fawazahmed0-currency-api');
const mapping = readFileSync(join(find('country-to-currency'), 'index.js'), 'utf8');
const byIso2 = Object.fromEntries([...mapping.matchAll(/^\s*([A-Z]{2}): "([A-Z]{3})"/gm)].map((m) => [m[1], m[2]]));

const usd = JSON.parse(readFileSync(join(api, 'v1/currencies/usd.min.json'), 'utf8'));
const names = JSON.parse(readFileSync(join(api, 'v1/currencies.min.json'), 'utf8'));
const countries = JSON.parse(readFileSync('src/data/countries.json', 'utf8'));

const byCountry = {};
const used = new Set(['USD']);
for (const c of countries) {
  const cur = c.iso2 && byIso2[c.iso2];
  if (!cur || !usd.usd[cur.toLowerCase()]) continue;
  byCountry[c.iso3] = cur;
  used.add(cur);
}
const rates = {};
const currencyNames = {};
for (const cur of [...used].sort()) {
  rates[cur] = Number(usd.usd[cur.toLowerCase()].toPrecision(6));
  currencyNames[cur] = names[cur.toLowerCase()] || cur;
}
const out = { date: usd.date, source: 'fawazahmed0/exchange-api (CC0), rates per US dollar', rates, names: currencyNames, byCountry };
writeFileSync('src/data/currencies.json', JSON.stringify(out) + '\n');
console.log(`${Object.keys(byCountry).length} countries, ${used.size} currencies, rates of ${usd.date}`);
