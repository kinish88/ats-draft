// lib/draftOrder.ts

export type Player = { id: string; display_name: string };
export type Phase = 'ats' | 'ou';

/** Number of ATS rounds per week. Keep it odd to make O/U start as reverse of R1. */
export const ATS_ROUNDS = 3;

export type DraftState = {
  /** 0-based across *all* picks in the week (ATS first, then O/U). */
  current_pick_number: number;
  /** Round-1 order for the *current* week (already rotated). */
  players: Player[];
};

/* -------------------------------------------------------------------------- */
/*                             Rotation / Round-1                             */
/* -------------------------------------------------------------------------- */

/** Rotate a base Round-1 list forward by (week-1) positions. */
export function roundOneOrderForWeek(base: Player[], week: number): Player[] {
  const n = base.length;
  const start = ((week - 1) % n + n) % n;
  return Array.from({ length: n }, (_, i) => base[(start + i) % n]);
}

/** Convenience: identity + reverse if you ever need them. */
export function roundOneOrder(players: Player[]) { return players; }
export function roundOneReverse(players: Player[]) { return [...players].reverse(); }

/* -------------------------------------------------------------------------- */
/*                               Turn calculation                             */
/* -------------------------------------------------------------------------- */

export function totalAtsPicks(playersCount: number) {
  return playersCount * ATS_ROUNDS;
}

/** ATS snake: R1 forward, R2 reverse, R3 forward (general for any ATS_ROUNDS). */
export function onClockATS(playersR1: Player[], atsPickNumber: number): Player {
  const n = playersR1.length;
  const round = Math.floor(atsPickNumber / n);   // 0..ATS_ROUNDS-1
  const idxInRound = atsPickNumber % n;          // 0..n-1
  const orderIdx = round % 2 === 0 ? idxInRound : n - 1 - idxInRound;
  return playersR1[orderIdx];
}

/**
 * O/U “carry the snake”:
 * If the last ATS round is forward (ATS_ROUNDS odd), O/U starts in reverse of R1.
 * If the last ATS round is reverse (ATS_ROUNDS even), O/U follows R1.
 */
export function onClockOUCarrySnake(playersR1: Player[], ouPickNumber: number): Player {
  const n = playersR1.length;
  const lastAtsRoundIsForward = (ATS_ROUNDS - 1) % 2 === 0;
  const order = lastAtsRoundIsForward ? roundOneReverse(playersR1) : playersR1;
  return order[ouPickNumber % n];
}

/** Alias used elsewhere; same behavior. */
export const onClockOU = onClockOUCarrySnake;

/** Unified on-clock for both phases using the *week’s* Round-1 order. */
export function whoIsOnClock(state: DraftState): { phase: Phase; player: Player } {
  const { players, current_pick_number } = state;
  const n = players.length;
  const atsTotal = totalAtsPicks(n);

  if (current_pick_number < atsTotal) {
    return { phase: 'ats', player: onClockATS(players, current_pick_number) };
  }
  const ouPickNumber = current_pick_number - atsTotal;
  return { phase: 'ou', player: onClockOUCarrySnake(players, ouPickNumber) };
}

/* -------------------------------------------------------------------------- */
/*                                  Debugging                                 */
/* -------------------------------------------------------------------------- */

export function previewSequence(playersR1: Player[]) {
  const n = playersR1.length;
  const atsTotal = totalAtsPicks(n);
  return {
    ats: Array.from({ length: atsTotal }, (_, i) => onClockATS(playersR1, i).display_name),
    ou:  Array.from({ length: n },        (_, i) => onClockOUCarrySnake(playersR1, i).display_name),
  };
}
