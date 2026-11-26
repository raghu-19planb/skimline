import assert from 'node:assert/strict';
import test from 'node:test';
import { bearing, coord, escapeHtml, fmt, html, longDate, monthYear, pct, raw } from '../src/plan/format.ts';

test('numbers get separators and a fixed count of decimals', () => {
  assert.equal(fmt(1852), '1,852');
  assert.equal(fmt(5.04, 1), '5.0');
  assert.equal(pct(0.416), '42%');
});

test('coordinates are latitude first with hemisphere letters', () => {
  assert.equal(coord(42.135, 1.878), '42.13500° N, 1.87800° E');
  assert.equal(coord(-33.9, -70.65), '33.90000° S, 70.65000° W');
});

test('dates are read as UTC calendar days', () => {
  assert.equal(monthYear('2023-04-02'), 'Apr 2023');
  assert.equal(longDate('2023-04-02'), 'April 2, 2023');
  assert.equal(monthYear('2023-01-01'), 'Jan 2023', 'the first of a month must not slip into the month before');
});

test('bearings are three digits', () => {
  assert.equal(bearing(7), '007°');
  assert.equal(bearing(161.6), '162°');
});

test('escapeHtml neutralises every character that can open markup', () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')"> & co`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt; &amp; co');
});

test('html escapes interpolated text, such as a place name from open data', () => {
  const hostile = '<script>alert(1)</script>';
  assert.equal(html`<b>${hostile}</b>`.value, '<b>&lt;script&gt;alert(1)&lt;/script&gt;</b>');
});

test('html leaves its own markup and raw markup intact, and flattens lists', () => {
  const items = ['a', 'b'].map((x) => html`<li>${x}</li>`);
  assert.equal(html`<ul>${items}</ul>`.value, '<ul><li>a</li><li>b</li></ul>');
  assert.equal(html`<p>${raw('<i>ok</i>')}</p>`.value, '<p><i>ok</i></p>');
});

test('html renders numbers and drops null, undefined and false', () => {
  assert.equal(html`${3}${null}${undefined}${false}${''}!`.value, '3!');
});
