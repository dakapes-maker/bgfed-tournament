/* ---------------------------------------------------------------------- */
/* Storage helpers                                                        */
/* ---------------------------------------------------------------------- */

// Season rules (best-of, qualification cut-offs) are per season since Build
// 3A — see rulesForSeason().

// Tournament finance rules (per player, in euros)
export const BUYIN_FULL = 40;
export const POT_SHARE_PER_PLAYER = 32; // both tiers contribute the same amount to the prize pool
export const FEDERATION_SHARE_PER_PLAYER = 6; // waived for board members
export const VENUE_SHARE_PER_PLAYER = 2; // waived for board members
export const RUNNER_UP_PRIZE = 60; // fixed payout per player one win short of a perfect score
export const CUP_COST = 15; // deducted from a perfect-score winner's cash prize if they choose a cup

/* ---------------------------------------------------------------------- */
/* Browser storage keys                                                    */
/* ---------------------------------------------------------------------- */

export const WHATS_NEW_SEEN_KEY = "bgfed_whatsnew_seen_build";
export const LANG_STORAGE_KEY = "bgfed_lang";
