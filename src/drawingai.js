// The drawing reader: finds the fire doors on a scanned drawing with Claude.
// Built as its own file (reader.js) and loaded only when used.
//
// Read a compartment / fire cert drawing and find its fire doors.
//
// Two ways:
//  1. Free, on the phone: a PDF exported from CAD still holds its text, so the
//     door ratings (FD30S, E60Sa…) and room names can be read with their
//     positions.
//  2. Claude vision (needs the owner's Anthropic API key): for scanned or
//     flattened drawings. The drawing is cut into overlapping tiles so the
//     symbols are readable, each tile is read, and the results are joined.
//
// Both return doors as { x, y } fractions of the drawing (the same as pins),
// with the rating, room and any door ref found next to it.

import Anthropic from '@anthropic-ai/sdk';
import { readerGrid } from './drawingtext.js';

export const AI_MODEL = 'claude-opus-5-5';
const PRICE_IN = 4 / 1e6; // US$ per input token
const PRICE_OUT = 20 / 1e6; // US$ per output token

// ---------- 2. Claude vision ----------
const DOOR_SCHEMA = {
  type: 'object',
  properties: {
    doors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'Centre of the door opening, 0 (left edge of this image) to 1000 (right edge)' },
          y: { type: 'number', description: 'Centre of the door opening, 0 (top) to 1000 (bottom)' },
          rating: { type: 'string', description: 'Fire rating as shown or as the legend gives it, e.g. FD30S, FD60S, E30Sa. Empty if unknown.' },
          room: { type: 'string', description: 'Room name (and number if shown) the door opens into or serves, e.g. "G-21 CANTEEN". Empty if unknown.' },
          ref: { type: 'string', description: 'Door reference printed beside the door, if any. Empty if none.' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['x', 'y', 'rating', 'room', 'ref', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['doors'],
  additionalProperties: false,
};

const LEGEND_SCHEMA = {
  type: 'object',
  properties: {
    site: { type: 'string', description: 'Building / site name from the title block. Empty if none.' },
    drawingTitle: { type: 'string', description: 'Drawing title and number, e.g. "FS-01 Ground Floor Plan". Empty if none.' },
    doorKey: { type: 'string', description: 'How fire doors are shown on this drawing and how each rating is marked (symbols, colours, labels), from the legend/key. Plain sentences.' },
    approxDoorCount: { type: 'integer', description: 'Rough number of fire doors on the whole drawing.' },
  },
  required: ['site', 'drawingTitle', 'doorKey', 'approxDoorCount'],
  additionalProperties: false,
};

const SYSTEM = `You read fire safety / compartment drawings (Irish fire safety certificate drawings, fire strategy and compartmentation plans) for a fire door inspection company. You are precise and conservative: you report only fire doors you can actually see on the drawing, never ordinary doors, windows, furniture, arrows or legend symbols. A fire door is usually shown by a door swing in a fire-rated wall line together with a rating label (FD30, FD30S, FD60S, E30Sa, 30/30…), a self-closer symbol (often a small half-filled circle), or the colour the legend gives fire doors. Double doors count as one door.`;

async function blobToB64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}

async function crop(bitmap, sx, sy, sw, sh, maxSide) {
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * k);
  c.height = Math.round(sh * k);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bitmap, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88));
  c.width = c.height = 0;
  return blobToB64(blob);
}

function client(apiKey) {
  // The key is the owner's own, kept on this device and sent only to Anthropic.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 3 });
}

async function ask(api, imageB64, text, schema, usage, effort = 'medium') {
  const res = await api.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 } },
      { type: 'text', text },
    ] }],
  });
  usage.in += res.usage?.input_tokens || 0;
  usage.out += res.usage?.output_tokens || 0;
  if (res.stop_reason === 'refusal') throw new Error('The drawing reader declined this image.');
  if (res.stop_reason === 'max_tokens') throw new Error('The answer was cut short.');
  const t = res.content.find((b) => b.type === 'text');
  return JSON.parse(t?.text || '{}');
}

// Check a key works (a tiny, near-free request)
export async function testKey(apiKey) {
  const api = client(apiKey);
  await api.models.retrieve(AI_MODEL);
  return true;
}

// Find the doors on one drawing image (a plan's stored JPEG).
// Returns { doors, site, drawingTitle, costUsd }
// `saved` holds work already paid for on this drawing (the legend and each
// finished section); `onSave` is called after every section so an interrupted
// run can carry on later without paying for those sections again.
export async function aiDoors(planBlob, apiKey, onProgress = () => {}, saved = null, onSave = async () => {}) {
  const api = client(apiKey);
  const usage = { in: 0, out: 0 };
  const bmp = await createImageBitmap(planBlob);
  const W = bmp.width;
  const H = bmp.height;

  const { cols, rows, sig } = readerGrid(W, H);
  const cache = saved && saved.sig === sig ? saved : { sig, legend: null, tiles: {} };
  if (!cache.legend) {
    onProgress('Reading the legend and title block…');
    const overview = await crop(bmp, 0, 0, W, H, 1568);
    cache.legend = await ask(api, overview,
      'This is a whole fire safety drawing. Read its title block and legend/key. Describe exactly how fire doors and their ratings are shown on it, so someone looking at a zoomed-in part of the drawing can recognise them.',
      LEGEND_SCHEMA, usage, 'medium');
    await onSave(cache);
  }
  const key = cache.legend;

  const tw = W / cols;
  const th = H / rows;
  const ox = tw * 0.15;
  const oy = th * 0.15;
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = Math.max(0, c * tw - ox);
      const sy = Math.max(0, r * th - oy);
      tiles.push({ sx, sy, sw: Math.min(W, (c + 1) * tw + ox) - sx, sh: Math.min(H, (r + 1) * th + oy) - sy });
    }
  }
  const found = [];
  let done = Object.keys(cache.tiles).length;
  const prompt = `This is one part of a larger fire safety drawing${key.drawingTitle ? ` (${key.drawingTitle})` : ''}.
How this drawing shows fire doors, from its legend: ${key.doorKey || 'not stated - use the usual conventions.'}
List every fire door you can see in this part. Give the centre of each door opening in this image's coordinates (0-1000 across, 0-1000 down). Skip the legend, title block, and doors cut off at the image edge that you cannot identify. If this part has no fire doors (for example it is the title block or blank), return an empty list.`;
  const run = async (t, i) => {
    if (!cache.tiles[i]) {
      const img = await crop(bmp, t.sx, t.sy, t.sw, t.sh, 1568);
      cache.tiles[i] = (await ask(api, img, prompt, DOOR_SCHEMA, usage, 'medium')).doors || [];
      done++;
      await onSave(cache);
      onProgress(`Looking for doors… ${done} of ${tiles.length} parts done`);
    }
  };
  const collect = (t, i) => {
    for (const d of cache.tiles[i] || []) {
      if (d.confidence === 'low') continue;
      found.push({ ...d, x: (t.sx + (d.x / 1000) * t.sw) / W, y: (t.sy + (d.y / 1000) * t.sh) / H, conf: d.confidence === 'high' ? 2 : 1 });
    }
  };
  onProgress(`Looking for doors… ${done} of ${tiles.length} parts done${done ? ' (carrying on from last time)' : ''}`);
  // three at a time; one failing doesn't throw away the others
  let failed = null;
  for (let i = 0; i < tiles.length; i += 3) {
    const rs = await Promise.allSettled(tiles.slice(i, i + 3).map((t, j) => run(t, i + j)));
    failed ||= rs.find((x) => x.status === 'rejected')?.reason;
    if (failed && failed.status === 401) break;
  }
  bmp.close?.();
  if (failed) {
    const left = tiles.length - Object.keys(cache.tiles).length;
    const why = failed.error?.error?.message || failed.message || String(failed);
    const e = new Error(`Stopped: ${why}. ${tiles.length - left} of ${tiles.length} parts are saved; run Find doors again to finish the other ${left} without paying again for those done.`);
    e.status = failed.status;
    throw e;
  }
  tiles.forEach(collect);

  // join doors seen twice where tiles overlap
  const minGap = 0.012;
  const doors = [];
  for (const d of found.sort((a, b) => b.conf - a.conf)) {
    const twin = doors.find((e) => Math.hypot(e.x - d.x, (e.y - d.y) * (H / W)) < minGap);
    if (twin) {
      twin.rating ||= d.rating;
      twin.room ||= d.room;
      twin.ref ||= d.ref;
    } else doors.push({ x: d.x, y: d.y, rating: d.rating, room: d.room, ref: d.ref });
  }
  // top-to-bottom, left-to-right, so numbering reads naturally
  doors.sort((a, b) => Math.round(a.y * 12) - Math.round(b.y * 12) || a.x - b.x);
  return { doors, site: key.site, drawingTitle: key.drawingTitle, costUsd: usage.in * PRICE_IN + usage.out * PRICE_OUT };
}

// One turn of the "Ask Claude" chat. The caller runs the tools and loops.
// The system prompt (with the tools before it) and the conversation so far are
// cached, so each follow-up only pays full price for what is new.
export async function chatTurn(apiKey, { system, tools, messages }) {
  const api = client(apiKey);
  const msgs = messages.map((m, i) => {
    if (i !== messages.length - 1) return m;
    const content = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : [...m.content];
    content[content.length - 1] = { ...content[content.length - 1], cache_control: { type: 'ephemeral' } };
    return { ...m, content };
  });
  return api.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    tools,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    messages: msgs,
  });
}
