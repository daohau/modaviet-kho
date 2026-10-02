import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || 'xlsx_unpacked';
const outDir = process.argv[3] || 'exports';
fs.mkdirSync(outDir, { recursive: true });

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const attr = (s, name) => {
  const re = new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}="([^"]*)"`);
  return re.exec(s)?.[1] ?? '';
};
const xmlDecode = (s) => String(s ?? '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#([0-9]+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const textTags = (xml) => [...String(xml).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => xmlDecode(m[1])).join('');
const colNumber = (letters) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const colLetters = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const cellValue = (attrs, body, shared) => {
  const type = attr(attrs, 't');
  let raw = '';
  if (type === 'inlineStr') raw = textTags(body);
  else raw = xmlDecode(body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] ?? '');
  if (type === 's' && raw !== '' && shared[Number(raw)] !== undefined) return shared[Number(raw)];
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  return raw;
};

const sharedXml = read('xl/sharedStrings.xml');
const shared = [...sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m => textTags(m[1]));
const relsXml = read('xl/_rels/workbook.xml.rels');
const rels = Object.fromEntries([...relsXml.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)]
  .map(m => [attr(m[1], 'Id'), attr(m[1], 'Target')]));
const workbookXml = read('xl/workbook.xml');
const sheetTags = [...workbookXml.matchAll(/<sheet\b([^>]*)\/?>(?:<\/sheet>)?/g)];
const sheets = [];

for (const sm of sheetTags) {
  const sa = sm[1];
  const title = xmlDecode(attr(sa, 'name'));
  const state = attr(sa, 'state') || 'visible';
  const rid = attr(sa, 'r:id');
  let target = rels[rid] || '';
  if (target.startsWith('/')) target = target.slice(1);
  if (!target.startsWith('xl/')) target = `xl/${target}`;
  const xml = read(target);
  const dimension = xml.match(/<dimension\b[^>]*ref="([^"]+)"/)?.[1] ?? '';
  const rows = [];
  let maxCol = 0;
  let nonEmptyCells = 0;
  let formulaCount = 0;
  for (const rm of xml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowNo = Number(rm[1]);
    const cells = {};
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = cm[1];
      const address = attr(ca, 'r');
      if (!address) continue;
      const body = cm[2] ?? '';
      const value = cellValue(ca, body, shared);
      const formula = xmlDecode(body.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/)?.[1] ?? '');
      const col = address.match(/^([A-Z]+)/)?.[1] ?? '';
      maxCol = Math.max(maxCol, colNumber(col));
      if (value !== '' || formula !== '') nonEmptyCells++;
      if (formula !== '') formulaCount++;
      cells[col] = { value, ...(formula ? { formula } : {}) };
    }
    if (Object.keys(cells).length) rows.push({ row: rowNo, cells });
  }
  const headerRow = rows.find(r => r.row === 4);
  const headers = [];
  for (let i = 1; i <= maxCol; i++) headers.push(headerRow?.cells[colLetters(i)]?.value ?? '');
  const dataRows = rows.filter(r => r.row >= 5).map(r => {
    const values = [];
    let hasValue = false;
    for (let i = 1; i <= maxCol; i++) {
      const v = r.cells[colLetters(i)]?.value ?? '';
      values.push(v);
      if (v !== '') hasValue = true;
    }
    return { row: r.row, values, hasValue };
  }).filter(r => r.hasValue).map(({ row, values }) => ({ row, values }));
  sheets.push({ title, state, worksheet: target, dimension, maxCol, headers, rows: dataRows, nonEmptyCells, formulaCount });
}

const safe = (s) => s.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 100) || 'sheet';
for (const sheet of sheets) fs.writeFileSync(path.join(outDir, `${String(sheets.indexOf(sheet) + 1).padStart(2, '0')}_${safe(sheet.title)}.json`), JSON.stringify(sheet));
const summary = sheets.map(({ title, state, dimension, maxCol, headers, rows, nonEmptyCells, formulaCount }) => ({ title, state, dimension, maxCol, headers, dataRowCount: rows.length, firstDataRow: rows[0]?.row ?? null, lastDataRow: rows.at(-1)?.row ?? null, nonEmptyCells, formulaCount }));
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ source: root, sharedStringCount: shared.length, sheetCount: sheets.length, sheets: summary }, null, 2));
fs.writeFileSync(path.join(outDir, 'all_sheets.json'), JSON.stringify({ source: root, sharedStringCount: shared.length, sheetCount: sheets.length, sheets }));
console.log(JSON.stringify({ sharedStringCount: shared.length, sheetCount: sheets.length, sheets: summary }, null, 2));
