// PoC 4 browser checks: axe-core (WCAG 2.0/2.1 A and AA rules) on every page in both locales,
// plus the scripted parts of the manual checklist (lang/dir, keyboard order, focus visibility,
// reflow at 200% zoom and 320 px, safe rendering, theme inheritance, the keyboard-only form flow
// and the Puck editor in RTL). Writes a JSON result file and the report screenshots.
//
// Usage: start the portal (`pnpm build && pnpm start`, port 3100), then `node e2e/run.mjs`.
// Playwright is the one pre-installed on the machine (PLAYWRIGHT_MODULE overrides the path).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright',
);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const AXE_VERSION = require('axe-core/package.json').version;

const PORT = process.env.PORT ?? '3100';
const FA = `http://demo-fa.localhost:${PORT}`;
const FARS = `http://fars.demo-fa.localhost:${PORT}`;
const EN = `http://demo-en.localhost:${PORT}`;
const ASSETS = path.resolve(import.meta.dirname, '../../../docs/reviews/poc-4-assets');
mkdirSync(ASSETS, { recursive: true });

const results = {
  axeVersion: AXE_VERSION,
  axe: [],
  checks: [],
  keyboard: {},
  editor: {},
  console: [],
};
const check = (name, pass, detail = '') => {
  results.checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/** A request from Node to the local portal with a chosen Host (Node does not resolve *.localhost). */
function raw(method, base, pathname, headers = {}, body) {
  const { host } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, method, path: pathname, headers: { host, ...headers } },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode, text, json: () => JSON.parse(text) }),
        );
      },
    );
    req.on('error', reject);
    if (body !== undefined) {
      req.setHeader('content-type', 'application/json');
      req.end(JSON.stringify(body));
    } else req.end();
  });
}

async function axe(page, label) {
  await page.addScriptTag({ content: AXE });
  const out = await page.evaluate(async () => {
    const r = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      resultTypes: ['violations', 'incomplete'],
    });
    const brief = (list) =>
      list.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
        targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
        summary: v.nodes[0]?.failureSummary?.slice(0, 300),
      }));
    return {
      violations: brief(r.violations),
      incomplete: brief(r.incomplete),
      passes: r.passes.length,
    };
  });
  const nodes = out.violations.reduce((sum, v) => sum + v.nodes, 0);
  results.axe.push({ page: label, ...out, violationNodes: nodes });
  console.log(
    `axe   ${label}: ${out.violations.length} rules / ${nodes} nodes violated, ${out.incomplete.length} need review, ${out.passes} rules passed`,
  );
  return out;
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
context.on('page', (p) => watch(p));
function watch(page) {
  page.on('console', (m) => {
    if (process.env.DEBUG_FORM && m.text().startsWith('[form]')) console.log('   ', m.text());
    if (m.type() === 'error' || m.type() === 'warning')
      results.console.push({ url: page.url(), type: m.type(), text: m.text().slice(0, 300) });
  });
  page.on('pageerror', (e) =>
    results.console.push({ url: page.url(), type: 'pageerror', text: String(e).slice(0, 300) }),
  );
  page.on('dialog', async (d) => {
    results.checks.push({ name: 'no script dialog from data', pass: false, detail: d.message() });
    await d.dismiss();
  });
}
const page = await context.newPage();
watch(page);

// ---------------------------------------------------------------- portal pages, both locales
for (const [label, url, lang, dir] of [
  ['fa-IR home (demo-fa / moe)', FA, 'fa-IR', 'rtl'],
  ['fa-IR home, child site (demo-fa / fars)', FARS, 'fa-IR', 'rtl'],
  ['en-CA home (demo-en / main)', EN, 'en-CA', 'ltr'],
]) {
  await page.goto(url, { waitUntil: 'networkidle' });
  const attrs = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    title: document.title,
  }));
  check(
    `${label}: <html lang="${lang}" dir="${dir}">`,
    attrs.lang === lang && attrs.dir === dir,
    JSON.stringify(attrs),
  );
  const landmarks = await page.evaluate(() => ({
    header: document.querySelectorAll('header').length,
    main: document.querySelectorAll('main').length,
    footer: document.querySelectorAll('footer').length,
    h1: document.querySelectorAll('h1').length,
    navNames: [...document.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label')),
  }));
  check(
    `${label}: one banner, main, contentinfo and h1; named navs`,
    landmarks.header === 1 &&
      landmarks.main === 1 &&
      landmarks.footer === 1 &&
      landmarks.h1 === 1 &&
      landmarks.navNames.every(Boolean),
    JSON.stringify(landmarks),
  );
  // Logical layout: the site name sits at the inline start (right in RTL, left in LTR).
  const order = await page.evaluate(() => {
    const brand = document.querySelector('header a').getBoundingClientRect();
    const nav = document.querySelector('header nav').getBoundingClientRect();
    return { brandX: Math.round(brand.x), navX: Math.round(nav.x) };
  });
  check(
    `${label}: header mirrors with the direction`,
    dir === 'rtl' ? order.brandX > order.navX : order.brandX < order.navX,
    JSON.stringify(order),
  );
  await axe(page, label);
}

// Safe rendering of hostile data (fa page holds the hostile fixture).
await page.goto(FA, { waitUntil: 'networkidle' });
const hostile = await page.evaluate(() => ({
  injectedImg: document.querySelectorAll('img[src="x"]').length,
  // The page data also travels in React's flight payload (self.__next_f.push(...) scripts) as an
  // escaped JSON string; an injected script would be any other inline script holding it.
  injectedScriptText: [...document.querySelectorAll('script:not([src])')].some(
    (s) =>
      s.textContent.includes("alert('xss')") &&
      !s.textContent.trimStart().startsWith('self.__next_f'),
  ),
  inFlightPayloadOnly: [...document.querySelectorAll('script:not([src])')].some((s) =>
    s.textContent.includes("alert('xss')"),
  ),
  shownAsText: document.body.innerText.includes('<img src=x onerror="alert(1)">'),
  javascriptLinks: [...document.querySelectorAll('a')].filter((a) =>
    a.getAttribute('href')?.toLowerCase().startsWith('javascript'),
  ).length,
  unknownBlockRendered: document.body.innerHTML.includes('unknown block'),
}));
check(
  'no raw HTML from data: markup in a title shows as text, no element injected',
  hostile.injectedImg === 0 && !hostile.injectedScriptText && hostile.shownAsText,
  JSON.stringify(hostile),
);
check('javascript: URL from data is not rendered as a link', hostile.javascriptLinks === 0);
check('unregistered block type (RawHtml) renders nothing', !hostile.unknownBlockRendered);
const persianDate = await page.locator('time').first().textContent();
check(
  'news date in Jalali with Persian digits',
  /^[۰-۹]+ [؀-ۿ]+ [۰-۹]{4}$/.test(persianDate ?? ''),
  persianDate,
);
await page.screenshot({ path: path.join(ASSETS, '01-portal-fa-rtl.png'), fullPage: true });

// Theme inheritance: the child keeps the parent's locked brand and its own accent.
const themeOf = async (url) => {
  await page.goto(url, { waitUntil: 'networkidle' });
  return page.evaluate(() => ({
    brand: getComputedStyle(document.querySelector('header')).backgroundColor,
    accent: getComputedStyle(document.querySelector('main a.bg-accent')).backgroundColor,
    radius: getComputedStyle(document.querySelector('main a.bg-accent')).borderRadius,
  }));
};
const moeTheme = await themeOf(FA);
const farsTheme = await themeOf(FARS);
const farsCss = (await raw('GET', FARS, '/theme.css')).text;
check(
  'child site inherits the parent brand colour (locked token kept)',
  farsTheme.brand === moeTheme.brand && farsTheme.brand === 'rgb(11, 79, 67)',
  `moe ${moeTheme.brand}, fars ${farsTheme.brand}`,
);
check(
  'child site overrides an open token (accent)',
  farsTheme.accent === 'rgb(138, 59, 18)' && moeTheme.accent === 'rgb(11, 92, 74)',
  `moe ${moeTheme.accent}, fars ${farsTheme.accent}`,
);
check(
  'child override of the locked token is refused and reported',
  farsCss.includes('refused color.brand from fars: locked'),
);
const enTheme = await themeOf(EN);
check(
  'second tenant has its own theme (no shared literal)',
  enTheme.brand === 'rgb(38, 33, 92)' && enTheme.radius === '999px',
  JSON.stringify(enTheme),
);
await page.goto(EN, { waitUntil: 'networkidle' });
const enDate = await page.locator('time').first().textContent();
check(
  'en-CA date in Gregorian with Latin digits',
  /^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(enDate ?? ''),
  enDate,
);
await page.screenshot({ path: path.join(ASSETS, '02-portal-en-ltr.png'), fullPage: true });

// Unknown host: no default tenant.
const unknown = await raw('GET', `http://unknown.localhost:${PORT}`, '/');
check(
  'unknown host answers 404 (no default tenant)',
  unknown.status === 404,
  String(unknown.status),
);

// ---------------------------------------------------------------- keyboard order and focus
async function tabWalk(url, steps) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.activeElement?.blur());
  const stops = [];
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement === document.body)) break; // past the last stop
    stops.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.getAttribute('aria-label') || el.textContent || el.value || '')
            .trim()
            .slice(0, 40),
          outline: `${cs.outlineStyle} ${cs.outlineWidth}`,
          visible:
            (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) ||
            cs.boxShadow !== 'none',
          onScreen:
            r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.left < innerWidth,
          x: Math.round(r.x),
          y: Math.round(r.y + scrollY),
        };
      }),
    );
  }
  return stops;
}
for (const [label, url] of [
  ['fa-IR home', FA],
  ['en-CA home', EN],
]) {
  const stops = await tabWalk(url, 14);
  results.keyboard[label] = stops;
  check(
    `${label}: first Tab stop is the skip link, shown when focused`,
    stops[0].tag === 'a' && stops[0].onScreen,
    stops[0].text,
  );
  check(
    `${label}: every Tab stop has a visible focus indicator`,
    stops.every((s) => s.visible && s.onScreen),
    stops
      .filter((s) => !s.visible || !s.onScreen)
      .map((s) => s.text)
      .join(' | '),
  );
  const ys = stops.slice(1).map((s) => s.y);
  check(
    `${label}: Tab order follows the reading order (top to bottom)`,
    ys.every((y, i) => i === 0 || y >= ys[i - 1] - 4),
    ys.join(','),
  );
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  const afterSkip = await page.evaluate(() => document.activeElement.closest('main') !== null);
  check(`${label}: skip link moves the next Tab into <main>`, afterSkip);
}

// ---------------------------------------------------------------- zoom 200% and reflow
for (const [label, url] of [
  ['fa-IR home', FA],
  ['en-CA home', EN],
  ['fa-IR form', `${FA}/forms/appointment`],
]) {
  for (const width of [640, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle' });
    const m = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
    }));
    check(
      `${label} at ${width === 640 ? '200% zoom (640 CSS px)' : '400% / 320 px reflow'}: no horizontal scroll`,
      m.scrollWidth <= m.innerWidth,
      JSON.stringify(m),
    );
  }
}
await page.setViewportSize({ width: 640, height: 900 });
await page.goto(FA, { waitUntil: 'networkidle' });
await axe(page, 'fa-IR home at 200% zoom (640 CSS px)');
await page.setViewportSize({ width: 1280, height: 900 });

// ---------------------------------------------------------------- the form, keyboard only
const formUrl = `${FA}/forms/appointment`;
await page.goto(formUrl, { waitUntil: 'networkidle' });
await axe(page, 'fa-IR form, initial');
const fieldOrder = ['field-fullName', 'field-nationalCode', 'field-mobile', 'field-birthDate'];
// Tab from the top of <main> to the first field, then to the submit button.
await page.focus('main');
const formStops = [];
for (let i = 0; i < 8; i += 1) {
  await page.keyboard.press('Tab');
  formStops.push(
    await page.evaluate(
      () =>
        document.activeElement.getAttribute('aria-label') ||
        document.activeElement.id ||
        document.activeElement.tagName.toLowerCase(),
    ),
  );
}
results.keyboard['fa-IR form'] = formStops;
check(
  'form Tab order: name, national code, mobile, date, calendar button, type, details, submit',
  JSON.stringify(formStops.slice(0, 8)) ===
    JSON.stringify([
      ...fieldOrder,
      'انتخاب تاریخ از تقویم',
      'field-requestType',
      'field-description',
      'button',
    ]),
  formStops.join(' > '),
);

// Empty submit with the keyboard.
await page.keyboard.press('Enter'); // focus is on the submit button (the eighth stop)
await page.waitForSelector('[role="alert"]');
const summary = await page.evaluate(() => {
  const box = document.querySelector('[role="alert"]');
  return {
    focused: document.activeElement === box,
    items: [...box.querySelectorAll('li')].map((li) => li.textContent),
    hrefs: [...box.querySelectorAll('a')].map((a) => a.getAttribute('href')),
  };
});
check(
  'empty submit: error summary appears and takes focus',
  summary.focused,
  summary.items.join(' | '),
);
check(
  'validation messages are Persian, one per required field',
  summary.items.length === 5 && summary.items.every((t) => /[؀-ۿ]/.test(t)),
  summary.items.join(' | '),
);
const fieldA11y = await page.evaluate(
  (ids) =>
    ids.map((id) => {
      const el = document.getElementById(id);
      const describedBy = (el.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
      const label = el.labels?.[0]?.textContent ?? null;
      return {
        id,
        label,
        invalid: el.getAttribute('aria-invalid'),
        required: el.getAttribute('aria-required'),
        describedByText: describedBy
          .map((d) => document.getElementById(d)?.textContent ?? '(missing)')
          .join(' / '),
      };
    }),
  [...fieldOrder, 'field-requestType'],
);
results.form = { fieldA11y };
check(
  'each invalid field: label, aria-invalid, aria-required, error in aria-describedby',
  fieldA11y.every(
    (f) =>
      f.label && f.invalid === 'true' && f.required === 'true' && /[؀-ۿ]/.test(f.describedByText),
  ),
  JSON.stringify(fieldA11y.map((f) => [f.id, f.invalid, f.describedByText.slice(0, 50)])),
);
await axe(page, 'fa-IR form, errors shown');
// The first summary link takes the person to the field.
await page.keyboard.press('Tab');
await page.keyboard.press('Enter');
const afterLink = await page.evaluate(() => document.activeElement.id);
check('error summary link moves focus to its field', afterLink === 'field-fullName', afterLink);

// Fill every field with the keyboard, typing Arabic letters and mixed digit scripts.
await page.focus('#field-fullName');
await page.keyboard.type('علي كريمي');
await page.keyboard.press('Tab');
await page.keyboard.type('۰۰۱۲٣٤٥۶۷۸'); // Persian and Arabic-Indic digits mixed
await page.keyboard.press('Tab');
await page.keyboard.type('٠٩١٢1234567'); // Arabic-Indic and ASCII mixed
await page.keyboard.press('Tab');
await page.keyboard.type('1369/2/11'); // ASCII digits, Jalali date
await page.keyboard.press('Tab'); // commits the date, focus on the calendar button
const typed = await page.evaluate(() => ({
  name: document.getElementById('field-fullName').value,
  nationalCode: document.getElementById('field-nationalCode').value,
  mobile: document.getElementById('field-mobile').value,
  date: document.getElementById('field-birthDate').value,
}));
results.form.typed = typed;
check('ی/ي and ک/ك normalised as typed', typed.name === 'علی کریمی', typed.name);
check(
  'identifier digits shown in Persian digits whatever was typed',
  typed.nationalCode === '۰۰۱۲۳۴۵۶۷۸' && typed.mobile === '۰۹۱۲۱۲۳۴۵۶۷',
  `${typed.nationalCode} ${typed.mobile}`,
);
check('typed Jalali date re-shown with Persian digits', typed.date === '۱۳۶۹/۰۲/۱۱', typed.date);

// The calendar, keyboard only: open, move, change month, choose.
await page.keyboard.press('Enter');
await page.waitForSelector('[role="grid"]');
const opened = await page.evaluate(() => ({
  focus: document.activeElement.getAttribute('aria-label'),
  heading: document.querySelector('[role="dialog"] h2')?.textContent,
  dialogDir: document.querySelector('[role="dialog"]')?.getAttribute('dir'),
  firstWeekday: document.querySelector('[role="grid"] th')?.getAttribute('abbr'),
}));
check(
  'calendar opens on the chosen date with focus on it',
  opened.focus === '۱۱ اردیبهشت ۱۳۶۹',
  JSON.stringify(opened),
);
check(
  'calendar week starts on Saturday for fa-IR (from Intl week info)',
  opened.firstWeekday === 'شنبه',
  opened.firstWeekday,
);
await page.screenshot({ path: path.join(ASSETS, '03-form-fa-calendar.png'), fullPage: false });
await page.keyboard.press('ArrowLeft'); // RTL: left is the next day
const left = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
check('ArrowLeft in RTL moves to the next day', left === '۱۲ اردیبهشت ۱۳۶۹', left);
await page.keyboard.press('ArrowDown');
await page.keyboard.press('PageDown');
const moved = await page.evaluate(() => ({
  focus: document.activeElement.getAttribute('aria-label'),
  heading: document.querySelector('[role="dialog"] h2')?.textContent,
}));
check(
  'ArrowDown +7 days, PageDown next month',
  moved.focus === '۱۹ خرداد ۱۳۶۹' && moved.heading === 'خرداد ۱۳۶۹',
  JSON.stringify(moved),
);
await axe(page, 'fa-IR form, calendar open');
await page.keyboard.press('Enter');
const chosen = await page.evaluate(() => ({
  open: Boolean(document.querySelector('[role="grid"]')),
  value: document.getElementById('field-birthDate').value,
  focus: document.activeElement.getAttribute('aria-label'),
}));
check(
  'Enter chooses the date, closes, returns focus to the button',
  !chosen.open && chosen.value === '۱۳۶۹/۰۳/۱۹' && chosen.focus === 'انتخاب تاریخ از تقویم',
  JSON.stringify(chosen),
);
await page.keyboard.press('Enter');
await page.waitForSelector('[role="grid"]');
await page.keyboard.press('Escape');
const escaped = await page.evaluate(() => ({
  open: Boolean(document.querySelector('[role="grid"]')),
  focus: document.activeElement.getAttribute('aria-label'),
}));
check(
  'Escape closes the calendar and returns focus',
  !escaped.open && escaped.focus === 'انتخاب تاریخ از تقویم',
  JSON.stringify(escaped),
);

await page.keyboard.press('Tab'); // request type (native select)
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
const requestType = await page.evaluate(() => document.getElementById('field-requestType').value);
check('select operable with the keyboard', requestType === 'complaint', requestType);
await page.keyboard.press('Tab');
await page.keyboard.type('پلاک ١٢');
await page.keyboard.press('Tab');
const [response] = await Promise.all([
  page
    .waitForResponse((r) => r.url().endsWith('/forms/appointment/submit'), { timeout: 5000 })
    .catch(async () => {
      const left = await page.evaluate(() => ({
        focus: document.activeElement.outerHTML.slice(0, 120),
        alert: document.querySelector('[role=alert]')?.textContent,
      }));
      throw new Error(`no submission: ${JSON.stringify(left)}`);
    }),
  page.keyboard.press('Enter'),
]);
const sent = await response.json();
results.form.submitted = { status: response.status(), body: sent };
check('submit accepted by the BFF (201)', response.status() === 201, String(response.status()));
check(
  'stored values normalised: ASCII digits for identifiers, ISO date, Persian letters',
  sent.data?.nationalCode === '0012345678' &&
    sent.data?.mobile === '09121234567' &&
    sent.data?.birthDate === '1990-06-09' &&
    sent.data?.fullName === 'علی کریمی' &&
    sent.data?.description === 'پلاک ۱۲',
  JSON.stringify(sent.data),
);
const status = await page.locator('[role="status"]').textContent();
check('success announced in a status region', status === 'درخواست شما ثبت شد.', status);

// The BFF validates on its own and normalises a request that bypasses the browser.
const direct = await raw(
  'POST',
  FA,
  '/forms/appointment/submit',
  { origin: FA, 'sec-fetch-site': 'same-origin' },
  {
    fullName: 'كاظم',
    nationalCode: '١٢٣',
    mobile: '0912',
    birthDate: '1405/13/01',
    requestType: 'x',
    extra: 1,
  },
);
const directBody = direct.json();
check(
  'BFF rejects invalid data on its own (422 with ajv errors)',
  direct.status === 422 && directBody.errors.length >= 5,
  `${direct.status} ${directBody.errors?.map((e) => e.keyword).join(',')}`,
);
const cross = await raw(
  'POST',
  FA,
  '/forms/appointment/submit',
  { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' },
  {},
);
check('BFF refuses a cross-origin submission', cross.status === 403, String(cross.status));

// Errors view for the screenshot, and the en-CA form.
await page.goto(formUrl, { waitUntil: 'networkidle' });
await page.click('button[type="submit"]');
await page.keyboard.press('Tab');
await page.goto(`${EN}/forms/appointment`, { waitUntil: 'networkidle' });
const enForm = await page.evaluate(() => ({
  lang: document.documentElement.lang,
  dir: document.documentElement.dir,
  hint: document.querySelector('#field-visitDate')?.closest('div')?.parentElement?.textContent,
}));
check(
  'en-CA form: LTR, Gregorian hint with Latin digits',
  enForm.dir === 'ltr' && /\d{4}\/\d{2}\/\d{2}/.test(enForm.hint ?? ''),
  enForm.hint?.slice(0, 80),
);
await axe(page, 'en-CA form, initial');
await page.click('button[type="submit"]');
await axe(page, 'en-CA form, errors shown');
await page.focus('#field-visitDate');
await page.keyboard.press('Tab');
await page.keyboard.press('Enter');
await page.waitForSelector('[role="grid"]');
const enCal = await page.evaluate(() => ({
  firstWeekday: document.querySelector('[role="grid"] th')?.getAttribute('abbr'),
}));
await page.keyboard.press('ArrowRight');
const enRight = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
check(
  'en-CA calendar: week starts on Sunday; ArrowRight is the next day',
  enCal.firstWeekday === 'Sunday' && /^[A-Z][a-z]+ \d+, \d{4}$/.test(enRight ?? ''),
  `${enCal.firstWeekday}; ${enRight}`,
);
await axe(page, 'en-CA form, calendar open');

// ---------------------------------------------------------------- Puck editor in RTL
for (const ltr of ['0', '1']) {
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1440, height: 900 });
  await editor.goto(`${FA}/edit?ltr=${ltr}`, { waitUntil: 'networkidle' });
  await editor.waitForTimeout(1500);
  const frame = editor.frames().find((f) => f !== editor.mainFrame());
  const layout = await editor.evaluate(() => ({
    outerDir: document.documentElement.dir,
    sidebars: [...document.querySelectorAll('[class*="_Sidebar_"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        w: Math.round(r.width),
        text: el.textContent.trim().slice(0, 30),
      };
    }),
    nav: (() => {
      const r = document.querySelector('[class*="_PuckLayout-nav"]')?.getBoundingClientRect();
      return r && Math.round(r.x);
    })(),
    english: [...document.querySelectorAll('button, [class*="title"], label')]
      .map((el) =>
        (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim(),
      )
      .filter((t) => /^[A-Za-z][A-Za-z %{}#]+$/.test(t)),
  }));
  const frameInfo = await frame.evaluate(() => ({
    dir: document.documentElement.dir || '(none)',
    lang: document.documentElement.lang || '(none)',
    computed: getComputedStyle(document.body).direction,
  }));
  await frame.locator('h1').first().click();
  await editor.waitForTimeout(600);
  const href = await editor.evaluate(() => {
    const input = [...document.querySelectorAll('input')].find(
      (el) => el.value === '/forms/appointment',
    );
    return input
      ? { direction: getComputedStyle(input).direction, dirAttr: input.getAttribute('dir') }
      : null;
  });
  results.editor[`ltr=${ltr}`] = { ...layout, frame: frameInfo, ctaHref: href };
  console.log(`editor ltr=${ltr}`, JSON.stringify(results.editor[`ltr=${ltr}`]));
  if (ltr === '0') {
    check(
      'Puck: the preview iframe takes the host lang and dir (no override needed)',
      frameInfo.dir === 'rtl' && frameInfo.lang === 'fa-IR' && frameInfo.computed === 'rtl',
      JSON.stringify(frameInfo),
    );
    check(
      'Puck: editor chrome mirrors in RTL (component list on the right, fields on the left)',
      layout.sidebars.length === 2 && layout.sidebars[0].x > layout.sidebars[1].x,
      JSON.stringify(layout.sidebars),
    );
    check(
      'Puck default text field shows a URL right-to-left (bidi defect, needs an LTR field)',
      href?.direction === 'rtl',
      JSON.stringify(href),
    );
  } else {
    check(
      'Puck with the LTR custom field: URL input is left-to-right',
      href?.direction === 'ltr',
      JSON.stringify(href),
    );
    const title = editor.locator('input[name="title"]:visible').first();
    await title.fill('عنوان تازه با ارقام ۱۲۳ و حروف ي ك');
    await editor.waitForTimeout(600);
    const edited = await frame.evaluate(() => document.querySelector('h1')?.textContent);
    results.editor.editedTitle = edited;
    results.editor.fieldDirection = await title.evaluate((el) => getComputedStyle(el).direction);
    check(
      'Puck: editing a text field updates the RTL preview',
      edited?.startsWith('عنوان تازه'),
      String(edited),
    );
    check(
      'Puck: editor does not normalise ي/ك typed into a field (needs a field transform)',
      edited?.includes('ي ك'),
      String(edited),
    );
    check(
      'Puck: text fields inherit RTL',
      results.editor.fieldDirection === 'rtl',
      results.editor.fieldDirection,
    );
    // Keyboard reach of the editor chrome: how far Tab gets and whether a block can be added.
    await editor.evaluate(() => document.activeElement?.blur());
    const stops = [];
    for (let i = 0; i < 30; i += 1) {
      await editor.keyboard.press('Tab');
      stops.push(
        await editor.evaluate(() => {
          const el = document.activeElement;
          return `${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}`;
        }),
      );
    }
    results.editor.tabStops = stops;
    // Can a block be added from the drawer with the keyboard (dnd-kit keyboard sensor)?
    const headings = () => frame.evaluate(() => document.querySelectorAll('h1, h2').length);
    const before = await headings();
    const item = editor.locator('[data-testid="drawer-item:Hero"]');
    results.editor.drawerItem = await item.evaluate((el) => ({
      tabIndex: el.tabIndex,
      role: el.getAttribute('role'),
      roledescription: el.getAttribute('aria-roledescription'),
    }));
    for (const key of ['Enter', ' ']) {
      await item.focus();
      await editor.keyboard.press(key);
      for (const k of ['ArrowDown', 'ArrowDown', 'ArrowLeft']) await editor.keyboard.press(k);
      await editor.keyboard.press(key);
      await editor.waitForTimeout(400);
    }
    const after = await headings();
    results.editor.keyboardInsert = { before, after };
    check(
      'Puck defect confirmed: a block cannot be added from the drawer with the keyboard',
      after === before,
      `${before} -> ${after}`,
    );
    results.editor.untranslated = layout.english;
    await editor.screenshot({ path: path.join(ASSETS, '04-puck-editor-rtl.png') });
    await axe(editor, 'Puck editor (fa-IR), outer document');
  }
  await editor.close();
}

// JavaScript shipped per page (compressed transfer size of script resources).
results.javascript = {};
for (const [label, url] of [['fa-IR home (static, ISR)', FA], ['fa-IR form', `${FA}/forms/appointment`], ['Puck editor', `${FA}/edit`]]) {
  const probe = await context.newPage();
  await probe.goto(url, { waitUntil: 'networkidle' });
  results.javascript[label] = await probe.evaluate(() =>
    Math.round(
      performance
        .getEntriesByType('resource')
        .filter((r) => r.initiatorType === 'script' || r.name.endsWith('.js'))
        .reduce((sum, r) => sum + (r.transferSize || r.encodedBodySize), 0) / 1024,
    ),
  );
  await probe.close();
}
console.log('JS kB (compressed):', JSON.stringify(results.javascript));

await browser.close();
results.summary = {
  checks: results.checks.length,
  failed: results.checks.filter((c) => !c.pass).map((c) => c.name),
  axeViolationRules: results.axe.reduce((s, a) => s + a.violations.length, 0),
};
writeFileSync(path.join(ASSETS, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(
  `\n${results.checks.length} checks, ${results.summary.failed.length} failed; axe violations (rules, all pages): ${results.summary.axeViolationRules}`,
);
