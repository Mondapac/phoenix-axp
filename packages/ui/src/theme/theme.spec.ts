import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { contrastFailures, resolveTheme, themeStylesheet, type SiteTheme } from './theme.ts';

const platform = JSON.parse(
  readFileSync(new URL('./platform-default.json', import.meta.url), 'utf8'),
) as SiteTheme;
const ministry: SiteTheme = {
  siteId: 'ministry',
  tokens: { 'color.brand': '#0b5c4a', 'color.accent': '#0b5c4a', 'color.link': '#0b5c4a' },
  locked: ['color.brand'],
};
const province: SiteTheme = {
  siteId: 'province',
  tokens: { 'color.accent': '#7a3b00', 'color.brand': '#ff0000', 'color.evil': '#000000' },
};

describe('site theme inheritance', () => {
  it('inherits from the parent, overrides what is open and refuses a locked token', () => {
    const theme = resolveTheme([platform, ministry, province]);
    assert.equal(theme.tokens['color.accent'], '#7a3b00');
    assert.equal(theme.source['color.accent'], 'province');
    assert.equal(theme.tokens['color.link'], '#0b5c4a'); // inherited from the parent
    assert.equal(theme.source['color.link'], 'ministry');
    assert.equal(theme.tokens['color.page'], '#f7f7f5'); // from the platform default
    assert.equal(theme.tokens['color.brand'], '#0b5c4a'); // locked by the parent
    assert.equal(theme.lockedBy['color.brand'], 'ministry');
    assert.deepEqual(theme.refused, [
      { siteId: 'province', token: 'color.brand', reason: 'locked' },
      { siteId: 'province', token: 'color.evil', reason: 'unknown' },
    ]);
  });

  it('a lock binds descendants, not the site that sets it', () => {
    const theme = resolveTheme([platform, ministry]);
    assert.equal(theme.tokens['color.brand'], '#0b5c4a');
    assert.deepEqual(theme.refused, []);
  });

  it('refuses a value that is not of the token kind (no CSS injection through a token)', () => {
    const theme = resolveTheme([
      platform,
      { siteId: 'x', tokens: { 'color.page': 'red;} body{display:none' } },
    ]);
    assert.equal(theme.tokens['color.page'], '#f7f7f5');
    assert.equal(theme.refused[0]?.reason, 'invalid');
    assert.ok(!themeStylesheet(theme).includes('display'));
  });

  it('the platform default and the fixtures pass WCAG AA contrast; a bad pair is reported', () => {
    assert.deepEqual(contrastFailures(resolveTheme([platform])), []);
    assert.deepEqual(contrastFailures(resolveTheme([platform, ministry, province])), []);
    const bad = resolveTheme([platform, { siteId: 'y', tokens: { 'color.fg-muted': '#aaaaaa' } }]);
    assert.deepEqual(
      contrastFailures(bad).map((pair) => pair.fg),
      ['color.fg-muted', 'color.fg-muted'],
    );
  });

  it('checks the two-tone focus ring on every background a control sits on', () => {
    const pale = resolveTheme([
      platform,
      { siteId: 'z', tokens: { 'color.brand': '#f0f0f0', 'color.focus': '#e0e0e0' } },
    ]);
    const rings = contrastFailures(pale).filter((pair) => pair.fg === 'focus ring');
    assert.deepEqual(
      rings.map((pair) => pair.bg),
      ['color.page', 'color.surface', 'color.subtle', 'color.brand'],
    );
    // The default ring passes on the dark brand header thanks to the surface halo.
    assert.deepEqual(
      contrastFailures(resolveTheme([platform, ministry])).filter((p) => p.fg === 'focus ring'),
      [],
    );
  });
});
