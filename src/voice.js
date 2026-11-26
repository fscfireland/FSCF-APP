// Voice notes: when a note box has the cursor (textareas and the end-of-service
// notes), a microphone button appears at its top-right corner. Speech is turned
// into text by Claude's dictation (the platform holds the microphone; the app
// only receives the words). Where dictation is not offered (the Claude mobile
// apps, Safari, outside Claude) the button never appears and typing works as
// before. No page layout is changed: the button floats over the box.

let dict = null;
let target = null; // the box being dictated into
let focused = null; // the box with the cursor
let btn = null;
let partial = null;
const BOX = 'textarea:not([data-novoice]), input.co-note';

const toastEvt = (msg) => window.dispatchEvent(new CustomEvent('fscf-toast', { detail: msg }));

function place() {
  const box = (dict && dict.active() && target && document.contains(target)) ? target : focused;
  if (!btn || !box || !document.contains(box)) { if (btn) btn.hidden = true; if (partial) partial.hidden = true; return; }
  const r = box.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight || !r.width) { btn.hidden = true; return; }
  btn.hidden = false;
  btn.style.top = `${Math.max(4, r.top + 4)}px`;
  btn.style.left = `${Math.min(innerWidth - 44, r.right - 40)}px`;
  if (partial) {
    partial.style.top = `${r.bottom + 2}px`;
    partial.style.left = `${Math.max(8, r.left)}px`;
    partial.style.maxWidth = `${Math.max(120, r.width)}px`;
  }
}

function drawBtn(state) {
  if (!btn) return;
  const on = state && state !== 'idle';
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.setAttribute('aria-label', on ? 'Stop voice note' : 'Speak a note');
  btn.title = on ? 'Stop voice note' : 'Speak a note';
}

export async function startVoice() {
  if (!window.claude?.use) return;
  try { dict = await window.claude.use('dictation'); } catch { dict = null; }
  if (!dict) return;

  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mic-btn';
  btn.hidden = true;
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  drawBtn('idle');
  partial = document.createElement('div');
  partial.className = 'mic-partial';
  partial.hidden = true;
  document.body.append(btn, partial);

  // keep the cursor in the box when the button is pressed
  btn.addEventListener('pointerdown', (e) => e.preventDefault());
  btn.addEventListener('click', () => {
    if (dict.active()) { dict.stop().catch(() => {}); return; }
    target = focused;
    if (!target) return;
    drawBtn('starting');
    // start() must be called straight from the tap, before anything is awaited
    dict.start().catch((err) => {
      drawBtn('idle');
      const why = { not_granted: 'Voice notes are switched off for the app, or the microphone is blocked.', unavailable: 'Voice notes are not available here.', rate_limited: 'Too many voice notes at once. Try again in a moment.', upstream_error: 'The microphone or speech service failed. Try again.' }[err?.code];
      if (why) toastEvt(why);
    });
  });

  dict.onFinal(({ text }) => {
    if (!target || !document.contains(target)) return;
    const cur = target.value || '';
    target.value = cur + (cur ? text : text.replace(/^\s+/, ''));
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    partial.textContent = '';
    partial.hidden = true;
  });
  dict.onPartial(({ text }) => {
    partial.textContent = text ? `… ${text}` : '';
    partial.hidden = !text;
    place();
  });
  dict.onState(({ state, reason }) => {
    drawBtn(state);
    if (state === 'idle') {
      partial.hidden = true;
      target = null;
      if (reason === 'unavailable') { btn.remove(); btn = null; }
      if (reason === 'not_granted') toastEvt('Voice notes are switched off for the app, or the microphone is blocked.');
    }
    place();
  });

  document.addEventListener('focusin', (e) => {
    if (e.target.matches?.(BOX) && !e.target.disabled && !e.target.readOnly) { focused = e.target; place(); }
  });
  document.addEventListener('focusout', () => {
    // wait: the focus may be moving to another note box
    setTimeout(() => { if (!document.activeElement?.matches?.(BOX)) { focused = null; place(); } }, 150);
  });
  window.addEventListener('scroll', place, { passive: true, capture: true });
  window.addEventListener('resize', place);
}
