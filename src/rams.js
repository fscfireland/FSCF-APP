// Risk Assessment & Method Statement (RAMS) for a site visit (owner, 27 Nov 2026).
//
// Three generic kinds of work – Inspection, Remedial repairs, Replacement / install – for each
// trade (fire doors, fire dampers, fire alarm, emergency lighting, fire extinguishers). The
// generic part never changes between sites; the site, customer, collection, drawings, check
// type and the owner's site / visit notes are filled in, then it is read and signed before any
// work is recorded on the visit (see main.js: startVisit, visit lock).
//
// Sources (rule 1 – every line traceable):
// - Fire door INSPECTION: FSCF-RAMS-21 Rev 0 (Dunboyne Health Centre, 17/11/2026), same format as the
//   inspection RAMS praised by HSE Dublin North East Facilities, Kells (email 15/10/2026).
// - Fire door REMEDIAL: FSCF-RAMS-14 Rev 1 (Dromore Unit, St Mary's Castleblayney, 22/10/2026) and
//   FSCF-RAMS-04 Rev 2 (Hawthorns, Stillorgan, 02/09/2026).
// - Fire door INSTALL: CVL-001-REM-001 Rev 2 (Civil Registration Service, Lombard St, 09/11/2026).
// - Dampers, fire alarm, emergency lighting, extinguishers: the owner has no RAMS of his own; written
//   in the same FSCF format from the standards each one names, and marked "FSCF practice, review
//   before first issue" until the owner has reviewed them.

import { loadJsPdf } from './report.js';
import { capsPdf } from './caps.js';

export const WORKS = { insp: 'Inspection', rem: 'Remedial repairs', inst: 'Replacement / install' };
export const TRADES = { fd: 'Fire doors', dampers: 'Fire dampers', alarm: 'Fire alarm', emlight: 'Emergency lighting', ext: 'Fire extinguishers' };

const FSCF_ADDR = 'FSCF Ireland — Copponagh, Bailieborough, Co. Cavan, A82 YK46';
const SRC = {
  fdInsp: 'FSCF-RAMS-21 Rev 0 (Dunboyne Health Centre, 17/11/2026)',
  fdRem: 'FSCF-RAMS-14 Rev 1 (Dromore Unit, St Mary\'s Castleblayney, 22/10/2026) and FSCF-RAMS-04 Rev 2 (Hawthorns, Stillorgan, 02/09/2026)',
  fdInst: 'CVL-001-REM-001 Rev 2 (Civil Registration Service, Lombard Street, 09/11/2026)',
  other: (std) => `Industry standards (${std}) in the FSCF RAMS format of FSCF-RAMS-21 — FSCF practice, source to be confirmed: review before first issue`,
};

// ---------- the parts every FSCF RAMS shares (from the owner's RAMS above) ----------
const LEGIS_BASE = [
  'Safety, Health and Welfare at Work Act 2005 (and General Application Regulations 2007–2020)',
  'Safety, Health and Welfare at Work (Construction) Regulations 2013, as amended',
  'Fire Services Acts 1981 & 2003',
  'Building Control (Amendment) Regulations 2014 (S.I. No. 9 of 2014)',
];
const LEGIS_FD = [
  'EN 1634-1 — Fire resistance test for door and shutter assemblies',
  'EN 13501-2 — Fire classification of construction products and building elements',
  'EN 1935 — Single-axis hinges, performance requirements',
  'BS 8214:2026 — Timber-based fire door assemblies, code of practice (used where no direct EN equivalent applies)',
  'PAS 79-2 — Fire risk assessment, Part 2: fire doors',
];
export const MATRIX_NOTE = [
  'Risk = Likelihood × Severity, each scored 1–5. This gives the Pre-Control and Residual ratings in the risk register below.',
  '1–7 Low (Green): acceptable with routine precautions and standard controls in place.',
  '8–14 Medium (Amber): work may proceed with additional controls in place; supervisor to review before work starts.',
  '15–25 High (Red): work must not proceed until additional controls reduce the risk; Director sign-off required.',
];
export const EMERGENCY_STEPS = [
  'DETECT — shout "FIRE" to alert occupants.',
  'ALARM — activate the nearest break-glass call point.',
  'EVACUATE — leave via the nearest safe fire exit; stop work, un-wedge and close doors behind you if safe.',
  'ASSEMBLE — report to the designated assembly point for a head-count.',
];
export const SIGNOFF_TEXT = 'We, the undersigned, confirm that we have read, understood and agree to comply with this Risk Assessment & Method Statement. We will stop work and seek guidance if conditions change from those described above.';
const PPE_BASE = ['Safety footwear (steel-capped)', 'High-visibility vest/jacket', 'Safety gloves', 'Eye protection (as required)', 'Dust mask / FFP2–FFP3 respirator (as required)'];
const TRAIN_BASE = ['Safe Pass — all operatives', 'Manual Handling — all operatives', 'Working at height (stepladder / podium) — all operatives'];
export const bandName = (n) => (n >= 15 ? 'high' : n >= 8 ? 'med' : 'low');
export const rating = (n) => `${n} (${n >= 15 ? 'High' : n >= 8 ? 'Medium' : 'Low'})`;

// [hazard, who, existing controls, pre, additional controls, residual]
const R = {
  wah: ['Working at height — stepladder / podium for door heads, closers, ceilings and high devices', 'Operative', 'Stepladder / podium in good condition, checked before each use (FSCF Form 129), firm level floor, three points of contact, no overreaching', 8, 'Not used in corridors with traffic or in escape routes unless the area is controlled; no use on wet floors; second person foots the steps where required', 4],
  slips: ['Slips, trips and falls (wet floors, cables, offcuts, thresholds)', 'All occupants, operative', 'Good housekeeping; tools carried in a bag; nothing left in walkways', 6, 'Wet-floor signs obeyed; suitable footwear; trip hazards reported to the site contact', 2],
  alarm: ['Fire alarm activation or evacuation during the work', 'Occupants, operative', 'Alarm and evacuation arrangements confirmed with the site contact on arrival each day; assembly point confirmed', 10, 'Work stops at once on alarm; doors are un-wedged and closed; operative leaves by the nearest safe exit and reports to the assembly point; no re-entry until cleared', 2],
  escape: ['Obstructing movement and escape routes (wheelchairs, trolleys, exits)', 'Occupants', 'Ladder and bag kept clear of corridors and exits; escape routes never obstructed; work-in-progress signage used', 8, 'Doors held open only while being worked on and always returned to the closed position; order of work agreed with the site contact', 4],
  lone: ['Lone working and moving between areas of a large building', 'Operative', 'Sign in and out with the site contact; check-in by phone at the start and end of each day', 8, 'No working at height alone; working mobile phone carried; staff told which area is being worked in; start and finish times agreed in advance', 4],
  privacy: ['Breach of service-user privacy and confidentiality (records, whiteboards, conversations, screens)', 'Service users, visitors, staff', 'Briefing on privacy before first entry; ID worn at all times; no service-user information read, recorded or discussed; no photography of people; findings recorded by reference only; GDPR followed', 9, 'Rooms entered only when vacant or with the manager\'s agreement; doors left as found; anything inadvertently seen or overheard is not repeated and is reported to the site contact', 3],
  infection: ['Infection transmission between rooms and areas (vulnerable occupants)', 'Service users, staff, operative', 'Hand hygiene before and after each area; ladder, tools and bag wiped with anti-bacterial wipes between areas; tools kept to a minimum', 6, 'Infection control and isolation signage obeyed; no entry to any room under precautions unless the site contact instructs; nothing placed on beds, linen or clinical surfaces', 3],
  rooms: ['Entering rooms in use (bedrooms, group rooms, kitchens, offices)', 'Service users, staff', 'Knock and wait; work on the item only; return later if the room is in use', 6, 'Manager informed of the area being worked in; do not enter when an activity or session is in progress', 4],
  plant: ['Boiler house, plant rooms, electrical switch room (live equipment, hot surfaces, restricted access)', 'Operative', 'Keys and access arranged with the site contact; live panels, boilers and pipework not touched', 8, 'Nothing leaned or hung on equipment; room closed and locked as found; any defect reported to the site contact; roof plant rooms not entered under this RAMS', 4],
  manual: ['Manual handling — lifting and carrying doors, ladders, tools and materials', 'Operative', 'Correct lifting technique; door lifter / trolley used; two-person lift for heavy items', 9, 'Any item too heavy to move safely alone is left in place and reported; route cleared before carrying; rest breaks', 4],
  fingers: ['Trapped fingers at hinge side, closer arms and drop seals', 'Operative', 'Fingers kept clear of the hinge side; door controlled by hand and supported or wedged safely while working', 4, 'Door wedges never left in place; doors that do not operate freely are logged, not forced', 2],
  tools: ['Power tools (drill/driver, planer, multi-tool) — cuts, noise, flying chips, electric shock', 'Operative, anyone nearby', '110V PAT-tested tools via transformer and RCD; guards in place; eye and hearing protection; leads kept clear', 8, 'Tools unplugged when changing blades or bits; area barriered; only competent operatives use cutting tools', 4],
  dust: ['Dust and debris (timber, plasterboard, mineral wool) reaching occupied areas', 'Occupants, operative', 'Dust-generating work kept to a minimum; tool extraction to a HEPA vacuum; no dry sweeping', 9, 'Cutting and planing done outside where possible; FFP3 respirator and eye protection; HEPA vacuum and wet-wipe before leaving the area', 4],
  compartment: ['Compartmentation temporarily lost while a door or device is out of service', 'Building occupants', 'Work sequenced one item at a time; a door is never left off its hinges, open or non-latching unattended', 8, 'Each item tested and confirmed working before moving to the next; no door left off at breaks, handover or end of day; a temporary arrangement is agreed with the site contact before leaving if it cannot be restored', 4],
  electric: ['Live electrical equipment (panels, mains-fed devices, motorised dampers)', 'Operative', 'Equipment treated as live; isolation only by a competent person with the site contact\'s agreement; voltage proved dead before touching', 12, 'Lock-out / tag-out where isolated; no work on mains wiring under this RAMS unless by a competent electrician', 4],
  chemicals: ['Chemical agents — sealants, intumescent mastic, adhesives, smoke-test aerosol, paint', 'Operative, nearby occupants', 'Safety data sheets on site; containers kept closed; area ventilated; low-odour products where possible', 8, 'No eating or drinking in the work area; gloves and eye protection', 4],
  asbestos: ['Unknown conditions — hidden services, suspected asbestos, unsound fixings', 'Operative, occupants', 'Client\'s asbestos register / building survey checked beforehand; stop-work and report procedure', 10, 'No disturbance of suspect material; site contact informed immediately; work resumes only on their instruction', 5],
  waste: ['Waste — old hardware, seals, offcuts, packaging, batteries', 'Operative, environment', 'Waste bagged or wrapped at the work area and removed by the agreed route; not left in corridors', 6, 'Waste segregated; batteries and electrical waste kept for licensed disposal', 3],
};

// ---------- templates: trade × kind of work ----------
const T = {
  'fd:insp': {
    source: SRC.fdInsp,
    scope: ['Visual and functional condition inspection of the fire doorsets and exits shown on the drawing(s) listed above.', 'This is an inspection and reporting visit only. No remedial works are carried out under this RAMS. A written report and door-by-door schedule is issued after the inspection, and any remedial works are quoted separately.', 'Where the building is occupied, privacy and dignity come first; rooms are entered only when vacant or with the manager\'s agreement.'],
    legislation: [...LEGIS_BASE, ...LEGIS_FD],
    risks: [R.privacy, R.infection, R.rooms, R.lone, R.wah, R.plant, R.escape, R.alarm, R.slips, R.manual, R.fingers],
    before: ['Before the first visit, agree the dates and daily times with the client contact, including who provides keys and access to plant rooms and other locked rooms.', 'On arrival each day, sign in with the site contact, wear ID at all times, confirm the areas for the day and any restrictions, and confirm the fire alarm and evacuation arrangements.', 'Before entering any room in use, check with the manager that it is suitable to enter; if privacy is needed, move on and return later.'],
    setup: ['Each door is identified by its numbered pin on the FSCF Ireland app drawing; door references and findings are entered in capitals.', 'Work-in-progress signage is used where a door is in a busy corridor. Ladders are set up only when needed and only in controlled areas.'],
    after: ['No destructive testing is carried out. The client provides evidence of fire stopping between frame and substrate where available. The scope of corrective actions is outlined in the final report.', 'Final exit and external doors are checked for free and easy operation of the exit hardware from inside.', 'Plant rooms: only the door and frame are inspected; nothing inside is touched.', 'Findings are recorded against each door reference; no names or service-user details are recorded. Photographs show the door only.', 'Areas are left clean and clear; at the end of each session the operative signs out and confirms every door has been returned to its closed position.', 'A written report and door-by-door schedule is issued to the client after the inspection.'],
    ppe: PPE_BASE,
    training: ['FDIS Diploma in Fire Door Inspection (DipFD) — Mark Crosby', ...TRAIN_BASE],
    plant: ['Calibrated gap gauge (feeler gauge)', 'Tape measure', 'Torch', 'Tablet / phone with the FSCF Ireland app (door photographs, door only)', 'Extendable mirror', 'Stepladder (checked, FSCF Form 129)', 'Anti-bacterial wipes'],
  },
  'fd:rem': {
    source: SRC.fdRem,
    scope: ['Remedial repairs to existing fire doorsets as itemised in the inspection report and repair sheet for the drawing(s) listed above: adjustment of leaves and frames (hinge and frame packing), planing where needed, self-closing device and drop seal adjustment or replacement, replacement of damaged handles and ironmongery with compatible fire-door hardware, and fire door signage.', 'Doors are worked on one at a time and no door is left off its hinges, out of service or non-latching when work stops.', 'Fire-stopping works are not included unless listed on the repair sheet; any fire-stopping defects seen are recorded and reported separately.'],
    legislation: [...LEGIS_BASE, ...LEGIS_FD, 'Safety, Health and Welfare at Work (Chemical Agents) Regulations 2001, as amended (wood dust)'],
    risks: [R.rooms, R.compartment, R.manual, R.tools, R.dust, R.fingers, R.wah, R.slips, R.lone, R.escape, R.alarm, R.waste],
    before: ['On arrival sign in with the site contact (and the nurse in charge in a care setting). Confirm the doors scheduled for the day against the inspection report / repair sheet, access arrangements, where occupants are, and the fire / evacuation procedure. Phone Mark Crosby to confirm the start.', 'Set up an outdoor work station (trestles / bench) on firm level ground, away from entrances, walkways and occupants, and barrier it off. Tools are PAT tested and run on 110V through a transformer and RCD.'],
    setup: ['Work one door at a time. For a door that needs planing, agree the removal with the site contact, support the leaf, release the hinge screws / pins and lift it clear with a door lifter / trolley, then carry it straight outside. Any door too heavy to move safely alone is left in place and reported.'],
    after: ['Plane the leaf outside only, taking off no more than the door\'s certification and the inspection report permit, to bring the gaps back to tolerance. Wipe dust from the door before carrying it back in.', 'Pack the hinges (hinge pads / shims) where required to correct alignment and gaps, using matching fixings in good condition.', 'Adjust the self-closing device and remove, repair or replace automatic drop seals, testing the drop action and full threshold contact on closing.', 'Replace damaged handles with matching / compatible fire-door ironmongery as called for in the report, and check latch operation.', 'Fit fire door signage where required, using fixings that do not compromise the door\'s fire rating; check the existing certification label before drilling.', 'Rehang the door and check it closes fully onto its latch from several opening angles, gaps are even and ironmongery is secure, before moving to the next door.', 'Record the work done against each door reference, with before / after photographs, for the completion report.', 'Clean up as you go: vacuum shavings (no dry sweeping), remove offcuts, old hardware and packaging; segregate waste for licensed disposal.'],
    ppe: [...PPE_BASE, 'Hearing protection (when planing or using power tools)'],
    training: ['FDIS Diploma in Fire Door Inspection (DipFD) — Mark Crosby (directs the works)', 'Competent carpenter / fire door operative — on site', ...TRAIN_BASE],
    plant: ['Screwdriver set / hinge and closer adjustment tools', 'Drop seal removal / fitting tool', 'Cordless drill / driver', 'Planer and trestles (outside only)', 'Gap gauge', 'Spirit level', 'Door lifter / trolley, wedges and packers', 'HEPA vacuum', '110V transformer and RCD, PAT-tested leads', 'Podium steps (checked, FSCF Form 129)'],
  },
  'fd:inst': {
    source: SRC.fdInst,
    scope: ['Removal of the existing door leaf, frame and architraves and the supply and installation of new certified fire doorset(s) at the openings listed above, with fire-stopping between frame and wall, and making good.', 'Each doorset is installed strictly within its manufacturer\'s certification / field of application (assessment report held on site), with the frame fixed and sealed to the wall as the assessment requires.', 'The compartment is restored the same day: the new door is hung, self-closing and latching before the team leaves; an opening is never left unattended or unprotected.'],
    legislation: [...LEGIS_BASE, 'Safety, Health and Welfare at Work (Chemical Agents) Regulations 2001, as amended (construction dust)', 'EN 1634-1 — Fire resistance test for door and shutter assemblies', 'EN 1634-3 — Smoke control test for door and shutter assemblies (Sa classification)', 'EN 13501-2 — Fire classification of construction products and building elements', 'EN 16034 — Pedestrian doorsets: fire resisting and/or smoke control characteristics (product standard)', 'EN 1935 — Single-axis hinges, performance requirements', 'EN 1154 — Controlled door closing devices', 'EN 15725 — Extended application reports on the fire performance of construction products', 'BS 8214 — Timber-based fire door assemblies, code of practice (used where no direct EN equivalent applies)'],
    risks: [R.dust, R.compartment, ['Security — opening unsecured while the old door is out', 'Client', 'Team member at the opening whenever it is open; keyholder agreed with the site contact', 8, 'Opening never left unattended; new doorset hung and latching the same day; keys and locking agreed before leaving site', 4], R.manual, R.wah, R.tools, R.asbestos, R.chemicals, R.slips, R.waste, R.electric],
    before: ['Issue this RAMS for approval before starting. Hold the FSCF Safety Statement, insurance documents, Safe Pass / CSR cards and training records for each operative.', 'Agree with the client: dates and hours, access and egress, parking and unloading, the route for materials and waste, cordon positions, escape routes and fire alarm arrangements, and the keyholder.', 'Check the delivered doorsets, their certification and installation instructions, and the fire-stopping products before attending. Mark Crosby checks the certification against the opening.'],
    setup: ['Sign in, walk the route, confirm the escape routes, call points and assembly point. Erect barriers and a fire-retardant dust screen around the work area, leaving escape routes clear. Lay and tape down floor protection.', 'Protect any existing services or equipment near the opening; existing cables are not moved, cut or disconnected — if one is in the line of the work, stop and call Mark Crosby and the site contact.'],
    after: ['Remove the old leaf (two people, door lifter), architraves and stops, then cut the frame out in sections with extraction to a HEPA vacuum, wrapping each section straight away. Inspect the exposed opening and stop and report anything unexpected.', 'Do any sizing, planing or routing of the new leaf outside the building only.', 'Set the frame plumb, square and level with packers at hinge and lock positions; fix it as the manufacturer\'s instructions and the assessment require, without distorting it.', 'Seal the frame-to-wall gap with the fire-rated sealant / fire-stopping specified for the assembly.', 'Hang the leaf; check the gaps (3 mm at sides and top, bottom as the fire specification requires); fit the intumescent and smoke seals, ironmongery and closer as specified.', 'Test: the door opens freely, closes fully and latches from several opening angles, without slamming.', 'Fit the architraves, fire door signage and identification tag; clean down with HEPA vacuum and wet wipe (no dry sweeping); remove waste by the agreed route.', 'Record the installation (date, fitter, manufacturer\'s certification) and give the client the installation record.'],
    ppe: [...PPE_BASE, 'Hard hat where required by the site', 'Hearing protection (when cutting or using power tools)', 'Coveralls (Type 5/6 where dust-generating work is under way)'],
    training: ['FDIS Diploma in Fire Door Inspection (DipFD) — Mark Crosby (overall supervision)', 'Competent fire door installer / carpenter — on site', 'Safe Pass / CSR card — all operatives', ...TRAIN_BASE.slice(1), 'Site induction acknowledgement signed by every operative before starting work'],
    plant: ['Barriers, signs, fire-retardant polythene, tape and floor protection', 'HEPA-filtered vacuum (H13/H14) and tool extraction', 'Chop saw, multi-tool, hand saws, cordless drill / driver, plane, chisels, spirit and laser level; cable / stud detector', 'Door lifter / trolley, wedges and packers; steps or low-level platform (checked, FSCF Form 129)', '110V transformer and RCD, PAT-tested leads', 'Certified doorset, seals, ironmongery, closer, signage and fire-stopping products as specified'],
  },
};

// The other trades: inspection, and one for repairs / replacement of devices
const OTHER = {
  dampers: {
    std: 'I.S. EN 15650; I.S. EN 1366-2; BS 9999 (inspection and maintenance of fire dampers); BESA DW/145',
    legislation: ['I.S. EN 15650 — Ventilation for buildings: fire dampers', 'I.S. EN 1366-2 — Fire resistance tests for service installations: fire dampers', 'BS 9999 — Fire safety in the design, management and use of buildings (inspection and maintenance of fire dampers)', 'BESA DW/145 — Guide to good practice for the installation of fire and smoke dampers'],
    scope: { insp: 'Inspection and drop / function test of the fire and smoke dampers shown on the drawing(s) listed above: access through the inspection hatch, visual check of the blade, fusible link / actuator, seals and fixings, drop test and reset, and recording each damper by its pin.', rem: 'Repair or replacement of damper components (fusible links, springs, actuators, access hatches) and resetting of dampers as itemised in the inspection report.' },
    extra: [['Spring-loaded damper blade closing during the drop test — trapped fingers and hands', 'Operative', 'Hands kept out of the damper path; blade released only by the fusible link / test mechanism, never by hand inside the duct', 9, 'Reset tool used; damper checked locked open before hands enter the hatch', 3], ['Ceiling voids and ductwork — sharp edges, dust, mineral wool fibres, confined access', 'Operative', 'Cut-resistant gloves, FFP3 respirator and eye protection when opening hatches or ceiling tiles', 9, 'Torch used; no climbing into ceiling voids; hatches and tiles replaced before moving on', 4], ['Motorised dampers linked to the fire alarm / BMS — unwanted activation, live 230V supplies', 'Occupants, operative', 'Fire alarm / BMS interface and test times agreed with the site contact and alarm company; actuators treated as live', 9, 'Any isolation done only by a competent person with the site contact\'s agreement; systems restored and confirmed before leaving', 4]],
    plant: ['Hatch keys / screwdrivers', 'Damper reset tool', 'Torch and inspection mirror', 'Stepladder / podium (checked, FSCF Form 129)', 'Camera / FSCF Ireland app', 'Replacement fusible links of the correct rating (repairs)'],
  },
  alarm: {
    std: 'I.S. 3218 (fire detection and alarm systems for buildings — system design, installation, servicing and maintenance)',
    legislation: ['I.S. 3218 — Fire detection and alarm systems for buildings: system design, installation, servicing and maintenance', 'National Rules for Electrical Installations (ET 101), as amended'],
    scope: { insp: 'Service / inspection of the fire detection and alarm system: control panel, power supplies and batteries, call points, detectors and sounders, with a sample of devices tested on each visit and every device tested over the year, recorded in the logbook and on the drawing by pin.', rem: 'Repair or replacement of fire alarm devices, batteries and panel components as itemised in the service report.' },
    extra: [['Unwanted alarm activation, evacuation or brigade call-out during testing', 'Occupants, client', 'Test times agreed with the site contact; alarm receiving centre (monitoring) told before testing and again when finished; occupants warned', 12, 'Zones / outputs disabled only as needed and restored and confirmed before leaving; logbook entry made', 4], ['Smoke / heat test equipment — aerosols, heated heads at height', 'Operative, occupants', 'Approved test aerosols per the safety data sheet; test pole used from the floor where possible', 6, 'Area ventilated; aerosol not used near occupants with breathing difficulties', 3], ['Standby batteries — heavy, acid, short-circuit', 'Operative', 'Two-person lift for large batteries; insulated tools; terminals covered', 8, 'Old batteries kept for licensed disposal', 3]],
    plant: ['Detector test pole with smoke / heat heads', 'Approved smoke test aerosol', 'Multimeter and insulated tools', 'Call point test key', 'Stepladder / podium (checked, FSCF Form 129)', 'Logbook / FSCF Ireland app'],
  },
  emlight: {
    std: 'I.S. 3217 (emergency lighting); I.S. EN 1838; I.S. EN 50172',
    legislation: ['I.S. 3217 — Emergency lighting', 'I.S. EN 1838 — Lighting applications: emergency lighting', 'I.S. EN 50172 — Emergency escape lighting systems', 'National Rules for Electrical Installations (ET 101), as amended'],
    scope: { insp: 'Inspection and test of the emergency lighting luminaires and exit signs shown on the drawing(s): functional (short) test and, where due, full rated-duration test, with results recorded by pin and in the logbook.', rem: 'Repair or replacement of emergency luminaires, batteries, lamps and exit signs as itemised in the test report.' },
    extra: [['Building left with reduced emergency lighting while batteries recharge after a full-duration test', 'Occupants', 'Full-duration tests done at times agreed with the site contact (low occupancy); occupants told', 9, 'Tests done in alternate areas where possible so part of the building keeps cover; recharge period (normally 24 hours) recorded', 4], ['Simulating mains failure — isolating circuits', 'Operative, occupants', 'Test key switches used where fitted; circuits isolated only by a competent person with the site contact\'s agreement', 9, 'All circuits and normal lighting restored and confirmed before leaving', 4]],
    plant: ['Test key / isolation tools', 'Lux meter', 'Multimeter and insulated tools', 'Stepladder / podium (checked, FSCF Form 129)', 'Logbook / FSCF Ireland app'],
  },
  ext: {
    std: 'I.S. 291 (selection, commissioning, installation, inspection and maintenance of portable fire extinguishers); I.S. EN 3',
    legislation: ['I.S. 291 — Selection, commissioning, installation, inspection and maintenance of portable fire extinguishers', 'I.S. EN 3 — Portable fire extinguishers'],
    scope: { insp: 'Annual inspection and basic service of the portable fire extinguishers and fire blankets at the positions shown on the drawing(s): access, signage, condition, pressure, seals and service labels, recorded by pin.', rem: 'Replacement, refilling or re-siting of extinguishers and fire blankets as itemised in the service report, with old units removed for licensed disposal / recharge.' },
    extra: [['Pressurised cylinders — accidental discharge, CO₂ in small rooms (asphyxiation, cold burns)', 'Operative, occupants', 'Safety pins and tamper seals checked before handling; units carried by the body, not the handle', 8, 'No discharge testing on site; CO₂ never discharged in enclosed spaces', 3], ['Manual handling — carrying several extinguishers', 'Operative', 'Trolley used; no more than two units carried at once', 6, 'Route cleared before carrying', 2]],
    plant: ['Extinguisher trolley', 'Weighing scales (CO₂)', 'Service labels and tamper seals', 'Signage', 'FSCF Ireland app'],
  },
};

const checkSteps = (kit) => {
  // the 6-point check as described in the owner's inspection RAMS (FSCF-RAMS-21, method 7–12)
  if (/6 point/i.test(kit?.name || '')) {
    return ['Fire register — check whether any noted faults in the fire register have been addressed.', 'Closing action — confirm the door closes fully onto its latch / keep from various opening angles under its own closer, and the receiver engages.', 'Gaps — check the perimeter and threshold gaps are consistent with a certified fire door assembly (target 2–4 mm), using a calibrated gap gauge.', 'Seals — confirm intumescent and smoke seals are present, continuous and undamaged around the leaf and frame.', 'Signage — confirm the correct fire door signage is fitted on both sides, appropriate to the door type.', 'Ironmongery — confirm hinges, closer, locks, latches, hold-open or free-swing devices and any glazing are present, secure and operational. Hold-open devices are tested manually only; the client is advised to carry out a weekly fire alarm activation.'];
  }
  // any other checklist: its own questions (each carries its reference in the app)
  const qs = (kit?.questions || []).map((q) => String(q.text || q[0] || '').trim()).filter(Boolean);
  return qs;
};

// Build the full RAMS for a visit. ctx: { trade, work, kit, site, address, client, customer, contact, phone, email,
// visitPath, drawings, ae, dates, persons, siteNotes, visitNotes, ref, rev, date }
export function buildRams(ctx) {
  const trade = TRADES[ctx.trade] ? ctx.trade : 'fd';
  const work = WORKS[ctx.work] ? ctx.work : 'insp';
  let tpl;
  if (trade === 'fd') tpl = T[`fd:${work}`];
  else {
    const o = OTHER[trade];
    const isInsp = work === 'insp';
    tpl = {
      source: SRC.other(o.std),
      scope: [o.scope[isInsp ? 'insp' : 'rem'], isInsp ? 'This is an inspection and reporting visit; repairs are quoted separately.' : 'Each item is tested and left working before moving to the next; nothing is left out of service when work stops.'],
      legislation: [...LEGIS_BASE, ...o.legislation],
      risks: [...o.extra, R.wah, R.electric, R.rooms, R.privacy, R.lone, R.slips, R.alarm, ...(isInsp ? [] : [R.tools, R.waste])],
      before: ['Before the first visit, agree the dates, times and access with the client contact, and any interface with other systems (fire alarm, BMS, monitoring centre).', 'On arrival each day, sign in with the site contact, wear ID, confirm the areas for the day and any restrictions, and the fire alarm and evacuation arrangements.'],
      setup: [`Each ${TRADES[trade].toLowerCase().replace(/s$/, '')} is identified by its numbered pin on the FSCF Ireland app drawing.`, 'Work-in-progress signage is used where needed; ladders are set up only in controlled areas.'],
      after: ['Findings are recorded against each pin reference, with photographs of the item only.', 'Every system and item is left as found or working, and the site contact told of anything left out of service and why.', 'Areas are left clean and clear; sign out with the site contact.', isInsp ? 'A written report is issued to the client after the visit.' : 'A completion record is issued to the client after the works.'],
      ppe: PPE_BASE,
      training: ['Competent person for the system concerned (trained and experienced in its inspection / servicing)', ...TRAIN_BASE],
      plant: o.plant,
    };
  }
  const checks = work === 'insp' ? checkSteps(ctx.kit) : [];
  const method = [
    ['Before starting', tpl.before],
    ['Setting up', tpl.setup],
    ...(checks.length ? [[`The inspection — ${ctx.kit?.name || 'checklist'}${checks.length ? ` (${checks.length} checks)` : ''}`, checks]] : []),
    [work === 'insp' ? 'Exits, special areas, recording and finishing' : 'The works, recording and finishing', tpl.after],
  ];
  return { ...ctx, trade, work, tradeName: TRADES[trade], workName: WORKS[work], source: tpl.source, scope: tpl.scope, legislation: tpl.legislation, risks: tpl.risks, method, ppe: tpl.ppe, training: tpl.training, plant: tpl.plant };
}

// Short HTML preview of the generic part (shown in the app before signing)
export function ramsHtml(r, esc) {
  const list = (a) => `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  return `
    <p class="small muted">Made from ${esc(r.source)}.</p>
    <h4>1. Scope of works</h4>${list(r.scope)}
    <h4>2. Legislation &amp; standards</h4>${list(r.legislation)}
    <h4>3. Risk assessment</h4><p>${esc(MATRIX_NOTE[0])}</p>
    <div class="rams-tw"><table class="rams-matrix"><tr><th>Likelihood ↓ / Severity →</th>${[1, 2, 3, 4, 5].map((j) => `<th>${j}</th>`).join('')}</tr>${[1, 2, 3, 4, 5].map((i) => `<tr><th>${i}</th>${[1, 2, 3, 4, 5].map((j) => `<td class="rb-${bandName(i * j)}">${i * j}</td>`).join('')}</tr>`).join('')}</table></div>
    <p class="small">${esc(MATRIX_NOTE.slice(1).join(' '))}</p>
    <div class="rams-risks">${r.risks.map(([h, w, e, pre, a, res]) => `<div class="rams-risk"><b>${esc(h)}</b><small>Who might be harmed: ${esc(w)}</small><small>${esc(e)}</small><span class="rams-rate"><em class="rb-${bandName(pre)}">Pre ${esc(rating(pre))}</em><em class="rb-${bandName(res)}">Residual ${esc(rating(res))}</em></span><small>Additional: ${esc(a)}</small></div>`).join('')}</div>
    <h4>4. Method statement</h4>${r.method.map(([h, steps]) => `<p><b>${esc(h)}</b></p><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`).join('')}
    <h4>5. PPE</h4>${list(r.ppe)}
    <h4>6. Training &amp; competency</h4>${list(r.training)}
    <h4>7. Plant &amp; equipment</h4>${list(r.plant)}
    <h4>8. Emergency arrangements</h4>${list(EMERGENCY_STEPS)}`;
}

// ---------- PDF in the owner's own RAMS layout (as FSCF-RAMS-21 / FSCF-RAMS-14 / CVL-001-REM-001) ----------
// Copper running header and title, peach label column, dark table headers, the coloured 5×5 risk
// matrix, a risk register with green / amber / red rating cells, steps numbered straight through,
// and the FSCF address in the footer of every page.
const ORANGE = [222, 110, 32];
const PEACH = [246, 228, 210];
const DARK = [45, 45, 45];
const INK = [30, 30, 30];
const GREY = [90, 90, 90];
const BAND = { low: [198, 239, 206], med: [255, 235, 156], high: [255, 199, 206] };
const band = (n) => (n >= 15 ? BAND.high : n >= 8 ? BAND.med : BAND.low);
const LIK = ['1 Rare', '2 Unlikely', '3 Possible', '4 Likely', '5 Almost Certain'];
const SEV = ['1 Negligible', '2 Minor', '3 Moderate', '4 Major', '5 Severe'];

export async function ramsPdf(r, lists) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  capsPdf(doc);
  const W = 210; const M = 16; const CW = W - 2 * M; const BOTTOM = 280;
  let y = 22;
  const font = (s, z, c = INK) => { doc.setFont('helvetica', s); doc.setFontSize(z); doc.setTextColor(...c); };
  const need = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = 20; } };
  const head = (t) => { need(16); y += 3; font('bold', 12.5, ORANGE); doc.text(t, M, y); y += 7; };
  const sub = (t) => { need(10); font('bold', 9.8, INK); doc.text(t, M, y); y += 5.5; };
  const para = (t, z = 9.2, c = INK) => { font('normal', z, c); for (const ln of doc.splitTextToSize(t, CW)) { need(5); doc.text(ln, M, y); y += 4.5; } y += 1.5; };
  const bullets = (a) => { for (const t of a) { font('normal', 9.2); const lines = doc.splitTextToSize(t, CW - 8); need(lines.length * 4.5 + 1); doc.text('•', M + 1.5, y); lines.forEach((ln, k) => doc.text(ln, M + 8, y + k * 4.5)); y += lines.length * 4.5 + 1.4; } y += 1; };
  let stepNo = 0;
  const steps = (a) => { for (const t of a) { stepNo++; font('normal', 9.2); const lines = doc.splitTextToSize(t, CW - 9); need(lines.length * 4.5 + 1); font('bold', 9.2); doc.text(`${stepNo}.`, M + 1, y); font('normal', 9.2); lines.forEach((ln, k) => doc.text(ln, M + 9, y + k * 4.5)); y += lines.length * 4.5 + 1.6; } y += 1; };
  const table = (opts) => { doc.autoTable({ margin: { left: M, right: M }, theme: 'grid', styles: { fontSize: 8.4, cellPadding: 1.6, textColor: INK, lineColor: [60, 60, 60], lineWidth: 0.15, valign: 'top' }, headStyles: { fillColor: DARK, textColor: 255, fontStyle: 'bold' }, ...opts, startY: y }); y = doc.lastAutoTable.finalY + 6; };

  // title block, as the owner's RAMS
  font('bold', 22, ORANGE); doc.text('FSCF IRELAND', M, y); y += 6;
  font('normal', 8.6, GREY); doc.text('Fire Door Inspection · Remedial Repair · Fire Stopping · Installation', M, y); y += 9;
  font('bold', 14, INK); doc.text('RISK ASSESSMENT & METHOD STATEMENT', M, y); y += 7;
  font('bold', 10.5, INK);
  for (const ln of doc.splitTextToSize(`${r.tradeName} ${r.workName} — ${r.site || ''}`, CW)) { doc.text(ln, M, y); y += 5; }
  y += 2;
  table({
    body: [
      ['RAMS Reference', r.ref || ''], ['Revision / Date', `${r.rev || 'Rev 0'} — ${r.date || ''}`], ['Site Name', r.site || ''], ['Site Address', r.address || '[TO BE CONFIRMED]'],
      ['Client / Organisation', [r.client, r.customer ? `customer ID ${r.customer}` : ''].filter(Boolean).join(' — ') || '[TO BE CONFIRMED]'],
      ['Client Contact', [r.contact, r.phone, r.email].filter(Boolean).join(' — ') || '[TO BE CONFIRMED]'],
      ['Visit', [r.visitPath, (r.drawings || []).join(', ')].filter(Boolean).join(' — ')],
      ['Work / Check', `${r.workName}${r.work === 'insp' && r.kit?.name ? ' — ' + r.kit.name : ''}`],
      ['Nearest A&E Hospital', r.ae || '[TO BE CONFIRMED]. 112/999 if life-threatening.'],
      ['Date(s) of Works', r.dates || '[TO BE CONFIRMED]'], ['Person(s) in Charge', r.persons || 'Mark Crosby (Director, DipFD)'], ['Prepared By', FSCF_ADDR],
    ],
    columnStyles: { 0: { cellWidth: 40, fontStyle: 'bold', fillColor: PEACH } },
  });

  head('1. Scope of Works'); bullets(r.scope);
  if (r.siteNotes) { sub('Site-specific notes'); para(r.siteNotes); }
  if (r.visitNotes) { sub('Project / visit notes'); para(r.visitNotes); }
  head('2. Legislation & Standards');
  para('The following legislation and standards apply to this work (EN standards are used in preference to British Standards wherever a suitable EN equivalent exists):');
  bullets(r.legislation);
  head('3. Roles & Responsibilities');
  table({
    head: [['Role', 'Responsibilities']],
    body: [
      ['Mark Crosby — Director / DipFD', 'Overall responsibility for this RAMS, competency, sign-off of high-risk items, and liaison with the client and site contacts.'],
      ['Operative(s)', 'Briefed on this RAMS and sign it before starting work on the visit. Follow the method statement and stop work if conditions change.'],
      [r.contact ? `${r.contact} — client contact` : 'Client contact', 'Scope, access and reporting.'],
      ['Site contact', 'Access, keys, locked rooms and other locked areas; agrees the order and times of work; the site\'s fire and evacuation arrangements.'],
    ],
    columnStyles: { 0: { cellWidth: 55 } },
  });

  head('4. Risk Assessment');
  para(MATRIX_NOTE[0]);
  need(40);
  table({
    head: [['Likelihood ↓ / Severity →', ...SEV]],
    body: LIK.map((l, i) => [l, ...SEV.map((_, j) => String((i + 1) * (j + 1)))]),
    styles: { fontSize: 8.2, cellPadding: 1.4, textColor: INK, lineColor: [60, 60, 60], lineWidth: 0.15, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 38, fontStyle: 'normal' } },
    didParseCell: (d) => { if (d.section === 'body' && d.column.index > 0) d.cell.styles.fillColor = band(Number(d.cell.raw)); },
  });
  para(`${MATRIX_NOTE[1]}  ${MATRIX_NOTE[2]}  ${MATRIX_NOTE[3]}`, 8.8);
  sub('Risk Assessment Register');
  table({
    head: [['Hazard', 'Who might be harmed', 'Existing controls', 'Pre', 'Additional controls', 'Res.']],
    body: r.risks.map(([h, w, e, pre, a, res]) => [h, w, e, rating(pre), a, rating(res)]),
    styles: { fontSize: 7.6, cellPadding: 1.4, textColor: INK, lineColor: [60, 60, 60], lineWidth: 0.15, valign: 'top' },
    columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 20 }, 2: { cellWidth: 41 }, 3: { cellWidth: 16, fontStyle: 'bold' }, 4: { cellWidth: 55 }, 5: { cellWidth: 16, fontStyle: 'bold' } },
    didParseCell: (d) => { if (d.section === 'body' && (d.column.index === 3 || d.column.index === 5)) d.cell.styles.fillColor = band(parseInt(d.cell.raw, 10) || 0); },
  });

  head(`5. Method Statement — ${r.workName}${r.work === 'insp' && r.kit?.name ? ` (${r.kit.name})` : ''}`);
  for (const [h, list] of r.method) { sub(h); steps(list); }
  head('6. Personal Protective Equipment (PPE)'); bullets(r.ppe);
  head('7. Training & Competency'); bullets(r.training);
  head('8. Plant & Equipment'); bullets(r.plant);
  head('9. Emergency Arrangements');
  table({
    body: [
      ['A&E Hospital', r.ae || '[TO BE CONFIRMED with the site contact on arrival]'],
      ['Emergency Services', 'Dial 999 or 112 immediately'],
      ['Site First Aider', '[TO BE CONFIRMED with the site contact on arrival]'],
      ['Assembly Point', '[TO BE CONFIRMED with the site contact on arrival]'],
      ['Site Emergency Procedure', EMERGENCY_STEPS.map((x, i) => `${i + 1}. ${x}`).join('\n')],
    ],
    columnStyles: { 0: { cellWidth: 40, fontStyle: 'bold', fillColor: PEACH } },
  });
  head('10. Sign-Off'); para(SIGNOFF_TEXT);
  need(24);
  table({
    head: [['Print Name', 'Role', 'Signature', 'Date']],
    body: [...(r.signers || []).map((s) => [s.name, s.role || 'Operative', '', new Date(s.at).toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' })]), ['', 'Operative', '', ''], ['', 'Operative', '', '']],
    styles: { fontSize: 8.6, cellPadding: 2, textColor: INK, lineColor: [60, 60, 60], lineWidth: 0.15, minCellHeight: 14, valign: 'middle' },
    headStyles: { fillColor: DARK, textColor: 255, fontStyle: 'bold', minCellHeight: 6 },
    columnStyles: { 2: { cellWidth: 50 } },
    didDrawCell: (d) => {
      const s = r.signers?.[d.row.index];
      if (d.section === 'body' && d.column.index === 2 && s?.sig?.data) {
        const k = Math.min(46 / s.sig.w, 11 / s.sig.h);
        try { doc.addImage(s.sig.data, 'PNG', d.cell.x + 2, d.cell.y + 1.5, s.sig.w * k, s.sig.h * k); } catch { /* signature image unreadable */ }
      }
    },
  });
  font('normal', 7.4, GREY); for (const ln of doc.splitTextToSize(`Generic part made from ${r.source}. Site details, drawings, notes and signatures added for this visit in the FSCF Ireland app.`, CW)) { need(4); doc.text(ln, M, y); y += 3.6; }

  // running header and footer on every page, as the owner's RAMS
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    font('normal', 7.6, ORANGE); doc.text(`FSCF Ireland  |  ${r.ref || 'RAMS'}`, M, 11);
    font('normal', 7.4, GREY); doc.text(`${FSCF_ADDR}  ·  Page ${i} of ${n}`, W / 2, 290, { align: 'center' });
  }
  return doc.output('blob');
}
