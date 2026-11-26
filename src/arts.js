// BM TRADA Q-Mark Fire Door Maintenance Scheme: Accepted Repair Techniques
// (ARTs). Source: ART index Iss 10, every ART issued 01 January 2026, expiry
// 31 December 2026 (FSCF Drive: "BM TRADA - ACCEPTED REPAIR TECHNIQUES INDEX").
// Each ART has one or more repair options; the inspector picks the option that
// fits and it becomes the defect's remedial work, with its reference.
// Option wording is a short summary: the ART document holds the full method.

export const ART_INDEX_ISSUE = 10;
export const ART_SOURCE = 'BM TRADA Q-Mark ART index Iss 10, ARTs issued 01/01/2026';

export const ARTS = [
  { no: '01', title: 'Lipping repair', rev: 12, options: [
    ['1', 'Cut out the damaged lipping and butt-joint a new hardwood section (min. 640 kg/m³) glued with urea formaldehyde adhesive; damage over 350 mm long: replace the whole edge lipping'],
    ['2', 'Fill gouges up to 5 mm deep × 5 mm wide × 350 mm long with epoxy wood filler (not where intumescent is in the leaf edge)'],
    ['3', 'Re-adhere a splintered section up to 5 × 5 × 350 mm, or remake it in epoxy wood filler, sanded flush'],
  ] },
  { no: '02', title: 'Over recessed hardware', rev: 11, options: [
    ['1', 'Fill redundant screw fixing holes (not through the leaf) with hardwood (min. 640 kg/m³) in urea formaldehyde adhesive; epoxy filler, sanded flush'],
    ['2', 'Fill voids left by rebated hardware (locks, hinges, flush bolts) within the ART\'s maximum sizes, max. 4 repairs per leaf'],
  ] },
  { no: '03', title: 'Door frame joints', rev: 13, options: [
    ['1', 'Frame in situ: PVAc (D3/D4) in the joint, close with hardwood wedges, add screw fixings through the head into the jamb'],
    ['2', 'Remove the frame and remake the head / jamb joint by conventional joinery'],
  ] },
  { no: '04', title: 'Door gaps incorrect to specification', rev: 12, options: [
    ['1a', 'Adjust the packers behind the frame at the fixing positions (timber doorsets up to 60 minutes)'],
    ['1b', 'Adjust the packers behind the frame at the fixing positions to the manufacturer\'s fitting instructions (all door types up to 120 minutes)'],
    ['2', 'Apply thicker lipping to the vertical or bottom leaf edges (timber doorsets up to 60 minutes)'],
    ['3', 'Modify the packing behind the hinge blades (timber doorsets up to 60 minutes)'],
    ['4', 'Add lipping to the bottom edge of the leaf (30 minute timber doorsets only)'],
    ['5', 'Add or remove timber at the bottom of the frame jambs (timber doorsets up to 60 minutes)'],
  ] },
  { no: '05', title: 'Closer not operating correctly', rev: 12, options: [
    ['1', 'Replace the door closer'],
    ['2', 'Adjust the door closer so the door self-closes (TGD M opening forces observed)'],
  ] },
  { no: '06', title: 'Door leaf out of alignment', rev: 11, options: [
    ['', 'Leaf more than 1 mm out of alignment: find and correct what stops it closing (hinges, seals, stops), then re-check'],
  ] },
  { no: '07', title: 'Moisture content too high', rev: 11, options: [
    ['', 'Find and fix the cause of the moisture and let the building dry before adjusting the doorset'],
  ] },
  { no: '08', title: 'Hinges dropped or damaged', rev: 12, options: [
    ['1', 'Replace the hinge with an identical hinge'],
    ['2', 'Replace the hinge with an alternative hinge (timber and metal doorsets only)'],
  ] },
  { no: '10', title: 'Operational maintenance', rev: 7, options: [
    ['', 'General operational maintenance of the doorset'],
  ] },
  { no: '11', title: 'Damaged perimeter seals', rev: 11, options: [
    ['1', 'Replace the intumescent seals'],
    ['2', 'Re-secure intumescent seals falling away from the groove'],
  ] },
  { no: '12', title: 'Misaligned matching hardware', rev: 11, options: [
    ['', 'Check gaps, hinges and alignment first (ART 04 / 06 / 08), then re-position the keep or bolt socket'],
  ] },
  { no: '13', title: 'Hinge fixings are loose or missing', rev: 11, options: [
    ['1', 'Tighten or replace the hinge screws'],
    ['2', 'Drill out the failed fixing (max. Ø12 mm; 30 mm deep in the leaf), plug with glued hardwood dowel (min. 640 kg/m³), re-fix'],
  ] },
  { no: '14', title: 'Damaged glazing and glass', rev: 11, options: [
    ['1', 'Replace broken glass (guidance from the doorset manufacturer)'],
    ['2', 'Replace damaged glazing beads'],
    ['3', 'Refit a poorly fitted glazing system'],
  ] },
  { no: '16', title: 'Replacement or refitting architrave and sealing', rev: 12, options: [
    ['1', 'Replace or refit the architrave (timber doorsets)'],
    ['2', 'Replace or refit the architrave (metal, composite or timber doorsets)'],
    ['3', 'Seal to the structural opening (timber doorsets)'],
    ['4', 'Seal to the structural opening (metal, composite or timber doorsets)'],
  ] },
  { no: '17', title: 'Replacement door leaf', rev: 13, options: [
    ['', 'Replace the door leaf, damaged beyond repair'],
  ] },
  { no: '18', title: 'Recommendation for replacement doorset', rev: 13, options: [
    ['', 'Recommend replacement of the complete doorset'],
  ] },
  { no: '19', title: 'Fire door signage', rev: 12, options: [
    ['1', 'Screw-fix the sign: min. 2 steel screws no longer than 15 mm, sign max. 150 mm diameter (timber doorsets only)'],
    ['2', 'Self-adhesive or glued sign, max. 150 mm diameter, at least 20 mm from the leaf edge'],
  ] },
  { no: '20', title: 'Replacement door frame', rev: 13, options: [
    ['1', 'Replace the frame: supporting evidence for the doorset available'],
    ['2', 'Replace the frame: no supporting evidence, up to 60 minutes fire resistance'],
  ] },
  { no: '21', title: 'Repair door frame', rev: 12, options: [
    ['1', 'Repair a void or hole in the frame'],
    ['2', 'Replace a single frame member or door stop'],
  ] },
  { no: '22', title: 'Smoke control', rev: 11, options: [
    ['1', 'Replace smoke only seals'],
    ['2', 'Adjust or replace the drop-down seal'],
  ] },
  { no: '23', title: 'Calling in expertise', rev: 12, options: [
    ['', 'No applicable ART: call in a qualified expert'],
  ] },
  { no: '24', title: 'Ineffectual fixings', rev: 5, options: [
    ['', 'Fit alternative and additional frame fixings'],
  ] },
];

const byNo = Object.fromEntries(ARTS.map((a) => [a.no, a]));

// Which ART usually fits a defect (by its wording)
const SUGGEST = [
  [/lipping/i, '01'],
  [/unauthorised holes|recessed|voids/i, '02'],
  [/frame joint/i, '03'],
  [/gap|threshold/i, '04'],
  [/closer|fails to close/i, '05'],
  [/alignment/i, '06'],
  [/moisture|swell/i, '07'],
  [/hinges dropped|hinges: fewer|hinge.*worn|binding/i, '08'],
  [/hinge.*screw|hinge fixing/i, '13'],
  [/maintenance/i, '10'],
  [/intumescent|seal size/i, '11'],
  [/smoke seal|drop seal/i, '22'],
  [/keeper|latch|matching hardware/i, '12'],
  [/glaz|glass|bead/i, '14'],
  [/architrave|fire stopped|firestop/i, '16'],
  [/leaf damaged|replace leaf/i, '17'],
  [/replacement|replace the doorset/i, '18'],
  [/sign/i, '19'],
  [/frame damaged|frame.*loose/i, '21'],
  [/fixings|loose frame/i, '24'],
  [/not consistent|expertise/i, '23'],
];
export function suggestArt(defect) {
  const t = `${defect.label || ''} ${defect.remedial || ''}`;
  return SUGGEST.find(([re]) => re.test(t))?.[1] || '';
}

export const artKey = (no, opt) => `${no}|${opt}`;
export function artOption(key) {
  const [no, opt] = String(key || '').split('|');
  const a = byNo[no];
  const o = a?.options.find(([id]) => id === opt);
  return a && o ? { art: a, id: o[0], text: o[1] } : null;
}
// The remedial wording a chosen option gives, with its reference
export function artRemedial(key) {
  const x = artOption(key);
  if (!x) return '';
  return `${x.text} (BM TRADA ART ${x.art.no} ${x.art.title}${x.id ? `, option ${x.id}` : ''}, rev ${x.art.rev}, ART index Iss ${ART_INDEX_ISSUE}, issued 01/01/2026)`;
}
