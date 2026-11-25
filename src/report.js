// Client PDF report: cover, summary charts, marked-up plans, door schedule,
// and one page per door with checklist, defects, actions and photos.
// Built entirely on the phone (works offline once the library is cached).

import * as db from './db.js';
import { STATUSES, statusById, doorActions, materialsTotal, euro, questionsFor, useScheme, isInspected, statusesInUse, matLabel, zoneText } from './defaults.js';
import { loadScript, saveFile, safeName, compressImage } from './files.js';
import { isVideo, fmtDuration } from './media.js';
import { photoInView } from './history.js';
import { fmtDate } from './ui.js';

const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const AUTOTABLE = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';

// Print palette (light, fixed — a PDF has no dark mode)
const C = {
  ink: [21, 33, 44],
  ink2: [76, 92, 107],
  muted: [120, 133, 145],
  line: [213, 220, 227],
  soft: [243, 245, 247],
  accent: [179, 38, 30],
  bar: [61, 90, 115], // single-series bars: one neutral ink-blue
};
const STATUS_RGB = {
  not_inspected: [91, 104, 117], // drawn hollow on plans
  na: [154, 166, 177],
  pass: [46, 133, 64],
  fail: [204, 42, 31],
  no_access: [217, 138, 0],
  repaired: [33, 102, 196],
};
// Fill used for "not inspected" in the pie and legend (pins are hollow)
const TODO_FILL = [214, 220, 226];
const fillFor = (id) => (id === 'not_inspected' ? TODO_FILL : STATUS_RGB[id]);

const A4 = { w: 210, h: 297 };
const M = 16; // page margin, mm
const CW = A4.w - M * 2; // content width

// Standard PDF fonts only cover Western European characters; swap the rest.
function t(s) {
  return String(s ?? '')
    .replace(/[≥]/g, '>=')
    .replace(/[≤]/g, '<=')
    .replace(/[   ]/g, ' ')
    .replace(/[^\u0000-ÿ€‘’“”–—•…×]/g, '?');
}

const rgbCss = (c) => `rgb(${c.join(',')})`;

async function loadJsPdf() {
  await loadScript(JSPDF);
  await loadScript(AUTOTABLE);
  return window.jspdf.jsPDF;
}

async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

// Shrink a photo for the report so the PDF stays a sensible size
async function reportImage(blob, maxSide = 1000, q = 0.72) {
  const r = await compressImage(blob, maxSide, q);
  return { data: await blobBytes(r.blob), w: r.width, h: r.height };
}

async function loadBitmap(blob) {
  if (window.createImageBitmap) return createImageBitmap(blob);
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  return img;
}

function drawPin(g, x, y, r, color, label, hollow = false) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = hollow ? rgbCss(color) : '#fff';
  g.fill();
  g.beginPath();
  g.arc(x, y, r * (hollow ? 0.8 : 0.84), 0, Math.PI * 2);
  g.fillStyle = hollow ? '#fff' : rgbCss(color);
  g.fill();
  g.fillStyle = hollow ? rgbCss(C.ink) : '#fff';
  g.font = `700 ${Math.round(r * (String(label).length > 2 ? 0.8 : 1.05))}px Helvetica, Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(label), x, y + r * 0.05);
}

function canvasJpeg(c, q = 0.85) {
  return new Promise((res) => c.toBlob(async (b) => res(await blobBytes(b)), 'image/jpeg', q));
}

// Whole plan with every pin drawn on it
async function planWithPins(plan, doors) {
  const bmp = await loadBitmap(plan.blob);
  const scale = Math.min(1, 2400 / Math.max(plan.width, plan.height));
  const c = document.createElement('canvas');
  c.width = Math.round(plan.width * scale);
  c.height = Math.round(plan.height * scale);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const r = Math.max(16, Math.max(c.width, c.height) * 0.016);
  for (const d of doors) {
    const st = d.status || 'not_inspected';
    drawPin(g, d.x * c.width, d.y * c.height, r, STATUS_RGB[st], d.pinNo, st === 'not_inspected');
  }
  return { bmp, data: await canvasJpeg(c), w: c.width, h: c.height };
}

// Close-up of the plan around one door, for the door's page
async function planCrop(bmp, plan, door) {
  const cw = Math.round(Math.min(plan.width, plan.height) * 0.42);
  const ch = Math.round(cw * 0.75);
  const cx = Math.min(Math.max(0, door.x * plan.width - cw / 2), Math.max(0, plan.width - cw));
  const cy = Math.min(Math.max(0, door.y * plan.height - ch / 2), Math.max(0, plan.height - ch));
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 480;
  const k = c.width / cw;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, cx, cy, cw, ch, 0, 0, c.width, c.height);
  const st = door.status || 'not_inspected';
  drawPin(g, (door.x * plan.width - cx) * k, (door.y * plan.height - cy) * k, 28, STATUS_RGB[st], door.pinNo, st === 'not_inspected');
  return canvasJpeg(c, 0.82);
}

// Pie (donut) of door status. White gaps between slices; every slice is
// named with its count and % in the legend beside it, so colour is never
// the only cue.
function donutPng(parts, sizePx = 600) {
  const c = document.createElement('canvas');
  c.width = c.height = sizePx;
  const g = c.getContext('2d');
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const cx = sizePx / 2;
  const R = sizePx / 2 - 6;
  const r = R * 0.56;
  let a = -Math.PI / 2;
  for (const p of parts) {
    if (!p.value) continue;
    const sweep = (p.value / total) * Math.PI * 2;
    g.beginPath();
    g.arc(cx, cx, R, a, a + sweep);
    g.arc(cx, cx, r, a + sweep, a, true);
    g.closePath();
    g.fillStyle = rgbCss(p.color);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#fff';
    g.stroke();
    a += sweep;
  }
  return c.toDataURL('image/png');
}

export async function exportProjectPdf(project, lists, opts = {}, onProgress = () => {}) {
  const { photos: withPhotos = true, passDetail = true, costs = false } = opts;
  onProgress('Loading PDF tools…');
  const jsPDF = await loadJsPdf();
  const scheme = useScheme(project);
  const ANSWER_TXT = scheme.answers;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setFont('helvetica', 'normal');

  const doors = opts.doors || (await db.projectDoors(project.id)).map((d) => ({ ...d, _current: true }));
  // only drawings in the collection being reported, and only those with doors in the report
  const plans = (opts.plans || (await db.projectPlans(project.id))).filter((pl) => !opts.doors || doors.some((d) => d.planId === pl.id));
  const planById = Object.fromEntries(plans.map((p) => [p.id, p]));
  const questions = (lists.questions || []).filter((q) => q.text?.trim());
  const inspector = lists.inspector || [...new Set(doors.map((d) => d.inspectedBy).filter(Boolean))].join(', ');
  const reportDate = new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });

  const counts = Object.fromEntries(STATUSES.map((s) => [s.id, 0]));
  for (const d of doors) counts[d.status || 'not_inspected'] = (counts[d.status || 'not_inspected'] || 0) + 1;
  const inspected = doors.filter(isInspected);
  const pct = (n, of) => (of ? Math.round((n / of) * 100) : 0);

  // ---------- helpers ----------
  let y = M;
  const text = (s, x, yy, o = {}) => doc.text(t(s), x, yy, o);
  const setC = (c) => doc.setTextColor(...c);
  const font = (style, size, color = C.ink) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    setC(color);
  };
  const newPage = () => {
    doc.addPage();
    y = M + 10; // room for running header
  };
  const ensure = (h) => {
    if (y + h > A4.h - M - 8) newPage();
  };
  const heading = (s, sub) => {
    ensure(18);
    font('bold', 15);
    text(s, M, y + 5);
    y += 8;
    if (sub) {
      font('normal', 9.5, C.ink2);
      const lines = doc.splitTextToSize(t(sub), CW);
      doc.text(lines, M, y + 3);
      y += lines.length * 4.4 + 1;
    }
    y += 3;
  };
  const para = (s, size = 10, color = C.ink, w = CW, x = M) => {
    font('normal', size, color);
    const lines = doc.splitTextToSize(t(s), w);
    ensure(lines.length * size * 0.45);
    doc.text(lines, x, y + size * 0.35);
    y += lines.length * size * 0.45 + 1.5;
  };
  const statusChip = (st, x, yy) => {
    const label = statusById[st].label;
    font('bold', 9, [255, 255, 255]);
    const w = doc.getTextWidth(label) + 6;
    doc.setFillColor(...STATUS_RGB[st]);
    doc.roundedRect(x, yy - 4, w, 6, 3, 3, 'F');
    text(label, x + 3, yy);
    return w;
  };

  // Horizontal bar chart drawn as vector shapes: thin bars from a square
  // baseline with a rounded end, recessive gridlines, value at the bar end.
  const barChart = (rows, { max = 100, unit = '%', labelW = 78 } = {}) => {
    const barH = 4.2;
    const gap = 2.6;
    const plotX = M + labelW;
    const plotW = CW - labelW - 16;
    ensure(rows.length * (barH + gap) + 12);
    const top = y;
    const h = rows.length * (barH + gap);
    // gridlines + ticks
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.2);
    font('normal', 7.5, C.muted);
    for (let i = 0; i <= 4; i++) {
      const gx = plotX + (plotW * i) / 4;
      doc.line(gx, top - 1, gx, top + h);
      text(`${Math.round((max * i) / 4)}${unit}`, gx, top + h + 4, { align: 'center' });
    }
    rows.forEach((r, i) => {
      const by = top + i * (barH + gap);
      font('normal', 8.5, C.ink);
      const lab = doc.splitTextToSize(t(r.label), labelW - 4);
      text(lab.length > 1 ? lab[0].replace(/\s*$/, '…') : lab[0], M, by + barH * 0.78);
      const w = Math.max(0, (r.value / max) * plotW);
      if (w > 0) {
        doc.setFillColor(...(r.color || C.bar));
        const rad = Math.min(0.9, w / 2);
        doc.roundedRect(plotX, by, w, barH, rad, rad, 'F');
        doc.rect(plotX, by, Math.max(0, w - rad), barH, 'F'); // keep the baseline end square
      }
      font('bold', 8.5, C.ink);
      text(r.display, plotX + w + 1.8, by + barH * 0.78);
    });
    y = top + h + 9;
  };

  // ---------- 1. Cover ----------
  onProgress('Building cover and summary…');
  doc.setFillColor(...C.accent);
  doc.rect(0, 0, A4.w, 64, 'F');
  font('bold', 12, [255, 255, 255]);
  text('FSCF IRELAND', M, 22);
  font('normal', 9.5, [255, 225, 222]);
  text('Fire door inspection · remedial works · fire stopping', M, 28);
  font('bold', 26, [255, 255, 255]);
  text('Fire Door Inspection Report', M, 50);

  y = 84;
  font('bold', 20);
  doc.text(doc.splitTextToSize(t(project.site || 'Site'), CW), M, y);
  y += 9 * doc.splitTextToSize(t(project.site || 'Site'), CW).length + 2;
  const coverRows = [
    ['Client', project.client],
    ['Address', project.address],
    ['Inspection date', fmtDate(project.date)],
    ['Inspected by', inspector],
    ['Report date', reportDate],
    ['Report covers', opts.filterText ? `${doors.length} doors: ${opts.filterText}` : ''],
  ].filter((r) => r[1]);
  for (const [k, v] of coverRows) {
    font('normal', 10, C.ink2);
    text(k, M, y);
    font('normal', 11, C.ink);
    const lines = doc.splitTextToSize(t(v), CW - 42);
    doc.text(lines, M + 42, y);
    y += Math.max(7, lines.length * 5 + 2);
  }

  // headline figures
  y += 8;
  const tiles = [
    ['Doors surveyed', doors.length, C.ink],
    [statusById.pass.label, counts.pass || 0, STATUS_RGB.pass],
    [statusById.fail.label, counts.fail || 0, STATUS_RGB.fail],
    [statusById.no_access.label, counts.no_access || 0, STATUS_RGB.no_access],
  ];
  const tw = (CW - 3 * 4) / 4;
  tiles.forEach(([label, n, col], i) => {
    const x = M + i * (tw + 4);
    doc.setFillColor(...C.soft);
    doc.roundedRect(x, y, tw, 26, 2, 2, 'F');
    doc.setFillColor(...col);
    doc.rect(x, y, 1.6, 26, 'F');
    font('bold', 22, C.ink);
    text(String(n), x + 6, y + 13);
    font('normal', 9, C.ink2);
    text(label, x + 6, y + 21);
  });
  y += 34;
  if (inspected.length) {
    para(
      scheme.summary(counts.fail || 0, inspected.length, pct(counts.fail || 0, inspected.length)) +
        (counts.no_access ? ` ${counts.no_access} door(s) could not be accessed.` : '') +
        (counts.na ? ` ${counts.na} door(s) were not applicable.` : '') +
        (counts.not_inspected ? ` ${counts.not_inspected} door(s) are not yet inspected.` : ''),
      11
    );
  }
  font('normal', 8.5, C.muted);
  doc.text(
    doc.splitTextToSize(
      'Inspection is visual and non-destructive. Fire resistance classifications refer to I.S. EN 13501-2 (tested to I.S. EN 1634-1; smoke control to I.S. EN 1634-3). Findings reflect the condition of each door set on the date of inspection.',
      CW
    ),
    M,
    A4.h - M - 6
  );

  // ---------- 2. Summary charts ----------
  newPage();
  heading('Summary of findings', `${doors.length} door sets recorded across ${plans.length} plan(s).`);

  // Status pie + legend table
  const parts = statusesInUse(doors).map((s) => ({ label: s.label, value: counts[s.id] || 0, color: fillFor(s.id), id: s.id })).filter((p) => p.value);
  font('bold', 11);
  text('Door status', M, y + 3);
  y += 6;
  if (parts.length) {
    const size = 62;
    doc.addImage(donutPng(parts), 'PNG', M, y, size, size);
    font('bold', 16);
    text(`${pct(counts.fail || 0, inspected.length)}%`, M + size / 2, y + size / 2 + 1, { align: 'center' });
    font('normal', 7.5, C.ink2);
    text(scheme.rateLabel, M + size / 2, y + size / 2 + 5.5, { align: 'center' });
    let ly = y + 8;
    const lx = M + size + 12;
    font('bold', 8.5, C.ink2);
    text('Status', lx + 7, ly);
    text('Doors', lx + 62, ly, { align: 'right' });
    text('% of all', lx + 84, ly, { align: 'right' });
    ly += 3;
    doc.setDrawColor(...C.line);
    doc.line(lx, ly, lx + 86, ly);
    ly += 6;
    for (const p of parts) {
      doc.setFillColor(...p.color);
      doc.roundedRect(lx, ly - 3.4, 4, 4, 0.8, 0.8, 'F');
      font('normal', 10, C.ink);
      text(p.label, lx + 7, ly);
      font('bold', 10, C.ink);
      text(String(p.value), lx + 62, ly, { align: 'right' });
      font('normal', 10, C.ink2);
      text(`${pct(p.value, doors.length)}%`, lx + 84, ly, { align: 'right' });
      ly += 7.5;
    }
    y += size + 10;
  }

  // Failure rate per checklist question
  const answeredQs = questions
    .map((q) => {
      const ans = doors.map((d) => d.checks?.[q.id]?.answer).filter((a) => a === 'pass' || a === 'fail');
      const fails = ans.filter((a) => a === 'fail').length;
      return { label: q.text, fails, of: ans.length };
    })
    .filter((r) => r.of);
  if (answeredQs.length) {
    font('bold', 11);
    ensure(answeredQs.length * 7 + 20);
    text(scheme.checkChart, M, y + 3);
    font('normal', 8.5, C.ink2);
    text(scheme.checkChartSub, M, y + 8);
    y += 13;
    barChart(
      answeredQs.map((r) => ({ label: r.label, value: pct(r.fails, r.of), display: `${pct(r.fails, r.of)}%  (${r.fails}/${r.of})` })),
      { max: 100, unit: '%' }
    );
  }

  // Defects by type
  const defectCounts = {};
  for (const d of doors) for (const x of d.defects || []) defectCounts[x.label] = (defectCounts[x.label] || 0) + 1;
  const defectRows = Object.entries(defectCounts).sort((a, b) => b[1] - a[1]);
  if (defectRows.length) {
    const top = defectRows.slice(0, 12);
    const maxD = Math.max(...top.map(([, n]) => n));
    const niceMax = Math.max(4, Math.ceil(maxD / 4) * 4);
    ensure(top.length * 7 + 22);
    font('bold', 11);
    text('Most common defects', M, y + 3);
    font('normal', 8.5, C.ink2);
    text(`Number of doors with each defect${defectRows.length > 12 ? ' (top 12)' : ''}`, M, y + 8);
    y += 13;
    barChart(
      top.map(([label, n]) => ({ label, value: n, display: `${n}  (${pct(n, doors.length)}% of doors)` })),
      { max: niceMax, unit: '' }
    );
  }

  // ---------- 3. Plans ----------
  const planBitmaps = {};
  for (const plan of plans) {
    onProgress(`Marking up ${plan.name}…`);
    const pd = doors.filter((d) => d.planId === plan.id);
    const img = await planWithPins(plan, pd);
    planBitmaps[plan.id] = img.bmp;
    const landscape = img.w > img.h * 1.1;
    doc.addPage('a4', landscape ? 'landscape' : 'portrait');
    const pw = landscape ? A4.h : A4.w;
    const ph = landscape ? A4.w : A4.h;
    y = M + 10;
    font('bold', 14);
    text(`Plan: ${plan.name}`, M, y + 4);
    font('normal', 9, C.ink2);
    text(`${pd.length} door(s) pinned`, M, y + 9);
    y += 13;
    const maxW = pw - M * 2;
    const maxH = ph - y - M - 14;
    const k = Math.min(maxW / img.w, maxH / img.h);
    const iw = img.w * k;
    const ih = img.h * k;
    doc.setDrawColor(...C.line);
    doc.rect(M, y, iw, ih);
    doc.addImage(img.data, 'JPEG', M, y, iw, ih, undefined, 'FAST');
    // legend
    let lx = M;
    const ly = y + ih + 7;
    for (const s of STATUSES) {
      doc.setFillColor(...(s.id === 'not_inspected' ? [255, 255, 255] : STATUS_RGB[s.id]));
      doc.setDrawColor(...STATUS_RGB[s.id]);
      doc.setLineWidth(0.5);
      doc.circle(lx + 2, ly - 1.2, 1.8, s.id === 'not_inspected' ? 'FD' : 'F');
      font('normal', 8.5, C.ink);
      text(s.label, lx + 5.5, ly);
      lx += doc.getTextWidth(s.label) + 12;
    }
  }

  // ---------- 4. Door schedule ----------
  doc.addPage('a4', 'portrait');
  y = M + 10;
  heading('Door schedule', 'Every door recorded, in pin order. Pin numbers match the marked-up plans.');
  const showCosts = costs;
  const head = [['Pin', 'Door ref', 'Location', 'Plan', 'Door type', 'FA zone', 'Status', 'Defects', 'Recommended actions', ...(showCosts ? ['Materials'] : [])]];
  const body = doors.map((d) => [
    String(d.pinNo ?? ''), t(d.ref), t(d.location), t(planById[d.planId]?.name), t(d.doorType), t(zoneText(d).replace(/^Zone /, '')),
    statusById[d.status || 'not_inspected'].label, String((d.defects || []).length || ''), t(doorActions(d).join('; ')),
    ...(showCosts ? [materialsTotal(d) ? t(euro(materialsTotal(d))) : ''] : []),
  ]);
  doc.autoTable({
    head, body, startY: y, margin: { left: M, right: M, top: M + 10 },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, textColor: C.ink, lineColor: C.line, lineWidth: 0.15 },
    headStyles: { fillColor: C.ink, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: C.soft },
    columnStyles: { 0: { cellWidth: 9, halign: 'center', fontStyle: 'bold' }, 6: { fontStyle: 'bold' }, 7: { halign: 'center', cellWidth: 13 } },
    didParseCell: (h) => {
      if (h.section === 'body' && h.column.index === 6) {
        const st = doors[h.row.index].status || 'not_inspected';
        h.cell.styles.textColor = STATUS_RGB[st];
      }
    },
  });
  if (showCosts) {
    const tot = doors.reduce((a, d) => a + materialsTotal(d), 0);
    y = doc.lastAutoTable.finalY + 6;
    font('bold', 10);
    text(`Materials total: ${euro(tot)} ex VAT`, A4.w - M, y, { align: 'right' });
  }

  // ---------- 5. Door pages ----------
  const detailDoors = doors.filter((d) => passDetail || !['pass', 'na'].includes(d.status || 'not_inspected'));
  let n = 0;
  for (const d of detailDoors) {
    n++;
    onProgress(`Door pages ${n} of ${detailDoors.length}…`);
    newPage();
    const st = d.status || 'not_inspected';
    // header band
    doc.setFillColor(...C.soft);
    doc.roundedRect(M, y, CW, 20, 2, 2, 'F');
    const hollow = st === 'not_inspected';
    doc.setFillColor(...(hollow ? [255, 255, 255] : STATUS_RGB[st]));
    doc.setDrawColor(...STATUS_RGB[st]);
    doc.setLineWidth(0.8);
    doc.circle(M + 10, y + 10, 6.5, hollow ? 'FD' : 'F');
    font('bold', String(d.pinNo).length > 2 ? 9 : 12, hollow ? C.ink : [255, 255, 255]);
    text(String(d.pinNo ?? ''), M + 10, y + 11.8, { align: 'center' });
    font('bold', 14);
    text(d.ref || `Door ${d.pinNo}`, M + 21, y + 8.5);
    font('normal', 9.5, C.ink2);
    text([d.location, planById[d.planId]?.name].filter(Boolean).join(' · '), M + 21, y + 14.5);
    statusChip(st, A4.w - M - 4 - (doc.getTextWidth(statusById[st].label) + 6), y + 11.5);
    y += 25;

    // details + plan close-up side by side
    const detailRows = [
      ['Door type', d.doorType], ['Leaf configuration', d.leaf], ['Fire alarm zone', zoneText(d)],
      ['Inspected on', fmtDate(d.inspectedOn)], ['Inspected by', d.inspectedBy],
    ].filter((r) => r[1]);
    const cropW = 70;
    const cropH = 52.5;
    const plan = planById[d.planId];
    const startY = y;
    if (plan && planBitmaps[plan.id]) {
      const crop = await planCrop(planBitmaps[plan.id], plan, d);
      doc.addImage(crop, 'JPEG', A4.w - M - cropW, y, cropW, cropH, undefined, 'FAST');
      doc.setDrawColor(...C.line);
      doc.rect(A4.w - M - cropW, y, cropW, cropH);
      font('normal', 7.5, C.muted);
      text('Location on plan', A4.w - M - cropW, y + cropH + 4);
    }
    const leftW = CW - cropW - 6;
    for (const [k, v] of detailRows) {
      font('normal', 8.5, C.ink2);
      text(k, M, y + 4);
      font('bold', 10, C.ink);
      text(v, M + 36, y + 4);
      y += 6.5;
    }
    // earlier and later inspections of this door
    const stored = await db.get('doors', d.id);
    const visits = [
      ...(stored?.inspectedOn ? [{ date: stored.inspectedOn, status: stored.status }] : []),
      ...(stored?.history || []).filter((h) => h.inspectedOn).map((h) => ({ date: h.inspectedOn, status: h.status })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    if (visits.length > 1) {
      font('normal', 8.5, C.ink2);
      text('Inspection history', M, y + 4);
      font('normal', 8.5, C.ink);
      const line = visits.map((v) => `${fmtDate(v.date)} (${statusById[v.status || 'not_inspected'].short})`).join('  ·  ');
      const lines = doc.splitTextToSize(t(line), leftW - 36);
      doc.text(lines, M + 36, y + 4);
      y += lines.length * 4 + 3;
    }
    const acts = doorActions(d);
    if (acts.length) {
      y += 2;
      font('bold', 10);
      text('Recommended actions', M, y + 4);
      y += 6;
      for (const a of acts) {
        font('normal', 9.5, C.ink);
        const lines = doc.splitTextToSize(t('• ' + a), leftW);
        doc.text(lines, M + 1, y + 3.5);
        y += lines.length * 4.4 + 0.8;
      }
    }
    y = Math.max(y, startY + cropH + 7) + 3;

    // Checklist
    const qs = questionsFor(d, questions);
    const answered = qs.filter((q) => d.checks?.[q.id]?.answer);
    if (answered.length) {
      doc.autoTable({
        startY: y,
        margin: { left: M, right: M, top: M + 10 },
        head: [['#', 'Inspection check', 'Result']],
        body: qs.map((q, i) => [String(i + 1), t(q.text), ANSWER_TXT[d.checks?.[q.id]?.answer] || '–']),
        styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.5, textColor: C.ink, lineColor: C.line, lineWidth: 0.15 },
        headStyles: { fillColor: C.soft, textColor: C.ink2, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 2: { cellWidth: 20, halign: 'center', fontStyle: 'bold' } },
        didParseCell: (h) => {
          if (h.section === 'body' && h.column.index === 2) {
            const a = d.checks?.[qs[h.row.index].id]?.answer;
            if (a === 'fail') {
              h.cell.styles.textColor = [255, 255, 255];
              h.cell.styles.fillColor = STATUS_RGB.fail;
            } else if (a === 'pass') h.cell.styles.textColor = STATUS_RGB.pass;
            else h.cell.styles.textColor = C.muted;
          }
        },
      });
      y = doc.lastAutoTable.finalY + 5;
    }

    // Defects
    if ((d.defects || []).length) {
      doc.autoTable({
        startY: y,
        margin: { left: M, right: M, top: M + 10 },
        head: [['Defect', 'Remedial work required']],
        body: d.defects.map((x) => [t(x.label) + (Number(x.qty) > 1 ? ` (×${x.qty})` : ''), t(x.remedial)]),
        styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.6, textColor: C.ink, lineColor: C.line, lineWidth: 0.15 },
        headStyles: { fillColor: STATUS_RGB.fail, textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 70, fontStyle: 'bold' } },
      });
      y = doc.lastAutoTable.finalY + 5;
    }

    // Materials (optional)
    if (showCosts && (d.materials || []).length) {
      doc.autoTable({
        startY: y,
        margin: { left: M, right: M, top: M + 10 },
        head: [['Material', 'Qty', 'Unit cost', 'Total']],
        body: [
          ...d.materials.map((m) => [t(matLabel(m)), `${m.qty} ${t(m.unit || '')}`, t(euro(m.cost)), t(euro((Number(m.qty) || 0) * (Number(m.cost) || 0)))]),
          [{ content: 'Materials total (ex VAT)', colSpan: 3, styles: { fontStyle: 'bold', halign: 'right' } }, { content: t(euro(materialsTotal(d))), styles: { fontStyle: 'bold' } }],
        ],
        styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.5, textColor: C.ink, lineColor: C.line, lineWidth: 0.15 },
        headStyles: { fillColor: C.soft, textColor: C.ink2, fontStyle: 'bold' },
        columnStyles: { 1: { cellWidth: 22 }, 2: { cellWidth: 24, halign: 'right' }, 3: { cellWidth: 24, halign: 'right' } },
      });
      y = doc.lastAutoTable.finalY + 5;
    }

    if (d.notes) {
      ensure(12);
      font('bold', 10);
      text('Notes', M, y + 4);
      y += 6;
      para(d.notes, 9.5);
      y += 2;
    }

    // Photos: 3 per row, aspect kept
    if (withPhotos) {
      const photos = (await db.doorPhotos(d.id)).filter((p) => photoInView(p, d));
      if (photos.length) {
        const firstRowH = ((CW - 8) / 3) * 0.75;
        ensure(firstRowH + 10); // keep the heading with the first row of photos
        const nv = photos.filter(isVideo).length;
        font('bold', 10);
        text(nv ? `Photos & videos (${photos.length - nv} photos, ${nv} video${nv > 1 ? 's' : ''})` : `Photos (${photos.length})`, M, y + 4);
        y += 7;
        const cols = 3;
        const gap = 4;
        const cellW = (CW - gap * (cols - 1)) / cols;
        const cellH = cellW * 0.75;
        for (let i = 0; i < photos.length; i++) {
          const col = i % cols;
          if (col === 0) ensure(cellH + 2);
          const item = photos[i];
          const vid = isVideo(item);
          // videos use their still frame; the video file itself can't go in a PDF
          const img = await reportImage(vid ? item.thumb : item.blob);
          const k = Math.min(cellW / img.w, cellH / img.h);
          const w = img.w * k;
          const h = img.h * k;
          const cellX = M + col * (cellW + gap);
          const x = cellX + (cellW - w) / 2;
          doc.setFillColor(...C.soft);
          doc.rect(cellX, y, cellW, cellH, 'F');
          doc.addImage(img.data, 'JPEG', x, y + (cellH - h) / 2, w, h, undefined, 'FAST');
          if (vid) {
            // play button
            const cx = cellX + cellW / 2;
            const cy = y + cellH / 2 - 2;
            doc.setFillColor(...(item.link ? C.accent : C.ink));
            doc.circle(cx, cy, 6, 'F');
            doc.setFillColor(255, 255, 255);
            doc.triangle(cx - 2, cy - 3.2, cx - 2, cy + 3.2, cx + 3.4, cy, 'F');
            // caption band
            doc.setFillColor(...C.ink);
            doc.rect(cellX, y + cellH - 6.5, cellW, 6.5, 'F');
            font('bold', 7.5, [255, 255, 255]);
            const dur = fmtDuration(item.duration);
            text(`Video${dur ? ' ' + dur : ''}${item.link ? ' - tap to play' : ' - held on file'}`, cellX + 2.5, y + cellH - 2.2);
            if (item.link) doc.link(cellX, y, cellW, cellH, { url: item.link });
          }
          if (col === cols - 1 || i === photos.length - 1) y += cellH + gap;
        }
      }
    }
  }

  // ---------- running header & footer on every page but the cover ----------
  const total = doc.getNumberOfPages();
  for (let i = 2; i <= total; i++) {
    doc.setPage(i);
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    font('bold', 8, C.accent);
    text('FSCF IRELAND', M, M);
    font('normal', 8, C.ink2);
    text(t(`Fire door inspection · ${project.site || ''}`), M + 26, M);
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.2);
    doc.line(M, M + 2.5, pw - M, M + 2.5);
    font('normal', 8, C.muted);
    text(reportDate, M, ph - 8);
    text(`Page ${i} of ${total}`, pw - M, ph - 8, { align: 'right' });
  }

  onProgress('Saving PDF…');
  const blob = doc.output('blob');
  const filename = `FSCF_Report_${safeName(project.site || project.client)}_${project.date || new Date().toISOString().slice(0, 10)}${opts.filterText ? '_filtered' : ''}.pdf`;
  return saveFile(filename, blob);
}
