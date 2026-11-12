/**
 * charts.js
 * Lightweight chart builders that return SVG / HTML strings.
 * No charting library is used: shapes are calculated with plain maths.
 */
import { escapeHTML, formatNumber, percent } from '../utils.js';

/**
 * Circular progress ring.
 * @param {number} value 0-100
 */
export function progressRing(value, { size = 120, stroke = 10, label = '', sublabel = '', category = '', className = '' } = {}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const safeValue = Math.min(Math.max(Number(value) || 0, 0), 100);
  const offset = circumference * (1 - safeValue / 100);
  const categoryAttr = category ? `data-category="${escapeHTML(category)}"` : '';
  return `
    <div class="ring ${className}" role="img" aria-label="${escapeHTML(sublabel || 'Progress')}: ${safeValue}%" ${categoryAttr}>
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
        <circle class="ring__track" cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke-width="${stroke}"></circle>
        <circle class="ring__value" cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke-width="${stroke}"
          stroke-linecap="round" stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>
      </svg>
      <span class="ring__label"><strong>${escapeHTML(label || `${safeValue}%`)}</strong>${sublabel ? `<span>${escapeHTML(sublabel)}</span>` : ''}</span>
    </div>`;
}

/** Native progress bar with an accessible label. */
export function progressBar(value, max, label, { large = false } = {}) {
  const safeMax = Math.max(Number(max) || 1, 1);
  const safeValue = Math.min(Math.max(Number(value) || 0, 0), safeMax);
  const complete = safeValue >= safeMax;
  return `<progress class="progress ${large ? 'progress--lg' : ''}" value="${safeValue}" max="${safeMax}" data-complete="${complete}" aria-label="${escapeHTML(label)}">${percent(safeValue, safeMax)}%</progress>`;
}

/**
 * Vertical bar chart.
 * @param {Array<{label: string, value: number, highlight?: boolean, title?: string}>} data
 */
export function barChart(data, { height = 180, title = 'Bar chart', valueSuffix = '' } = {}) {
  if (!data.length) return '';
  const width = 420;
  const padTop = 22;
  const padBottom = 26;
  const chartHeight = height - padTop - padBottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  const slot = width / data.length;
  const barWidth = Math.min(36, slot * 0.58);

  const gridLines = [0, 0.5, 1]
    .map((ratio) => {
      const y = padTop + chartHeight * (1 - ratio);
      return `<line class="grid-line" x1="0" x2="${width}" y1="${y}" y2="${y}"></line>`;
    })
    .join('');

  const bars = data
    .map((d, index) => {
      const barHeight = Math.max(d.value > 0 ? 4 : 0, (d.value / max) * chartHeight);
      const x = index * slot + (slot - barWidth) / 2;
      const y = padTop + chartHeight - barHeight;
      const tooltip = d.title || `${d.label}: ${formatNumber(d.value)}${valueSuffix}`;
      return `
        <g>
          <title>${escapeHTML(tooltip)}</title>
          <rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="7" data-highlight="${Boolean(d.highlight)}"></rect>
          ${d.value > 0 ? `<text class="value-label" x="${(x + barWidth / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle">${formatNumber(d.value)}</text>` : ''}
          <text x="${(x + barWidth / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle">${escapeHTML(d.label)}</text>
        </g>`;
    })
    .join('');

  const summary = data.map((d) => `${d.label} ${formatNumber(d.value)}${valueSuffix}`).join(', ');
  return `
    <figure class="chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(title)}. ${escapeHTML(summary)}">${gridLines}${bars}</svg>
    </figure>`;
}

/**
 * Line / area chart for trends.
 * @param {Array<{label: string, value: number}>} data
 */
export function lineChart(data, { height = 200, width = 560, title = 'Trend', labelEvery = 1 } = {}) {
  if (!data.length) return '';
  const pad = { top: 20, right: 12, bottom: 26, left: 34 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  const niceMax = Math.ceil(max / 10) * 10 || 10;
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;

  const points = data.map((d, i) => ({
    x: pad.left + i * step,
    y: pad.top + innerH * (1 - d.value / niceMax),
    ...d,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)} ${pad.top + innerH} L${pad.left} ${pad.top + innerH} Z`;

  const grid = [0, 0.5, 1]
    .map((ratio) => {
      const y = pad.top + innerH * (1 - ratio);
      return `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}"></line>
              <text x="${pad.left - 8}" y="${y + 4}" text-anchor="end">${formatNumber(niceMax * ratio)}</text>`;
    })
    .join('');

  const labels = points
    .filter((_, i) => i % labelEvery === 0 || i === points.length - 1)
    .map((p) => `<text x="${p.x.toFixed(1)}" y="${height - 6}" text-anchor="middle">${escapeHTML(p.label)}</text>`)
    .join('');

  const dots = points
    .map((p) => `<circle class="dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5"><title>${escapeHTML(`${p.title || p.label}: ${formatNumber(p.value)}`)}</title></circle>`)
    .join('');

  return `
    <figure class="chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(title)}">
        <defs>
          <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#c9a874" stop-opacity="0.4"></stop>
            <stop offset="1" stop-color="#c9a874" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        ${grid}
        <path class="area" d="${areaPath}"></path>
        <path class="line" d="${linePath}"></path>
        ${dots}
        ${labels}
      </svg>
    </figure>`;
}

/** Category colours as hex for SVG fills (CSS variables cannot be read by SVG attributes everywhere). */
const CATEGORY_FILL = {
  movement: '#b0603f',
  hydration: '#3f6f8c',
  mindfulness: '#75628f',
  'healthy-habits': '#5b7a55',
  'daily-wellness': '#c9a874',
};

/**
 * Donut chart with legend.
 * @param {Array<{category: string, label: string, count: number}>} data
 */
export function donutChart(data, { title = 'Distribution', centerLabel = 'total' } = {}) {
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const size = 180;
  const radius = 70;
  const stroke = 26;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const segments = total === 0
    ? `<circle class="ring__track" cx="90" cy="90" r="${radius}" fill="none" stroke-width="${stroke}"></circle>`
    : data
      .filter((d) => d.count > 0)
      .map((d) => {
        const length = (d.count / total) * circumference;
        const segment = `<circle cx="90" cy="90" r="${radius}" fill="none" stroke="${CATEGORY_FILL[d.category] || '#c9c1b4'}" stroke-width="${stroke}"
            stroke-dasharray="${Math.max(length - 2, 0.1).toFixed(2)} ${circumference.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"
            transform="rotate(-90 90 90)"><title>${escapeHTML(`${d.label}: ${d.count}`)}</title></circle>`;
        offset += length;
        return segment;
      })
      .join('');

  const legend = data
    .map((d) => `<li data-category="${escapeHTML(d.category)}"><span class="cluster"><span class="swatch"></span>${escapeHTML(d.label)}</span><strong>${formatNumber(d.count)} <span class="muted small">(${percent(d.count, total)}%)</span></strong></li>`)
    .join('');

  return `
    <div class="donut-wrap">
      <figure class="chart">
        <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHTML(title)}: ${data.map((d) => `${d.label} ${d.count}`).join(', ')}">
          ${segments}
          <text x="90" y="88" text-anchor="middle" class="value-label" font-size="26">${formatNumber(total)}</text>
          <text x="90" y="108" text-anchor="middle">${escapeHTML(centerLabel)}</text>
        </svg>
      </figure>
      <ul class="chart-legend">${legend}</ul>
    </div>`;
}

/**
 * Horizontal bars (labelled list) — good for comparisons with long names.
 * @param {Array<{label: string, value: number, max: number, display?: string}>} data
 */
export function horizontalBars(data) {
  return `
    <ul class="hbar-list">
      ${data
        .map(
          (d) => `
        <li>
          <div class="split"><span>${escapeHTML(d.label)}</span><strong>${escapeHTML(d.display || formatNumber(d.value))}</strong></div>
          ${progressBar(d.value, d.max, d.label)}
        </li>`,
        )
        .join('')}
    </ul>`;
}
