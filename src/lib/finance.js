import { BUYIN_FULL, POT_SHARE_PER_PLAYER, FEDERATION_SHARE_PER_PLAYER, VENUE_SHARE_PER_PLAYER, RUNNER_UP_PRIZE } from "../config/constants.js";

export function computeTournamentFinance(players, totalRounds) {
  const active = players; // withdrawn players still paid to enter; finance is per entrant
  const totalPlayers = active.length;
  const discounted = active.filter((p) => p.hasDiscount);
  const regular = active.filter((p) => !p.hasDiscount);
  const discountedTotal = discounted.reduce((s, p) => s + (p.discountAmount ?? 32), 0);
  const totalCollected = discountedTotal + regular.length * BUYIN_FULL;
  const federationTotal = regular.length * FEDERATION_SHARE_PER_PLAYER;
  const venueTotal = regular.length * VENUE_SHARE_PER_PLAYER;
  // A discounted entrant's whole payment goes to the pot (that's the point of
  // the discount — no Federation/venue share); a full-price entrant's pot
  // share is the fixed 32€ regardless of the 40€ they paid in total.
  const prizePool = discountedTotal + regular.length * POT_SHARE_PER_PLAYER;

  // A player only qualifies for a final prize once they've actually played
  // out all their matches — reaching "4 wins" with a round still to go
  // doesn't yet mean "4/5", since they could still win it and become 5/5.
  const hasCompleted = (p) => p.matchLog.length >= totalRounds;
  const runnerUps = active.filter((p) => hasCompleted(p) && p.wins === totalRounds - 1);
  const perfects = active.filter((p) => hasCompleted(p) && p.wins === totalRounds);
  const runnerUpTotal = runnerUps.length * RUNNER_UP_PRIZE;
  const remainingForPerfects = prizePool - runnerUpTotal;
  const perfectShare = perfects.length > 0 ? remainingForPerfects / perfects.length : 0;
  const shortfall = remainingForPerfects < 0;

  return {
    totalPlayers, discounted, regular, totalCollected, federationTotal, venueTotal, prizePool,
    runnerUps, perfects, runnerUpTotal, remainingForPerfects, perfectShare, shortfall,
  };
}

/** A side bet's winner(s) are whichever participant(s) have the most wins —
 * byes and opponent-retirement wins count the same as any other win, since
 * that's just this tournament's existing win count. Ties split the pool
 * evenly. */
export function computeSideBetResult(bet, playersById) {
  const participants = bet.participantIds.map((id) => playersById[id]).filter(Boolean);
  const pool = bet.amountPerPlayer * participants.length;
  if (participants.length === 0) return { pool, winners: [], share: 0 };
  const maxWins = Math.max(...participants.map((p) => p.wins));
  const winners = participants.filter((p) => p.wins === maxWins);
  const share = winners.length > 0 ? pool / winners.length : 0;
  return { pool, winners, share, maxWins };
}

/** The Calcutta pool is only paid out once the tournament winner(s) have
 * actually completed all their matches (same "hasCompleted" rule as the
 * official prize pool). A perfect-score winner who nobody bought just
 * doesn't get paid out — that portion of the pool isn't distributed. */
export function computeCalcuttaResult(entries, players, totalRounds) {
  const pool = entries.reduce((s, e) => s + e.amount, 0);
  const hasCompleted = (p) => p.matchLog.length >= totalRounds;
  const winners = players.filter((p) => hasCompleted(p) && p.wins === totalRounds);
  const share = winners.length > 0 ? pool / winners.length : 0;
  const payouts = winners.map((w) => {
    const entry = entries.find((e) => e.playerId === w.id);
    return { player: w, buyer: entry ? entry.buyer : null, amount: entry ? share : 0, sold: !!entry };
  });
  return { pool, winners, share, payouts };
}
