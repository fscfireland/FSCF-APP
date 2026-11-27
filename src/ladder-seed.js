// The owner's two ladders and their past checks, read from his signed ladder check PDFs in Google Drive
// (Ladder_Checks_2026.zip: Waku 4-step, 36 weekly checks 02/03–02/11/2026; "Ladder Check WK2207B-3J 2026-11-17.pdf").
// Every one: location Other – Home (pre-work check), for FSCF Ireland, Mark Crosby (Director), method Visual, item 6
// (timber only) N/A and the rest Pass, no damage, fit for use: Yes, used in accordance: Yes, result Passed.
// Added once per device by main.js (seedLadders); a ladder the owner already added with the same number is reused.
export const SEED_LADDERS = [
  { key: 'waku4', ref: 'Waku 4-step', type: 'Stepladder', make: 'Waku 4-step stepladder' },
  { key: 'wk2207b3j', ref: 'WK2207B-3J', type: 'Stepladder', make: 'Waku WK2207B-3J step ladder (3-step, handrail)' },
];
// [ladder key, date, re-inspection date, items 1–12 (p = pass, n = N/A, f = fail), original file]
export const SEED_CHECKS = [
  ['waku4', '2026-03-02', '2026-03-09', 'pppppnpppppp', "Ladder Check 2026-03-02.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-03-09', '2026-03-16', 'pppppnpppppp', "Ladder Check 2026-03-09.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-03-16', '2026-03-23', 'pppppnpppppp', "Ladder Check 2026-03-16.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-03-23', '2026-03-30', 'pppppnpppppp', "Ladder Check 2026-03-23.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-03-30', '2026-04-07', 'pppppnpppppp', "Ladder Check 2026-03-30.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-04-07', '2026-04-13', 'pppppnpppppp', "Ladder Check 2026-04-07.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-04-13', '2026-04-20', 'pppppnpppppp', "Ladder Check 2026-04-13.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-04-20', '2026-04-27', 'pppppnpppppp', "Ladder Check 2026-04-20.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-04-27', '2026-05-05', 'pppppnpppppp', "Ladder Check 2026-04-27.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-05-05', '2026-05-11', 'pppppnpppppp', "Ladder Check 2026-05-05.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-05-11', '2026-05-18', 'pppppnpppppp', "Ladder Check 2026-05-11.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-05-18', '2026-05-25', 'pppppnpppppp', "Ladder Check 2026-05-18.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-05-25', '2026-06-02', 'pppppnpppppp', "Ladder Check 2026-05-25.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-06-02', '2026-06-08', 'pppppnpppppp', "Ladder Check 2026-06-02.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-06-08', '2026-06-15', 'pppppnpppppp', "Ladder Check 2026-06-08.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-06-15', '2026-06-22', 'pppppnpppppp', "Ladder Check 2026-06-15.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-06-22', '2026-06-29', 'pppppnpppppp', "Ladder Check 2026-06-22.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-06-29', '2026-07-06', 'pppppnpppppp', "Ladder Check 2026-06-29.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-07-06', '2026-07-13', 'pppppnpppppp', "Ladder Check 2026-07-06.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-07-13', '2026-07-20', 'pppppnpppppp', "Ladder Check 2026-07-13.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-07-20', '2026-07-27', 'pppppnpppppp', "Ladder Check 2026-07-20.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-07-27', '2026-08-04', 'pppppnpppppp', "Ladder Check 2026-07-27.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-08-04', '2026-08-10', 'pppppnpppppp', "Ladder Check 2026-08-04.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-08-10', '2026-08-17', 'pppppnpppppp', "Ladder Check 2026-08-10.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-08-17', '2026-08-24', 'pppppnpppppp', "Ladder Check 2026-08-17.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-08-24', '2026-08-31', 'pppppnpppppp', "Ladder Check 2026-08-24.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-08-31', '2026-09-07', 'pppppnpppppp', "Ladder Check 2026-08-31.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-09-07', '2026-09-14', 'pppppnpppppp', "Ladder Check 2026-09-07.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-09-14', '2026-09-21', 'pppppnpppppp', "Ladder Check 2026-09-14.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-09-21', '2026-09-28', 'pppppnpppppp', "Ladder Check 2026-09-21.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-09-28', '2026-10-05', 'pppppnpppppp', "Ladder Check 2026-09-28.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-10-05', '2026-10-12', 'pppppnpppppp', "Ladder Check 2026-10-05.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-10-12', '2026-10-19', 'pppppnpppppp', "Ladder Check 2026-10-12.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-10-19', '2026-10-27', 'pppppnpppppp', "Ladder Check 2026-10-19.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-10-27', '2026-11-02', 'pppppnpppppp', "Ladder Check 2026-10-27.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['waku4', '2026-11-02', '2026-11-09', 'pppppnpppppp', "Ladder Check 2026-11-02.pdf (Ladder_Checks_2026.zip in Google Drive)"],
  ['wk2207b3j', '2026-11-17', '2026-11-23', 'pppppnpppppp', "Ladder Check WK2207B-3J 2026-11-17.pdf (Google Drive)"],
];
