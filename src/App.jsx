import React, { useState, useRef, useEffect } from "react";
import {
  Trophy,
  Plus,
  X,
  ArrowRight,
  ArrowLeft,
  Download,
  Link as LinkIcon,
  Upload,
  RotateCcw,
  UserX,
  Info,
  Check,
  Search,
  Pencil,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Users,
  Save,
  Award,
  Lock,
  Trash2,
  AlertTriangle,
  LayoutGrid,
  List,
  FileSpreadsheet,
} from "lucide-react";
import {
  loadUserDocStrict,
  loadContactsStrict,
  saveContacts,
  saveRegistry,
  loadElo,
  saveElo,
  saveIndex,
  saveTournamentData,
  fetchTournamentData,
  deleteTournamentData,
  loadSeason,
  saveSeason,
  listSeasonYears,
  loadFeedItemsStrict,
  saveFeedItems,
  loadRegistryStrict,
  loadEloStrict,
  loadIndexStrict,
  loadSeasonStrict,
  fetchTournamentDataStrict,
  listSeasonYearsStrict,
} from "./firebase.js";

import { APP_BUILD_VERSION, FEATURES_SUMMARY, TECHNICAL_SUMMARY } from "./config/build.js";
import { changelogFor, changelogKey, formatChangelogDate } from "./config/changelog.js";
import { WHATS_NEW_SEEN_KEY, LANG_STORAGE_KEY } from "./config/constants.js";
import { TRANSLATIONS } from "./config/i18n.js";
import { ELO_INITIAL, eloWinProbability, eloPointsAtStake, applyEloRoundBatch, buildEloRoundMatches, markEloApplied } from "./lib/elo.js";
import {
  PERSON_DISPLAY,
  setPersonLookup,
  baseName,
  normalizeName,
  displayNameFor,
  newPersonId,
  personSpellings,
  editDistance,
  wordsOf,
  findLookalikePersons,
  formatNameForDisplay,
  stripAccents,
  nextRegNo,
  formatRegNo,
  buildMigrationPlan,
  buildMigratedRegistry,
} from "./lib/persons.js";
import { nameSkeletons, skeletonsMinDistance, sourceSurname, titleCaseName } from "./lib/nameSkeleton.js";
import {
  pushSeasonUpdate,
  computeSeasonStandings,
  isoToLocalYMD,
  withLocalDate,
  seasonForDate,
  rulesForSeason,
  seasonLocked,
  seasonFingerprint,
  seasonRangeLabel,
  tournamentInScope,
  scopeLabel,
} from "./lib/seasons.js";
import { seasonCompetitionId, seasonsOfCompetition, currentSeasonId, seasonName, nextSeasonId } from "./lib/seasonRegistry.js";
import {
  newCalendarEntryId,
  todayYMD,
  buildCalendarView,
  calendarProgress,
  calendarEntryTitle,
  CAL_STATUS_LABEL,
  formatYMD,
} from "./lib/calendar.js";
import {
  DEFAULT_COMPETITION_ID,
  DEFAULT_COMPETITIONS,
  ELO_POOLS,
  competitionById,
  eloPoolOf,
  COMPETITION_LEVEL_LABEL,
  competitionsFrom,
  countsTowardRatings,
  competitionLabel,
  competitionName,
  setRuntimeCompetitionState,
  competitionHasStandings,
} from "./lib/competitions.js";
import { normClubKey, newClubId, clubsFrom, clubsActive, clubDisplay } from "./lib/clubs.js";
import { SYS_TRASH_ID, SYS_STATE_ID, SYS_IMPORTS_ID, saveSysTrash, saveSysState } from "./lib/sysDocs.js";
import { importCompetitionId, sourceSheetsOf, importSeason, importDateIso, validateImport } from "./lib/imports.js";
import { buildConsistencyReport, describeStaleReasons, shortTournamentLabel } from "./lib/consistency.js";
import { generatePairings, replayPlayersFromHistory, computeBuchholz, sortStandings } from "./lib/swiss.js";
import { buildXlsx } from "./lib/xlsx.js";
import { isEmbeddedOnFederationSite, formatDate } from "./lib/utils.js";
import { SEED_PLAYERS, HISTORICAL_IMPORT_2026, HISTORICAL_ELO_ROUNDS_2026, HISTORICAL_TOURNAMENTS_2026 } from "./data/history2026.js";
import { ConfirmDialog } from "./components/ConfirmDialog.jsx";
import { StandingsTable } from "./components/StandingsTable.jsx";
import { ConsistencyReportView } from "./components/ConsistencyReportView.jsx";
import { PlayerTrendCharts } from "./components/charts.jsx";
import { MoveToTrashControl, TrashRow } from "./components/trash.jsx";
import { CalcuttaTab, FinanceTab } from "./components/finance.jsx";
import { watchAuth, signOutUser, resendVerification, refreshVerification } from "./lib/auth.js";
import { setPermissionUser } from "./lib/permissions.js";
import { mergeContacts, stripPrivate, splitRegistry, contactsSummary, moveContacts } from "./lib/privateContacts.js";
import { LoginDialog } from "./components/LoginDialog.jsx";
import { AccountMenu, AccountNotice } from "./components/AccountMenu.jsx";
import { ContactsMigrationCard } from "./components/ContactsMigrationCard.jsx";

/* ---------------------------------------------------------------------- */
/* Component                                                              */
/* ---------------------------------------------------------------------- */

export default function TournamentManager() {
  // #region Κατάσταση: βασικά, γλώσσα, «Σχετικά», Στατιστικά
  const idRef = useRef(0);
  const fileInputRef = useRef(null);
  const fullBackupInputRef = useRef(null);
  const makeId = () => {
    idRef.current += 1;
    return `p${idRef.current}`;
  };

  const inIframe = useRef(isEmbeddedOnFederationSite()).current;
  const [whatsNewSeen, setWhatsNewSeen] = useState(null); // last build whose changelog was opened ("" = never); null = unknown → no dot
  const [aboutTab, setAboutTab] = useState("features");
  const [expandedMatch, setExpandedMatch] = useState(null);
  const [recapText, setRecapText] = useState(null);
  const [recapLoading, setRecapLoading] = useState(false);
  const [h2hSelectedPlayer, setH2hSelectedPlayer] = useState("");
  const [h2hResult, setH2hResult] = useState(null);
  const [h2hLoading, setH2hLoading] = useState(false);
  const [h2hSearch, setH2hSearch] = useState("");
  const [h2hSortKey, setH2hSortKey] = useState("total");
  const [h2hSortDir, setH2hSortDir] = useState("desc");
  const [h2hExpandedOpponent, setH2hExpandedOpponent] = useState(null);
  const [statsResult, setStatsResult] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [seasonStatsResult, setSeasonStatsResult] = useState(null);
  const [seasonStatsLoading, setSeasonStatsLoading] = useState(false);
  const [seasonStatsYear, setSeasonStatsYear] = useState(seasonForDate(new Date().toISOString()) || new Date().getFullYear());
  const [confirmingClearFeed, setConfirmingClearFeed] = useState(false);
  const [playerDetailReturnPhase, setPlayerDetailReturnPhase] = useState("players");
  const [statsTab, setStatsTab] = useState("h2h");
  const [lang, setLang] = useState(() => {
    try {
      return window.localStorage.getItem(LANG_STORAGE_KEY) === "en" ? "en" : "el";
    } catch {
      return "el";
    }
  });
  const L = TRANSLATIONS[lang];
  function toggleLang() {
    const next = lang === "el" ? "en" : "el";
    setLang(next);
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }
  // #endregion Κατάσταση: βασικά, γλώσσα, «Σχετικά», Στατιστικά
  // #region Διαχειριστής / σύνδεση
  // Sign-in with Firebase Authentication (5A). An administrator is a signed-in
  // user with a verified email whose users/{uid} has role "admin" — the same
  // test the Firestore rules make. While this is being worked out the app
  // behaves as for a visitor, so no admin screen flashes up.
  const [authUser, setAuthUser] = useState(null); // { uid, email, emailVerified } or null
  const [authRights, setAuthRights] = useState("out"); // out | checking | unverified | none | admin | error
  const [adminDataReady, setAdminDataReady] = useState(false); // private contacts joined into the registry
  const [showLogin, setShowLogin] = useState(false);
  const isAdmin = authRights === "admin" && adminDataReady;
  // Red dot on «Σχετικά»: only for changelog lines this user can see that are
  // newer than the last build whose changelog they opened.
  const hasUnseenUpdate = whatsNewSeen !== null && changelogFor(isAdmin).some((e) => changelogKey(e) > whatsNewSeen);

  async function logoutAdmin() {
    try {
      await signOutUser();
    } catch {
      /* the listener below still sees the result */
    }
  }
  // #endregion Διαχειριστής / σύνδεση

  // #region Κατάσταση: τουρνουά, Διαχείριση, εισαγωγές, σεζόν & ημερολόγιο, σύλλογοι
  const [phase, setPhase] = useState("dashboard"); // dashboard | archive | setup | tournament | finished | season | players | elo
  const [tournamentId, setTournamentId] = useState(null);
  const [createdAt, setCreatedAt] = useState(null);
  const [tournamentName, setTournamentName] = useState("");
  const [totalRounds, setTotalRounds] = useState(5);
  const [matchLength, setMatchLength] = useState(7);
  const [sideBets, setSideBets] = useState([]);
  const [calcuttaEntries, setCalcuttaEntries] = useState([]);
  const [defaultSideBetAmount, setDefaultSideBetAmount] = useState(40);
  const [addToSideBet, setAddToSideBet] = useState(false);
  const [nameDropdownOpen, setNameDropdownOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingRedraw, setConfirmingRedraw] = useState(false);
  const [confirmingFinish, setConfirmingFinish] = useState(false);
  const [seasonYear, setSeasonYear] = useState(new Date().getFullYear());
  const [liveStandingsEnabled, setLiveStandingsEnabled] = useState(false);
  const [isOfficial, setIsOfficial] = useState(true); // Official League day — only these count in "Recompute from scratch"
  const [competitionId, setCompetitionId] = useState(DEFAULT_COMPETITION_ID); // Build 2: which competition this tournament belongs to
  const [organisation, setOrganisation] = useState(""); // Build 2: organising club; new tournaments default to the home club
  const [tournamentReturnPlayer, setTournamentReturnPlayer] = useState(null); // player card to go back to, when opened from its history
  const [metaEdit, setMetaEdit] = useState(null); // admin edit of date/season/competition/club: { date, seasonYear, competitionId, organisation }
  const [homeClubDraft, setHomeClubDraft] = useState(null);
  const [metaPlan, setMetaPlan] = useState(null); // dry-run report of the competitions/club migration
  const [metaBusy, setMetaBusy] = useState(false);
  const [controlSeasons, setControlSeasons] = useState([]); // seasons listed on the admin page
  const [controlTab, setControlTab] = useState("overview"); // admin page sub-menu
  const [controlCompId, setControlCompId] = useState(DEFAULT_COMPETITION_ID); // 5B.2β: competition whose seasons are shown
  const [lockOverrideId, setLockOverrideId] = useState(null); // tournament allowed to change although its season is locked (this session)
  const [lockTyped, setLockTyped] = useState(""); // typed year for lock / unlock confirmations
  const [lockAction, setLockAction] = useState(null); // { kind: "lock" | "unlock" | "tournament", year }
  const [recomputeLockConflict, setRecomputeLockConflict] = useState(null); // { years, indexOverride }
  const [excelDoneAt, setExcelDoneAt] = useState(null);
  const [eloLedgerOpen, setEloLedgerOpen] = useState(null);
  const [pairingsLayout, setPairingsLayout] = useState(() => {
    try {
      return localStorage.getItem("bgfed.pairingsLayout") === "list" ? "list" : "cards";
    } catch {
      return "cards";
    }
  }); // Pairings: "cards" (default) or "list", remembered per device
  const [importsList, setImportsList] = useState(null); // null = not loaded; [] = none
  const [importPreview, setImportPreview] = useState(null); // { doc, problems, summary, fileName, replaceId }
  const [importView, setImportView] = useState(null); // { id, doc, tab, round }
  const [importBusy, setImportBusy] = useState(false);
  const [importDateDraft, setImportDateDraft] = useState(null); // { date, dateEnd, dateAssumed }
  const [importConfirmDelete, setImportConfirmDelete] = useState(false);
  const importFileRef = useRef(null);
  const sourceFileRef = useRef(null);
  const [sourceLinkDraft, setSourceLinkDraft] = useState(null); // admin: link to the original file (e.g. Google Drive)
  const [importDocs, setImportDocs] = useState({}); // id -> imported tournament (public view, history, statistics)
  const [importReturn, setImportReturn] = useState(null); // where the public imported view goes back to
  const [historyCompetition, setHistoryCompetition] = useState(""); // player card history filter
  const [statsCompetition, setStatsCompetition] = useState("all");
  const [eloPool, setEloPool] = useState("club"); // ELO page: "club" (federation) or "national"
  const [cardEloPool, setCardEloPool] = useState(null); // player card: chosen ranking (null = automatic) // Statistics competition filter
  const [matchPlan, setMatchPlan] = useState(null); // { rows, imports } — player matching of the imports
  const [matchBusy, setMatchBusy] = useState(false);
  const matchFileRef = useRef(null); // ELO page: player whose rating breakdown is open // final standings exported in this session
  const [statsScope, setStatsScope] = useState("all"); // Build 3C: Statistics period — "all" or a season year
  const [archiveSeason, setArchiveSeason] = useState(""); // Build 3C: tournaments list filters
  const [archiveCompetition, setArchiveCompetition] = useState("");
  const [controlSeasonYear, setControlSeasonYear] = useState(seasonForDate(new Date().toISOString()) || new Date().getFullYear());
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [calendarEntryId, setCalendarEntryId] = useState(null); // the calendar day the open tournament belongs to
  const [calDraft, setCalDraft] = useState(null); // { year, id?, date, competitionId, note } while adding/editing a calendar day
  const [newSeasonYear, setNewSeasonYear] = useState(null); // "Νέα σεζόν" form
  const [calBusy, setCalBusy] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false); // visitors' schedule on the Season page
  const [organisationClubId, setOrganisationClubId] = useState(null); // Build 3B3: organising club of the open tournament
  const [clubPlan, setClubPlan] = useState(null); // dry-run of the clubs migration
  const [clubDecisions, setClubDecisions] = useState({}); // key -> "new" | other key
  const [clubNames, setClubNames] = useState({}); // key -> name of the new club
  const [clubBusy, setClubBusy] = useState(false);
  const [clubDraft, setClubDraft] = useState(null); // { id?, name } add / rename
  const [regNoPlan, setRegNoPlan] = useState(null);
  const [compDraft, setCompDraft] = useState(null); // { id?, name, ownerClubId, countsElo } add / rename a competition
  const [registryClubFilter, setRegistryClubFilter] = useState(""); // "" = all, "none" = without club, or a club id
  const [showGuests, setShowGuests] = useState(false); // dry-run of the registry numbers
  const [rulesDraft, setRulesDraft] = useState(null); // { year, bestOf, cutoffR32, cutoffR48 } while editing season rules
  const [players, setPlayers] = useState([]);
  const [round, setRound] = useState(1);
  const [currentPairings, setCurrentPairings] = useState(null);
  const [history, setHistory] = useState([]);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [view, setView] = useState("pairings");
  const [selectedRound, setSelectedRound] = useState(1);
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef(null);

  function showToast(message) {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 2500);
  }
  // #endregion Κατάσταση: τουρνουά, Διαχείριση, εισαγωγές, σεζόν & ημερολόγιο, σύλλογοι

  // #region Έλεγχος αποθηκεύσεων (κόκκινο πλαίσιο)
  /* ---- save results (Build 2) ----
   * Registry, ELO, the tournament catalogue and the RSS feed now report
   * whether they were saved. A failure stays on screen (admin banner) until
   * dismissed, naming what was not saved. If the database could not be read
   * at start-up, these writes are refused altogether: the app is then
   * holding empty stand-ins, and saving them would overwrite real data. */
  const [saveFailures, setSaveFailures] = useState([]); // [{ what, at }]
  const [startupReadFailed, setStartupReadFailed] = useState(false);
  const writesBlockedRef = useRef(false);

  function reportSaveFailure(what) {
    setSaveFailures((prev) => [...prev.filter((f) => f.what !== what), { what, at: new Date().toISOString() }]);
  }

  async function guardedSave(saveFn, what, arg) {
    if (writesBlockedRef.current) {
      reportSaveFailure(`${what} — δεν επιχειρήθηκε, γιατί η βάση δεν διαβάστηκε σωστά στην εκκίνηση`);
      return false;
    }
    const ok = await saveFn(arg);
    if (!ok) reportSaveFailure(what);
    return !!ok;
  }

  // Players' private details (5A). contactsRef: what was read for this
  // administrator (none | loaded | failed). registrySplitRef: the public
  // registry no longer holds private fields (contactsVersion: 1).
  const contactsRef = useRef({ status: "none", data: null });
  const registrySplitRef = useRef(false);

  /** Saves the registry. Once split, the public part goes to meta/registry
   * and the private part to private/contacts — never from details that were
   * not read successfully, which would wipe everybody's contacts. */
  async function saveRegistryChecked(data) {
    if (!(registrySplitRef.current || data.contactsVersion === 1)) {
      return guardedSave(saveRegistry, "Μητρώο παικτών", data);
    }
    if (contactsRef.current.status !== "loaded") {
      reportSaveFailure("Μητρώο παικτών — δεν επιχειρήθηκε, γιατί τα στοιχεία επικοινωνίας δεν διαβάστηκαν");
      return false;
    }
    const { publicRegistry, contacts } = splitRegistry(data, contactsRef.current.data);
    if (!(await guardedSave(saveContacts, "Στοιχεία επικοινωνίας", contacts))) return false;
    contactsRef.current = { status: "loaded", data: contacts };
    const ok = await guardedSave(saveRegistry, "Μητρώο παικτών", publicRegistry);
    if (ok) registrySplitRef.current = true;
    return ok;
  }
  const saveEloChecked = (data) => guardedSave(saveElo, "Κατάταξη ELO", data);
  const saveIndexChecked = (list) => guardedSave(saveIndex, "Κατάλογος τουρνουά", list);
  const saveFeedItemsChecked = (items) => guardedSave(saveFeedItems, "RSS feed", items);

  /** After the app itself saved a new ELO (end of tournament, live round),
   * show it at once instead of the copy read when the app was opened. */
  function showFreshElo(elo) {
    setEloData(elo);
    setEloTimeline(null);
    setPlayerMatchStatsCache({});
  }
  // #endregion Έλεγχος αποθηκεύσεων (κόκκινο πλαίσιο)

  // #region Κατάσταση: αρχείο, Βαθμολογία, μητρώο, ELO, κάδος, μόνιμα ID
  const [archive, setArchive] = useState([]);
  const [searchName, setSearchName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showAllArchive, setShowAllArchive] = useState(false);

  const [seasonBrowseYear, setSeasonBrowseYear] = useState(seasonForDate(new Date().toISOString()) || new Date().getFullYear());
  const [seasonYearsAvailable, setSeasonYearsAvailable] = useState([]);
  const [seasonData, setSeasonData] = useState({ players: {} });
  const [expandedPlayer, setExpandedPlayer] = useState(null);

  const [registry, setRegistry] = useState({ players: {} });
  const [registryLoaded, setRegistryLoaded] = useState(false);
  const [registrySearch, setRegistrySearch] = useState("");
  const [expandedRegistryPlayer, setExpandedRegistryPlayer] = useState(null);
  const [contactDraft, setContactDraft] = useState(null);
  const [confirmingDeletePlayer, setConfirmingDeletePlayer] = useState(null);
  const [playerHistoryCache, setPlayerHistoryCache] = useState({});
  const [playerMatchStatsCache, setPlayerMatchStatsCache] = useState({});
  const [playerDetailTab, setPlayerDetailTab] = useState("contact"); // contact | stats
  const [eloTimeline, setEloTimeline] = useState(null); // null = not computed yet
  const [eloTimelineLoading, setEloTimelineLoading] = useState(false);
  const [confirmingRecompute, setConfirmingRecompute] = useState(false);
  const [newMembershipYear, setNewMembershipYear] = useState(new Date().getFullYear());
  const [nameDisplayMode, setNameDisplayMode] = useState("normal"); // normal | upper | greeklish
  const [eloData, setEloData] = useState({ players: {} });
  setPersonLookup(registry);
  const [trash, setTrash] = useState([]); // tournaments moved to the trash (restorable)
  const [sysState, setSysState] = useState({}); // lastExportAt, purgedIds
  const sn = (id) => seasonName(sysState, id); // 5B.2β: display name of a season id
  setRuntimeCompetitionState(sysState);
  const [health, setHealth] = useState(null); // result of buildConsistencyReport (admin only)
  const [consistencyReport, setConsistencyReport] = useState(null);
  const [consistencyLoading, setConsistencyLoading] = useState(false);
  const [consistencyError, setConsistencyError] = useState("");
  const [trashBusy, setTrashBusy] = useState(false);
  const [identityPlan, setIdentityPlan] = useState(null); // dry-run report of the migration to permanent ids
  const [identityDecisions, setIdentityDecisions] = useState({});
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityPrompt, setIdentityPrompt] = useState(null); // "is it the same player?" question
  const [mergeFor, setMergeFor] = useState(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [mergeRecompute, setMergeRecompute] = useState(true);
  const [confirmingOfficial, setConfirmingOfficial] = useState(false);
  const [officialRecompute, setOfficialRecompute] = useState(true);
  const [trashAction, setTrashAction] = useState(null); // { type: "restore" | "purge" | "unofficial", id }
  // #endregion Κατάσταση: αρχείο, Βαθμολογία, μητρώο, ELO, κάδος, μόνιμα ID

  // #region Φόρτωση & εκκίνηση
  // Minimal deep-link support: a link ending in #season or #elo opens
  // straight into that tab, instead of always landing on the Dashboard.
  // Read once on load only — normal in-app navigation stays state-based.
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash === "season") setPhase("season");
    else if (hash === "elo") setPhase("elo");
    else if (hash === "elo-national") { setEloPool("national"); setPhase("elo"); }
    else if (hash === "about") setPhase("about");
    else if (hash.startsWith("tournament=")) openArchived(hash.slice("tournament=".length));
  }, []);

  // Flag the "Σχετικά" nav button with a red dot once per browser per build,
  // instead of forcing an interruption — pure localStorage, no Firestore.
  useEffect(() => {
    try {
      setWhatsNewSeen(window.localStorage.getItem(WHATS_NEW_SEEN_KEY) || "");
    } catch {
      // localStorage unavailable (private mode, etc.) — just skip silently.
    }
  }, []);

  function dismissWhatsNew() {
    setWhatsNewSeen(APP_BUILD_VERSION);
    try {
      window.localStorage.setItem(WHATS_NEW_SEEN_KEY, APP_BUILD_VERSION);
    } catch {
      // ignore
    }
  }

  // Sign-in state (5A): who is signed in and whether users/{uid} makes them
  // an administrator. Also clears the old shared-password flag that earlier
  // builds left in this browser (best effort).
  useEffect(() => {
    try {
      window.localStorage.removeItem("bgfed-admin-unlocked");
    } catch {
      /* ignore */
    }
    let seq = 0;
    return watchAuth(async (user) => {
      const mine = ++seq;
      if (!user) {
        setAuthUser(null);
        setAuthRights("out");
        return;
      }
      setAuthUser({ uid: user.uid, email: user.email, emailVerified: user.emailVerified });
      if (!user.emailVerified) {
        setAuthRights("unverified");
        return;
      }
      // A token refresh re-checks the rights without hiding admin screens meanwhile.
      setAuthRights((r) => (r === "admin" ? r : "checking"));
      let rights;
      try {
        const d = await loadUserDocStrict(user.uid);
        rights = d && d.role === "admin" ? "admin" : "none";
      } catch {
        rights = "error";
      }
      if (mine === seq) setAuthRights(rights);
    });
  }, []);

  // Every database write asks can() with the current user (firebase.js).
  useEffect(() => {
    setPermissionUser(authUser ? { uid: authUser.uid, email: authUser.email, isAdmin } : null);
  }, [authUser, isAdmin]);

  // An administrator reads private/contacts (strictly) and works with the
  // joined registry; a visitor never reads it. If the read FAILS, every
  // write is blocked: saving the registry then would wipe everybody's
  // details. Signing out forgets them again.
  useEffect(() => {
    if (authRights !== "admin") {
      if (adminDataReady && authRights !== "checking") {
        setAdminDataReady(false);
        contactsRef.current = { status: "none", data: null };
        setRegistry((r) => (registrySplitRef.current ? stripPrivate(r) : r));
      }
      return;
    }
    if (!registryLoaded || adminDataReady) return;
    let cancelled = false;
    (async () => {
      let contacts = null;
      try {
        contacts = await loadContactsStrict();
      } catch {
        if (cancelled) return;
        contactsRef.current = { status: "failed", data: null };
        writesBlockedRef.current = true;
        setStartupReadFailed(true);
        reportSaveFailure("Στοιχεία επικοινωνίας — δεν διαβάστηκαν· όλες οι αποθηκεύσεις μπλοκαρίστηκαν. Ανανέωσε τη σελίδα.");
        setRegistry((r) => mergeContacts(r, null));
        setAdminDataReady(true);
        return;
      }
      if (cancelled) return;
      contactsRef.current = { status: "loaded", data: contacts };
      setRegistry((r) => mergeContacts(r, registrySplitRef.current ? contacts : null));
      setAdminDataReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [authRights, registryLoaded, adminDataReady]);

  useEffect(() => {
    async function init() {
      // Every start-up read is STRICT: a read that fails (offline, timeout)
      // throws instead of looking like "nothing stored yet". Without this, a
      // single failed read would make the app re-seed the registry, rebuild
      // the ELO from the 11 historical days, or rewrite the catalogue with
      // only those days — overwriting real data. On failure nothing is
      // written and every later registry/ELO/catalogue save is refused.
      let index, trashList, sys, registryData, season2026, eloStart;
      try {
        index = await loadIndexStrict();
        const trashDoc = await fetchTournamentDataStrict(SYS_TRASH_ID);
        trashList = trashDoc && Array.isArray(trashDoc.list) ? trashDoc.list : [];
        const sysDoc = await fetchTournamentDataStrict(SYS_STATE_ID);
        sys = sysDoc && typeof sysDoc === "object" ? sysDoc : {};
        registryData = await loadRegistryStrict();
        registrySplitRef.current = registryData.contactsVersion === 1;
        season2026 = await loadSeasonStrict(2026);
        eloStart = await loadEloStrict();
      } catch {
        writesBlockedRef.current = true;
        setStartupReadFailed(true);
        return;
      }
      setTrash(trashList);
      setSysState(sys);
      // Days that were moved to the trash, or permanently removed on purpose,
      // must never be re-created from the built-in copy.
      const blockedIds = new Set([...trashList.map((t) => t.id), ...(sys.purgedIds || [])]);

      if (Object.keys(registryData.players || {}).length === 0) {
        const seeded = { players: {} };
        SEED_PLAYERS.forEach((p) => {
          seeded.players[normalizeName(p.name)] = {
            name: p.name, club: p.club, email: p.email, phone: p.phone, membership: [], needsInfo: false, hasDiscount: false, discountAmount: 32,
          };
        });
        setRegistry(seeded);
        await saveRegistryChecked(seeded);
      } else {
        setRegistry(registryData);
      }
      setRegistryLoaded(true);

      const alreadyImported = Object.values(season2026.players || {}).some((p) =>
        Object.keys(p.entries || {}).some((id) => id.startsWith("hist-day"))
      );
      if (!alreadyImported) {
        await importHistoricalSeason2026(season2026);
      }

      const elo = eloStart;
      if (!elo.initialized) {
        HISTORICAL_ELO_ROUNDS_2026.forEach((roundMatches) => {
          applyEloRoundBatch(elo, roundMatches, 7); // all 11 historical days used 7-point matches
        });
        elo.initialized = true;
        await saveEloChecked(elo);
      }

      const days = Object.values(HISTORICAL_TOURNAMENTS_2026);
      // Only (re)save days that are actually missing from the index — not
      // all 11, every single time the app loads. A day already present is
      // trusted as saved; this keeps the original per-day safety (no single
      // boolean flag deciding for all 11) without the cost of rewriting
      // static, unchanging data on every load.
      const missingDays = days.filter((t) => !index.some((idx) => idx.id === t.tournamentId) && !blockedIds.has(t.tournamentId));
      if (missingDays.length > 0) {
        let allOk = true;
        const newIndexEntries = [];
        for (const t of missingDays) {
          // If the document already exists in the database (e.g. only the
          // catalogue entry was lost), keep it — it may hold corrections made
          // in the app — and just restore its catalogue entry below. The read
          // is strict: a failed read must not be taken as "missing".
          let existing;
          try {
            existing = await fetchTournamentDataStrict(t.tournamentId);
          } catch {
            allOk = false;
            continue;
          }
          if (!(existing && existing.players)) {
            const result = await saveTournamentData(t.tournamentId, {
              tournamentName: t.tournamentName,
              totalRounds: t.totalRounds,
              matchLength: t.matchLength,
              seasonYear: t.seasonYear,
              competitionId: DEFAULT_COMPETITION_ID,
              liveStandingsEnabled: t.liveStandingsEnabled,
              isOfficial: true,
              phase: t.phase,
              players: t.players,
              round: t.round,
              currentPairings: t.currentPairings,
              history: t.history,
              createdAt: t.createdAt,
            });
            if (!result) {
              allOk = false;
              continue;
            }
          }
          newIndexEntries.push({
            id: t.tournamentId,
            name: existing?.tournamentName || t.tournamentName,
            date: existing?.createdAt || t.createdAt,
            status: "Completed",
            totalRounds: existing?.totalRounds || t.totalRounds,
            isOfficial: existing ? existing.isOfficial !== false : true,
            seasonYear: existing?.seasonYear || t.seasonYear,
            competitionId: existing?.competitionId || DEFAULT_COMPETITION_ID,
          });
        }
        if (newIndexEntries.length > 0) {
          index = [...index, ...newIndexEntries];
          await saveIndexChecked(index);
        }
        if (!allOk) {
          setNotice("Some historical tournaments failed to save — try reloading the app.");
        }
      }

      setArchive(index);
    }
    init();
  }, []);

  useEffect(() => {
    if (!["tournament", "finished", "setup"].includes(phase)) setTournamentReturnPlayer(null);
  }, [phase]);

  // Build 2: the Season and Season-statistics pages open on the current
  // season — or, while it has no results yet (e.g. 1 January, before the
  // first tournament of the year), on the most recent season that has.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const current = currentSeasonId(sysState, DEFAULT_COMPETITION_ID);
      const years = (await listSeasonYears()).filter((y) => y <= current).sort((a, b) => b - a);
      let pick = current;
      for (const y of years) {
        const sz = await loadSeason(y);
        if (Object.values(sz.players || {}).some((p) => Object.keys(p.entries || {}).length > 0)) {
          pick = y;
          break;
        }
      }
      if (cancelled) return;
      setSeasonBrowseYear(pick);
      setSeasonStatsYear(pick);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase === "tournament") setSelectedRound(round);
    if (phase === "finished") setSelectedRound(totalRounds);
  }, [phase, round, totalRounds]);

  useEffect(() => {
    loadElo().then(setEloData);
  }, []);

  // The ELO page always shows what is in the database now (e.g. after
  // another device closed a tournament). A failed read keeps what is shown.
  useEffect(() => {
    if (phase !== "elo") return;
    loadEloStrict().then(setEloData).catch(() => {});
  }, [phase]);

  useEffect(() => {
    if (!expandedRegistryPlayer || !registry.players[expandedRegistryPlayer]) {
      setContactDraft(null);
      return;
    }
    const p = registry.players[expandedRegistryPlayer];
    setContactDraft({ name: p.name, club: p.club, clubId: p.clubId || null, guest: !!p.guest, email: p.email, phone: p.phone, hasDiscount: !!p.hasDiscount, discountAmount: p.discountAmount ?? 32 });
  }, [expandedRegistryPlayer]);

  useEffect(() => {
    if (phase !== "season") return;
    listSeasonYears().then((years) => {
      const opened = Object.keys(sysState.seasonCalendars || {}).map(Number).filter((y) => !isNaN(y));
      const all = [...new Set([seasonBrowseYear, ...years, ...opened])].sort((a, b) => b - a);
      setSeasonYearsAvailable(all);
    });
    loadSeason(seasonBrowseYear).then(setSeasonData);
  }, [phase, seasonBrowseYear]);

  // Imported tournaments are public (read-only): load them once for everyone.
  useEffect(() => {
    refreshImports();
  }, []);

  // A new set of imported tournaments changes every player's history.
  useEffect(() => {
    setPlayerHistoryCache({});
  }, [importDocs]);

  // A calendar link that no longer fits the chosen season is dropped.
  useEffect(() => {
    if (phase !== "setup" || !calendarEntryId) return;
    if (!buildCalendarView(sysState, seasonYear, archive).some((e) => e.id === calendarEntryId)) setCalendarEntryId(null);
  }, [phase, seasonYear]);

  useEffect(() => {
    if (phase !== "control") return;
    const current = currentSeasonId(sysState, DEFAULT_COMPETITION_ID);
    const opened = [...Object.keys(sysState.seasonCalendars || {}), ...Object.keys(sysState.seasonRules || {})].map(Number).filter((y) => !isNaN(y));
    listSeasonYears().then((years) => setControlSeasons([...new Set([current, ...years, ...opened])].sort((x, y) => y - x)));
  }, [phase, sysState.seasonCalendars, sysState.seasonRules]);

  // The Statistics period selector needs the list of seasons.
  useEffect(() => {
    if (phase !== "h2h") return;
    listSeasonYears().then((years) => setSeasonYearsAvailable([...years].sort((a, b) => b - a)));
  }, [phase]);
  // #endregion Φόρτωση & εκκίνηση

  /* ---- archive persistence ---- */

  // #region Τουρνουά & γύροι
  function currentSnapshot() {
    return { tournamentName, totalRounds, matchLength, seasonYear, competitionId, organisation, organisationClubId, calendarEntryId, liveStandingsEnabled, isOfficial, sideBets, calcuttaEntries, phase, players, round, currentPairings, history, createdAt };
  }

  async function persistCurrent(nextPhase, nextRound, nextPlayers, nextPairings, nextHistory, nextSideBets = sideBets, nextCalcuttaEntries = calcuttaEntries) {
    if (!tournamentId) return;
    const snapshot = {
      tournamentName,
      totalRounds,
      matchLength,
      seasonYear,
      competitionId,
      organisation,
      organisationClubId,
      calendarEntryId,
      liveStandingsEnabled,
      isOfficial,
      sideBets: nextSideBets,
      calcuttaEntries: nextCalcuttaEntries,
      phase: nextPhase,
      players: nextPlayers,
      round: nextRound,
      currentPairings: nextPairings,
      history: nextHistory,
      createdAt,
    };
    if (!(await saveTournamentData(tournamentId, snapshot))) reportSaveFailure(`Τουρνουά «${tournamentName || tournamentId}»`);
    setArchive((prev) => {
      const next = prev.filter((t) => t.id !== tournamentId);
      next.push({
        id: tournamentId,
        name: tournamentName || "Untitled",
        date: createdAt,
        status: nextPhase === "finished" ? "Completed" : "In progress",
        totalRounds,
        isOfficial,
        seasonYear,
        competitionId,
        calendarEntryId: calendarEntryId || null,
      });
      saveIndexChecked(next);
      return next;
    });
  }

  /* ---- setup phase ---- */

  function goToNewTournament() {
    setTournamentId(`t${Date.now()}`);
    setCreatedAt(new Date().toISOString());
    setTournamentName("");
    setTotalRounds(5);
    setMatchLength(7);
    setSideBets([]);
    setCalcuttaEntries([]);
    setSeasonYear(currentSeasonId(sysState, DEFAULT_COMPETITION_ID));
    setCompetitionId(DEFAULT_COMPETITION_ID);
    setOrganisation(clubsActive(sysState) ? clubDisplay(sysState, sysState.homeClubId, sysState.homeClub) : sysState.homeClub || "");
    setOrganisationClubId(clubsActive(sysState) ? sysState.homeClubId || null : null);
    setCalendarEntryId(null);
    setLiveStandingsEnabled(false);
    setIsOfficial(true);
    setPlayers([]);
    // Prefill from the next open calendar day (current season, then next).
    const cur = currentSeasonId(sysState, DEFAULT_COMPETITION_ID);
    const later = seasonsOfCompetition(sysState, DEFAULT_COMPETITION_ID).map((s) => s.id).filter((id) => id > cur);
    for (const y of [cur, ...later]) {
      const view = buildCalendarView(sysState, y, archive);
      const open = view.find((e) => !e.tournament && e.status === "scheduled");
      if (open) {
        applyCalendarEntry(open, y);
        break;
      }
    }
    setRound(1);
    setCurrentPairings(null);
    setHistory([]);
    setNotice("");
    setPhase("setup");
    setConfirmingDelete(false);
  }

  /** Matches a typed name to an existing registry player — but only when
   * unambiguous. A shared first name (very common in Greek) must never be
   * enough on its own; this requires every token of the shorter name to
   * appear in the other, and only returns a match if exactly one registry
   * player qualifies. Anything less certain is treated as a new player,
   * never a guess — mixing up two different people is far worse than an
   * occasional duplicate registry entry. */
  function findRegistryMatch(typedName) {
    // 1) the exact spelling, or any spelling this person ever had
    const key = normalizeName(typedName);
    if (registry.players[key]) return registry.players[key];
    // 2) the same words, ignoring accents and capitals
    const typed = stripAccents(baseName(typedName));
    for (const p of Object.values(registry.players)) {
      if (personSpellings(p).some((s) => stripAccents(s) === typed)) return p;
    }
    // 3) every typed word belongs to exactly one person (e.g. just a surname)
    const tokens = typed.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;
    // After the migration only a PART of a name (e.g. a surname) matches on its
    // own; the same words in another order are left to the "same player?" question.
    const allowReorder = registry.identityVersion !== 2;
    const candidates = Object.values(registry.players).filter((p) => {
      const pTokens = wordsOf(p.name);
      return tokens.every((t) => pTokens.includes(t)) && (allowReorder || tokens.length < pTokens.length);
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  function addPlayer() {
    addPlayerCore(undefined);
  }

  /** forced: undefined (normal), { linkKey } (the admin said "yes, same
   * player") or { createNew: true } (the admin said "no, a new person"). */
  function addPlayerCore(forced) {
    const typed = newPlayerName.trim();
    if (!typed) return;
    let match = forced && forced.linkKey ? registry.players[forced.linkKey] : findRegistryMatch(typed);
    if (!match && !forced && registry.identityVersion === 2) {
      const look = findLookalikePersons(typed, registry.players);
      if (look.length > 0) {
        setIdentityPrompt({ typed, candidates: look });
        return;
      }
    }
    if (forced && forced.linkKey && match) {
      // remember this spelling as another way to write the same person
      const aliases = [...new Set([...personSpellings(match), baseName(typed)])];
      persistRegistry({ players: { ...registry.players, [forced.linkKey]: { ...match, aliases } } });
    }
    let canonicalName = typed;
    let isDiscounted = false;
    let discountAmt = 32;
    if (match) {
      canonicalName = match.name;
      isDiscounted = !!match.hasDiscount;
      discountAmt = match.discountAmount ?? 32;
    }
    const alreadyIn = players.some((p) => p.name.toLowerCase() === canonicalName.toLowerCase());
    if (alreadyIn) {
      setNotice(`${canonicalName} is already in this tournament.`);
      return;
    }
    if (!match) {
      const { key, entry } = registryWithNewPerson(typed);
      persistRegistry({ players: { ...registry.players, [key]: entry } });
    }
    const newId = makeId();
    const updatedPlayers = [
      ...players,
      { id: newId, name: canonicalName, wins: 0, opponents: [], hadBye: false, withdrawn: false, withdrawnRound: null, excludedFromTournament: false, matchLog: [], hasDiscount: isDiscounted, discountAmount: discountAmt, wantsCup: false },
    ];
    setPlayers(updatedPlayers);
    let updatedSideBets = sideBets;
    if (addToSideBet) {
      const existing = sideBets.find((b) => b.id === "default-sidebet");
      updatedSideBets = existing
        ? sideBets.map((b) => (b.id === "default-sidebet" ? { ...b, participantIds: [...b.participantIds, newId] } : b))
        : [...sideBets, { id: "default-sidebet", label: "Side bet", amountPerPlayer: defaultSideBetAmount, participantIds: [newId] }];
      setSideBets(updatedSideBets);
    }
    setNewPlayerName("");
    persistCurrent(phase, round, updatedPlayers, currentPairings, history, updatedSideBets);
  }

  function removePlayer(id) {
    const updated = players.filter((p) => p.id !== id);
    setPlayers(updated);
    persistCurrent(phase, round, updated, currentPairings, history);
  }

  function toggleDiscount(id) {
    const updated = players.map((p) => (p.id === id ? { ...p, hasDiscount: !p.hasDiscount } : p));
    setPlayers(updated);
    persistCurrent(phase, round, updated, currentPairings, history);
  }

  function updatePlayerDiscountAmount(id, amount) {
    const updated = players.map((p) => (p.id === id ? { ...p, discountAmount: amount } : p));
    setPlayers(updated);
    persistCurrent(phase, round, updated, currentPairings, history);
  }

  function toggleWantsCup(id) {
    const updated = players.map((p) => (p.id === id ? { ...p, wantsCup: !p.wantsCup } : p));
    setPlayers(updated);
    persistCurrent(phase, round, updated, currentPairings, history);
  }

  // Explicit, admin-driven exclusion from future pairings — deliberately
  // separate from "retired in a match" (withdrawn/withdrawnRound), which is
  // set automatically and is purely informational. A player who retires in
  // one round is NOT auto-excluded from the next; the admin decides here.
  function toggleExclusion(id) {
    const updated = players.map((p) => (p.id === id ? { ...p, excludedFromTournament: !p.excludedFromTournament } : p));
    setPlayers(updated);
    persistCurrent(phase, round, updated, currentPairings, history);
  }

  function toggleIsOfficial() {
    const next = !isOfficial;
    setIsOfficial(next);
    if (!tournamentId) return;
    saveTournamentData(tournamentId, { ...currentSnapshot(), isOfficial: next });
    setArchive((prev) => {
      const updated = prev.map((t) => (t.id === tournamentId ? { ...t, isOfficial: next } : t));
      saveIndexChecked(updated);
      return updated;
    });
  }

  /* ---- side bets ---- */

  function addSideBet(label, amountPerPlayer) {
    const bet = { id: `sb${Date.now()}`, label: label || "Side bet", amountPerPlayer, participantIds: [] };
    const updated = [...sideBets, bet];
    setSideBets(updated);
    persistCurrent(phase, round, players, currentPairings, history, updated);
  }

  function removeSideBet(betId) {
    const updated = sideBets.filter((b) => b.id !== betId);
    setSideBets(updated);
    persistCurrent(phase, round, players, currentPairings, history, updated);
  }

  function toggleSideBetParticipant(betId, playerId) {
    const updated = sideBets.map((b) => {
      if (b.id !== betId) return b;
      const inBet = b.participantIds.includes(playerId);
      return { ...b, participantIds: inBet ? b.participantIds.filter((id) => id !== playerId) : [...b.participantIds, playerId] };
    });
    setSideBets(updated);
    persistCurrent(phase, round, players, currentPairings, history, updated);
  }

  function updateSideBetAmount(betId, amount) {
    const updated = sideBets.map((b) => (b.id === betId ? { ...b, amountPerPlayer: amount } : b));
    setSideBets(updated);
    persistCurrent(phase, round, players, currentPairings, history, updated);
  }

  /* ---- calcutta ---- */

  function addCalcuttaEntry(playerId, buyer, amount) {
    if (!playerId || !buyer.trim()) return;
    if (calcuttaEntries.some((e) => e.playerId === playerId)) return; // one buyer per player
    const updated = [...calcuttaEntries, { id: `cc${Date.now()}`, playerId, buyer: buyer.trim(), amount }];
    setCalcuttaEntries(updated);
    persistCurrent(phase, round, players, currentPairings, history, sideBets, updated);
  }

  function removeCalcuttaEntry(entryId) {
    const updated = calcuttaEntries.filter((e) => e.id !== entryId);
    setCalcuttaEntries(updated);
    persistCurrent(phase, round, players, currentPairings, history, sideBets, updated);
  }

  function addPlayersBulk() {
    const tokens = bulkText
      .split(/[\n,\t]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => !/^\d+$/.test(t));
    if (tokens.length === 0) return;

    const registryAdditions = {};
    const batchByName = {};
    const resolvedPlayers = [];
    const skippedLookalikes = [];
    tokens.forEach((typed) => {
      const match = findRegistryMatch(typed) || registryAdditions[batchByName[baseName(typed)]];
      if (match) {
        resolvedPlayers.push({ name: match.name, hasDiscount: !!match.hasDiscount, discountAmount: match.discountAmount ?? 32 });
      } else if (registry.identityVersion === 2 && findLookalikePersons(typed, registry.players).length > 0) {
        // Never create a possible duplicate person silently — ask when adding one by one.
        const first = findLookalikePersons(typed, registry.players)[0];
        skippedLookalikes.push(`${typed} ≈ ${first.person.name}`);
      } else {
        const { key, entry } = registryWithNewPerson(typed);
        registryAdditions[key] = entry;
        batchByName[baseName(typed)] = key;
        resolvedPlayers.push({ name: typed, hasDiscount: false, discountAmount: 32 });
      }
    });
    if (skippedLookalikes.length > 0) {
      setNotice(`Δεν προστέθηκαν (μοιάζουν με υπάρχοντα πρόσωπα): ${skippedLookalikes.join(" · ")}. Πρόσθεσέ τους έναν-έναν, για να επιβεβαιώσεις αν είναι ο ίδιος παίκτης.`);
    }

    if (Object.keys(registryAdditions).length > 0) {
      persistRegistry({ players: { ...registry.players, ...registryAdditions } });
    }

    setPlayers((prev) => {
      const existingNames = new Set(prev.map((p) => p.name.toLowerCase()));
      const additions = [];
      resolvedPlayers.forEach(({ name, hasDiscount, discountAmount }) => {
        const key = name.toLowerCase();
        if (existingNames.has(key)) return;
        existingNames.add(key);
        additions.push({
          id: makeId(), name, wins: 0, opponents: [], hadBye: false, withdrawn: false, withdrawnRound: null, excludedFromTournament: false, matchLog: [], hasDiscount, discountAmount: discountAmount ?? 32, wantsCup: false,
        });
      });
      return [...prev, ...additions];
    });
    setBulkText("");
  }

  function toggleDefaultSideBetForPlayer(playerId) {
    setSideBets((prev) => {
      const existing = prev.find((b) => b.id === "default-sidebet");
      if (!existing) {
        return [...prev, { id: "default-sidebet", label: "Side bet", amountPerPlayer: defaultSideBetAmount, participantIds: [playerId] }];
      }
      const inBet = existing.participantIds.includes(playerId);
      return prev.map((b) =>
        b.id === "default-sidebet"
          ? { ...b, participantIds: inBet ? b.participantIds.filter((id) => id !== playerId) : [...b.participantIds, playerId] }
          : b
      );
    });
  }

  function startTournament() {
    if (seasonLocked(sysState, seasonYear)) {
      showToast(`Η σεζόν ${sn(seasonYear)} είναι κλειδωμένη — διάλεξε άλλη σεζόν ή ημερομηνία.`);
      return;
    }
    if (players.length < 3) return;
    const pairing = generatePairings(players, 1);
    setCurrentPairings(pairing);
    setRound(1);
    setPhase("tournament");
    setView("pairings");
    persistCurrent("tournament", 1, players, pairing, []);
  }

  /* ---- tournament phase ---- */

  function setResult(pairIndex, winnerId, loserId, method) {
    const updatedPairing = {
      ...currentPairings,
      pairs: currentPairings.pairs.map((pr, i) => (i === pairIndex ? { ...pr, result: { winnerId, loserId, method } } : pr)),
    };
    setCurrentPairings(updatedPairing);
    persistCurrent(phase, round, players, updatedPairing, history);
  }

  function clearResult(pairIndex) {
    const updatedPairing = {
      ...currentPairings,
      pairs: currentPairings.pairs.map((pr, i) => (i === pairIndex ? { ...pr, result: null } : pr)),
    };
    setCurrentPairings(updatedPairing);
    persistCurrent(phase, round, players, updatedPairing, history);
  }

  function setHistoricalResult(roundNumber, pairIndex, winnerId, loserId, method) {
    if (!tournamentEditable()) return;
    const updatedHistory = history.map((entry) =>
      entry.round !== roundNumber
        ? entry
        : { ...entry, pairs: entry.pairs.map((pr, i) => (i === pairIndex ? { ...pr, result: { winnerId, loserId, method } } : pr)) }
    );
    const recomputed = replayPlayersFromHistory(players, updatedHistory);
    setHistory(updatedHistory);
    setPlayers(recomputed);
    persistCurrent(phase, round, recomputed, currentPairings, updatedHistory);
    setNotice("Η διόρθωση αποθηκεύτηκε στη βαθμολογία του τουρνουά — αλλά το ELO ΔΕΝ ενημερώθηκε αυτόματα. Πάτα \"Recompute ELO & Season Standings\" (Διαχείριση → Δεδομένα) για να συγχρονιστεί.");
  }

  function clearHistoricalResult(roundNumber, pairIndex) {
    if (!tournamentEditable()) return;
    const updatedHistory = history.map((entry) =>
      entry.round !== roundNumber
        ? entry
        : { ...entry, pairs: entry.pairs.map((pr, i) => (i === pairIndex ? { ...pr, result: null } : pr)) }
    );
    const recomputed = replayPlayersFromHistory(players, updatedHistory);
    setHistory(updatedHistory);
    setPlayers(recomputed);
    persistCurrent(phase, round, recomputed, currentPairings, updatedHistory);
    setNotice("Η διόρθωση αποθηκεύτηκε στη βαθμολογία του τουρνουά — αλλά το ELO ΔΕΝ ενημερώθηκε αυτόματα. Πάτα \"Recompute ELO & Season Standings\" (Διαχείριση → Δεδομένα) για να συγχρονιστεί.");
  }

  /** Redraws the live round. For round 1, that means deleting the round
   * entirely and dropping back to Setup so the roster can be adjusted
   * (add/remove players) before pressing "Start Tournament" again. For any
   * later round, it reverts one step: pops the last finalized round back off
   * history, restores it (with whatever results it already had) as the live,
   * editable round, and discards the current round's pairing — so a mistake
   * spotted in that prior round can be fixed and the next round re-drawn clean. */
  function redrawCurrentRound() {
    if (round === 1) {
      setCurrentPairings(null);
      setPhase("setup");
      persistCurrent("setup", 1, players, null, []);
      return;
    }
    const lastEntry = history[history.length - 1];
    if (!lastEntry) return;
    const remainingHistory = history.slice(0, -1);
    const recomputed = replayPlayersFromHistory(players, remainingHistory);
    const restoredPairing = { pairs: lastEntry.pairs, bye: lastEntry.bye, rematchCount: 0 };
    setHistory(remainingHistory);
    setPlayers(recomputed);
    setRound(lastEntry.round);
    setCurrentPairings(restoredPairing);
    persistCurrent(phase, lastEntry.round, recomputed, restoredPairing, remainingHistory);
    setNotice("Ο γύρος αναιρέθηκε — αλλά το ELO ΔΕΝ αναιρέθηκε αυτόματα μαζί του. Πάτα \"Recompute ELO & Season Standings\" (Διαχείριση → Δεδομένα) για να συγχρονιστεί, μόλις τελειώσεις τις διορθώσεις.");
  }

  const roundComplete = currentPairings && currentPairings.pairs.every((pr) => pr.result !== null);

  async function finalizeRoundAndAdvance(updateSeasonRequested) {
    if (!roundComplete) return;
    // Until Build 3's separate ELO pools, only Premier League tournaments
    // feed the (club) ELO and the season standings.
    const ratingsCount = competitionId === DEFAULT_COMPETITION_ID;
    const updateSeason = updateSeasonRequested && ratingsCount;
    const byId = {};
    players.forEach((p) => (byId[p.id] = { ...p, opponents: [...p.opponents], matchLog: [...p.matchLog] }));

    currentPairings.pairs.forEach((pr) => {
      const { winnerId, loserId, method } = pr.result;
      if (method === "double_retirement") {
        const a = byId[pr.p1];
        const b = byId[pr.p2];
        a.opponents.push(pr.p2);
        b.opponents.push(pr.p1);
        a.matchLog.push({ round, opponentId: pr.p2, method: "double_retirement", result: "loss" });
        b.matchLog.push({ round, opponentId: pr.p1, method: "double_retirement", result: "loss" });
        a.withdrawn = true; a.withdrawnRound = round;
        b.withdrawn = true; b.withdrawnRound = round;
        return;
      }
      const w = byId[winnerId];
      const l = byId[loserId];
      w.wins += 1;
      w.opponents.push(loserId);
      l.opponents.push(winnerId);
      const winMethod = method === "retirement" ? "retirement_win" : "normal";
      const loseMethod = method === "retirement" ? "retirement_loss" : "normal";
      w.matchLog.push({ round, opponentId: loserId, method: winMethod, result: "win" });
      l.matchLog.push({ round, opponentId: winnerId, method: loseMethod, result: "loss" });
      if (method === "retirement") {
        l.withdrawn = true;
        l.withdrawnRound = round;
      }
    });

    if (currentPairings.bye) {
      const b = byId[currentPairings.bye];
      b.wins += 1;
      b.hadBye = true;
      b.matchLog.push({ round, opponentId: null, method: "bye", result: "win" });
    }

    const updatedPlayers = players.map((p) => byId[p.id]);
    const newHistory = [...history, { round, pairs: currentPairings.pairs, bye: currentPairings.bye }];

    setPlayers(updatedPlayers);
    setHistory(newHistory);

    const eloRoundMatches = buildEloRoundMatches(currentPairings.pairs, byId);
    if (liveStandingsEnabled && ratingsCount) {
      // Strict read: on a failed read nothing is written (writing onto an
      // empty stand-in would replace the whole ELO with this one round).
      loadEloStrict()
        .then((elo) => {
          applyEloRoundBatch(elo, eloRoundMatches, matchLength);
          markEloApplied(elo, tournamentId, tournamentName, "live");
          return saveEloChecked(elo).then((ok) => {
            if (ok) showFreshElo(elo);
            return ok;
          });
        })
        .catch(() => reportSaveFailure(`Κατάταξη ELO (γύρος ${round}) — η ELO δεν διαβάστηκε, δεν γράφτηκε τίποτα· τρέξε Recompute`));
    }

    // Retries once on failure — saveSeason now honestly reports success/failure
    // instead of silently swallowing a storage hiccup, so we can tell the
    // person plainly if the season really didn't update.
    async function pushSeasonUpdateWithRetry() {
      let ok = await pushSeasonUpdate(seasonYear, tournamentId, tournamentName || "Untitled", createdAt, updatedPlayers);
      if (!ok) {
        await new Promise((r) => setTimeout(r, 800));
        ok = await pushSeasonUpdate(seasonYear, tournamentId, tournamentName || "Untitled", createdAt, updatedPlayers);
      }
      return ok;
    }

    let noticeMsg =
      currentPairings.rematchCount > 0
        ? `Note: ${currentPairings.rematchCount} forced rematch due to limited pairing options.`
        : "";

    if (round >= totalRounds) {
      setPhase("finished");
      setCurrentPairings(null);
      await persistCurrent("finished", round, updatedPlayers, null, newHistory);
      if (!liveStandingsEnabled && ratingsCount && updateSeasonRequested) {
        let elo = null;
        try {
          elo = await loadEloStrict();
        } catch {
          reportSaveFailure("Κατάταξη ELO (τέλος τουρνουά) — η ELO δεν διαβάστηκε, δεν γράφτηκε τίποτα· τρέξε Recompute");
        }
        if (elo) {
          newHistory.forEach((entry) => {
            applyEloRoundBatch(elo, buildEloRoundMatches(entry.pairs, byId), matchLength);
          });
          markEloApplied(elo, tournamentId, tournamentName, "end");
          if (await saveEloChecked(elo)) showFreshElo(elo);
        }
      }
      if (updateSeason) {
        const seasonOk = await pushSeasonUpdateWithRetry();
        if (seasonOk) {
          showToast("ELO και Βαθμολογία ενημερώθηκαν.");
        } else {
          noticeMsg = [
            noticeMsg,
            "Warning: couldn't save to Season Standings after two tries. Mark this tournament \"Official League day\" (if it should count) and use \"Recompute ELO & Season Standings from scratch\" on the ELO page to pick it up.",
          ].filter(Boolean).join(" ");
        }
      } else if (!ratingsCount) {
        noticeMsg = [noticeMsg, `Το τουρνουά τελείωσε. Ως «${competitionName(competitionsFrom(sysState), competitionId)}» δεν μετράει σε ELO και Βαθμολογία.`].filter(Boolean).join(" ");
      } else {
        noticeMsg = [
          noticeMsg,
          liveStandingsEnabled
            ? "Το τουρνουά τελείωσε. Η τελική Βαθμολογία δεν ενημερώθηκε, όπως ζήτησες (η ELO είχε ήδη ενημερωθεί σε κάθε γύρο, λόγω live ενημέρωσης)."
            : "Το τουρνουά τελείωσε. ELO και Βαθμολογία δεν ενημερώθηκαν, όπως ζήτησες· αν το τουρνουά είναι επίσημο, θα μετρήσει στο επόμενο Recompute.",
        ].filter(Boolean).join(" ");
      }
    } else {
      const nextRound = round + 1;
      const nextPairing = generatePairings(updatedPlayers, nextRound);
      setRound(nextRound);
      setCurrentPairings(nextPairing);
      await persistCurrent("tournament", nextRound, updatedPlayers, nextPairing, newHistory);
      if (liveStandingsEnabled && ratingsCount) {
        const seasonOk = await pushSeasonUpdateWithRetry();
        noticeMsg = [
          noticeMsg,
          seasonOk
            ? "Live season standings updated."
            : "Warning: couldn't save live Season Standings after two tries.",
        ].filter(Boolean).join(" ");
      }
    }
    setNotice(noticeMsg);
  }
  // #endregion Τουρνουά & γύροι

  /* ---- file persistence (local download / upload) ---- */

  // #region Export / Import / Excel
  async function exportAllData() {
    // Every read is strict: a backup with a silently missing part is worse
    // than no backup, because it would also reset the "last export" clock
    // that the migrations rely on.
    let registryData, privateContacts, eloData2, index, seasons, tournaments, trashList, trashedTournaments, sysNow, importsBackup;
    try {
      registryData = await loadRegistryStrict();
      // Players' private details (5A): null before the move.
      privateContacts = await loadContactsStrict();
      eloData2 = await loadEloStrict();
      index = await loadIndexStrict();
      const years = await listSeasonYearsStrict();
      seasons = {};
      for (const y of years) {
        seasons[y] = await loadSeasonStrict(y);
      }
      tournaments = {};
      for (const t of index) {
        tournaments[t.id] = await fetchTournamentDataStrict(t.id);
      }
      const trashDoc = await fetchTournamentDataStrict(SYS_TRASH_ID);
      trashList = trashDoc && Array.isArray(trashDoc.list) ? trashDoc.list : [];
      trashedTournaments = {};
      for (const t of trashList) {
        trashedTournaments[t.id] = await fetchTournamentDataStrict(t.id);
      }
      const sysDoc = await fetchTournamentDataStrict(SYS_STATE_ID);
      sysNow = sysDoc && typeof sysDoc === "object" ? sysDoc : {};
      const impDoc = await fetchTournamentDataStrict(SYS_IMPORTS_ID);
      importsBackup = { list: impDoc && Array.isArray(impDoc.list) ? impDoc.list : [], docs: {} };
      for (const t of importsBackup.list) importsBackup.docs[t.id] = await fetchTournamentDataStrict(t.id);
    } catch {
      reportSaveFailure("Export All Data — η βάση δεν διαβάστηκε πλήρως, ΔΕΝ κατέβηκε αρχείο. Δοκίμασε ξανά.");
      return;
    }
    const exportedAtIso = new Date().toISOString();
    const fullBackup = {
      exportedAt: exportedAtIso,
      registry: registryData,
      privateContacts,
      elo: eloData2,
      archiveIndex: index,
      seasons,
      tournaments,
      trash: trashList,
      trashedTournaments,
      imports: importsBackup,
      // Every application setting (clubs, competitions, season rules,
      // calendars, season locks, …) — all of the system document except the
      // time of the last export itself.
      sysState: (() => {
        const { lastExportAt: _ignored, ...settings } = sysNow;
        return { ...settings, purgedIds: sysNow.purgedIds || [], competitions: competitionsFrom(sysNow) };
      })(),
    };
    const blob = new Blob([JSON.stringify(fullBackup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `bgfed_full_backup_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Full backup downloaded.");
    if (await saveSysState({ lastExportAt: exportedAtIso })) {
      setSysState((s) => ({ ...s, lastExportAt: exportedAtIso }));
    } else {
      reportSaveFailure("Ημερομηνία τελευταίου export — το αρχείο κατέβηκε, αλλά η εφαρμογή δεν κατέγραψε την ώρα του");
    }
  }

  /** Restores every store (registry, ELO, archive index, all seasons, all
   * tournaments) from a file produced by "Export All Data". Overwrites
   * whatever is currently in storage — use right after Unpublish+Publish
   * (which starts from empty storage) to bring real data back. */
  /** Exports the current ELO table and the Season Standings (every season
   * year found in the database) to one Excel workbook — the same numbers the
   * screens show, plus a per-tournament breakdown — so two states of the app
   * can be compared side by side, e.g. before and after a data migration. */
  async function exportBaselineExcel() {
    try {
      const elo = await loadEloStrict();
      const index = await loadIndexStrict();
      const years = [...(await listSeasonYearsStrict())].sort();

      const eloRows = [["Rank", "Παίκτης", "Rating", "Rating (ακριβές)", "Matches", "Νίκες (κανονικές)", "Win % (all-time)", "Games", "Experience"]];
      Object.values(elo.players || {})
        .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name, "en"))
        .forEach((p, i) => {
          const matches = p.matches ?? p.games ?? 0;
          eloRows.push([
            i + 1, p.name, Math.round(p.rating), Math.round(p.rating * 100) / 100, matches, p.wins ?? 0,
            matches > 0 ? Math.round(((p.wins ?? 0) / matches) * 1000) / 10 : null,
            p.games ?? 0, p.experience ?? (p.games ?? 0) * 7,
          ]);
        });
      const sheets = [{ name: "ELO", rows: eloRows }];

      let seasonPlayerCounts = [];
      const seasonBestOf = [];
      for (const y of years) {
        const season = await loadSeasonStrict(y);
        const bestOfY = rulesForSeason(sysState, y).bestOf;
        seasonBestOf.push(`${y}: ${bestOfY}`);
        const standings = computeSeasonStandings(season, bestOfY);
        seasonPlayerCounts.push(`${y}: ${standings.length}`);
        const rows = [["Rank", "Παίκτης", "Events", `Points (best ${bestOfY})`, "Total (all events)", "Wins (regular)", "Matches", "%"]];
        standings.forEach((p, i) => rows.push([i + 1, p.name, p.eventsPlayed, p.total, p.sumAll, p.totalWins, p.totalMatches, p.pct]));
        sheets.push({ name: `Βαθμολογία ${y}`, rows });

        const detail = [["Παίκτης", "Τουρνουά", "Ημερομηνία", "Points", "Wins", "Α.Α.", "Bye", "Matches", "Μετράει στο best-of"]];
        standings.forEach((p) => {
          [...p.entries]
            .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
            .forEach((e) =>
              detail.push([
                p.name, e.tournamentName, String(e.date || "").slice(0, 10),
                e.points ?? 0, e.wins ?? null, e.aa ?? null, e.bye ?? null, e.matches ?? null,
                p.countedIds.has(e.tournamentId) ? "ναι" : "όχι",
              ])
            );
        });
        sheets.push({ name: `Αναλυτικά ${y}`, rows: detail });
      }

      const uniqueTournaments = new Set(index.map((t) => t.id));
      const officialTournaments = new Set(index.filter((t) => t.isOfficial).map((t) => t.id));
      sheets.push({
        name: "Πληροφορίες",
        rows: [
          ["Στοιχείο", "Τιμή"],
          ["Build εφαρμογής", APP_BUILD_VERSION],
          ["Ώρα εξαγωγής", new Date().toISOString()],
          ["Παίκτες στο ELO", Object.keys(elo.players || {}).length],
          ["Παίκτες ανά σεζόν", seasonPlayerCounts.join(" · ") || "—"],
          ["Τουρνουά στον κατάλογο (μοναδικά)", uniqueTournaments.size],
          ["Από αυτά, επίσημα (Official League)", officialTournaments.size],
          ["Best-of που εφαρμόστηκε", seasonBestOf.join(" · ") || "—"],
          ["Τελευταίο Recompute", elo.builtFrom ? elo.builtFrom.at : "—"],
          ["Recompute: τουρνουά / αγώνες", elo.builtFrom ? `${elo.builtFrom.tournaments} / ${elo.builtFrom.matches}` : "—"],
          ["Τουρνουά που έχουν επηρεάσει το ELO", elo.appliedTournaments ? Object.keys(elo.appliedTournaments).length : "—"],
        ],
      });

      const bytes = buildXlsx(sheets);
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bgfed_elo_vathmologia_${APP_BUILD_VERSION}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("Το αρχείο Excel κατέβηκε.");
      setExcelDoneAt(new Date().toISOString());
    } catch (err) {
      showToast("Η εξαγωγή σε Excel απέτυχε — δοκίμασε ξανά.");
    }
  }

  function importAllData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.registry || !data.elo || !data.archiveIndex) {
          setNotice("That doesn't look like a full backup file.");
          return;
        }
        const failed = [];
        // A backup made after the move carries the private details apart
        // (privateContacts); join them back so that the save below writes
        // both parts. Older backups hold them inside the registry.
        const restoredRegistry =
          data.registry.contactsVersion === 1 && data.privateContacts && data.privateContacts.players
            ? mergeContacts(data.registry, data.privateContacts)
            : data.registry;
        if (!(await saveRegistryChecked(restoredRegistry))) failed.push("μητρώο");
        if (!(await saveEloChecked(data.elo))) failed.push("ELO");
        if (!(await saveIndexChecked(data.archiveIndex))) failed.push("κατάλογος τουρνουά");
        for (const [year, season] of Object.entries(data.seasons || {})) {
          if (!(await saveSeason(Number(year), season))) failed.push(`σεζόν ${sn(year)}`);
        }
        for (const [id, tData] of Object.entries(data.tournaments || {})) {
          if (tData && !(await saveTournamentData(id, tData))) failed.push(`τουρνουά ${id}`);
        }
        if (Array.isArray(data.trash)) {
          for (const [id, tData] of Object.entries(data.trashedTournaments || {})) {
            if (tData && !(await saveTournamentData(id, tData))) failed.push(`τουρνουά ${id}`);
          }
          if (!(await saveSysTrash(data.trash))) failed.push("κάδος");
          setTrash(data.trash);
        }
        if (failed.length > 0) {
          reportSaveFailure(`Επαναφορά backup — δεν γράφτηκαν: ${failed.join(", ")}. Ξανατρέξε την επαναφορά.`);
        }
        if (data.sysState && Array.isArray(data.sysState.purgedIds)) {
          const purgedIds = [...new Set([...(sysState.purgedIds || []), ...data.sysState.purgedIds])];
          await saveSysState({ purgedIds });
          setSysState((s) => ({ ...s, purgedIds }));
        }
        if (data.sysState && typeof data.sysState === "object") {
          // All settings from the backup (purgedIds were merged above; the
          // time of the last export stays this installation's own).
          const { purgedIds: _p, lastExportAt: _l, ...patch } = data.sysState;
          if (Object.keys(patch).length > 0) {
            if (await saveSysState(patch)) setSysState((s) => ({ ...s, ...patch }));
            else reportSaveFailure("Επαναφορά backup — δεν γράφτηκαν οι ρυθμίσεις (σύλλογοι, διοργανώσεις, κανόνες, ημερολόγια, κλειδώματα)");
          }
        }
        const restoredInMemory = mergeContacts(restoredRegistry, null);
        setPersonLookup(restoredInMemory);
        setRegistry(restoredInMemory);
        setEloData(data.elo);
        setArchive(data.archiveIndex);
        setEloTimeline(null);
        setPlayerMatchStatsCache({});
        if (data.imports && Array.isArray(data.imports.list)) {
          for (const [id, d] of Object.entries(data.imports.docs || {})) {
            if (d && !(await saveTournamentData(id, d))) failed.push(`εισαγωγή ${id}`);
          }
          if (!(await saveTournamentData(SYS_IMPORTS_ID, { list: data.imports.list }))) failed.push("λίστα εισαγωγών");
          setImportsList(null);
          if (failed.length > 0) reportSaveFailure(`Επαναφορά backup — δεν γράφτηκαν: ${failed.join(", ")}. Ξανατρέξε την επαναφορά.`);
        }
        if (failed.length === 0) showToast("Full backup restored.");
      } catch {
        setNotice("That file wasn't valid, or wasn't a full backup.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function importJSON(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        setTournamentId(`t${Date.now()}`);
        setCreatedAt(data.createdAt || new Date().toISOString());
        setTournamentName(data.tournamentName || "");
        setTotalRounds(data.totalRounds || 5);
        setMatchLength(data.matchLength || 7);
        setSideBets(data.sideBets || []);
        setCalcuttaEntries(data.calcuttaEntries || []);
        setSeasonYear(data.seasonYear || seasonForDate(data.createdAt) || new Date().getFullYear());
        setCompetitionId(data.competitionId || DEFAULT_COMPETITION_ID);
        setOrganisation(data.organisation ?? (sysState.homeClub || ""));
        setOrganisationClubId(data.organisationClubId || null);
        setCalendarEntryId(null);
        setLiveStandingsEnabled(!!data.liveStandingsEnabled);
        setIsOfficial(!!data.isOfficial);
        setPhase(data.phase || "setup");
        setPlayers(data.players || []);
        setRound(data.round || 1);
        setCurrentPairings(data.currentPairings || null);
        setHistory(data.history || []);
        setNotice("Tournament file loaded.");
      } catch {
        setNotice("That file wasn't valid.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }
  // #endregion Export / Import / Excel

  /* ---- archive navigation ---- */

  // #region Πλοήγηση: άνοιγμα τουρνουά, αρχική, αρχείο
  async function openArchived(id) {
    const data = await fetchTournamentData(id);
    if (!data) {
      setNotice("This tournament could not be loaded.");
      return;
    }
    setTournamentId(id);
    setCreatedAt(data.createdAt || null);
    setTournamentName(data.tournamentName || "");
    setTotalRounds(data.totalRounds || 5);
    setMatchLength(data.matchLength || 7);
    setSideBets(data.sideBets || []);
    setCalcuttaEntries(data.calcuttaEntries || []);
    setSeasonYear(data.seasonYear || seasonForDate(data.createdAt) || new Date().getFullYear());
    setCompetitionId(data.competitionId || DEFAULT_COMPETITION_ID);
    setOrganisation(data.organisation ?? (sysState.homeClub || ""));
    setOrganisationClubId(data.organisationClubId || null);
    setCalendarEntryId(data.calendarEntryId || null);
    setMetaEdit(null);
    setLockOverrideId(null);
    setLockAction(null);
    setLiveStandingsEnabled(!!data.liveStandingsEnabled);
    setIsOfficial(!!data.isOfficial);
    setPlayers(data.players || []);
    setRound(data.round || 1);
    setCurrentPairings(data.currentPairings || null);
    setHistory(data.history || []);
    setPhase(data.phase || "finished");
    setView("standings");
    setConfirmingDelete(false);
  }

  function goHome() {
    setPhase("dashboard");
    setNotice("");
    setConfirmingDelete(false);
  }

  function goToArchive() {
    setPhase("archive");
    setNotice("");
    setConfirmingDelete(false);
  }
  // #endregion Πλοήγηση: άνοιγμα τουρνουά, αρχική, αρχείο

  // #region Κάδος
  /** Moves the open tournament to the trash. The document itself is NOT
   * deleted — it stays in the database and can be restored. */
  async function confirmDeleteTournament(runRecompute) {
    if (!tournamentId || trashBusy) return;
    setTrashBusy(true);
    try {
      const known = archive.find((t) => t.id === tournamentId);
      const entry = {
        // keep every catalogue field (season, competition…) so a restore
        // brings the entry back exactly as it was
        ...(known || { seasonYear, competitionId }),
        id: tournamentId,
        name: known?.name || tournamentName || "Untitled",
        date: known?.date || createdAt,
        status: known?.status || (phase === "finished" ? "Completed" : "In progress"),
        totalRounds: known?.totalRounds ?? totalRounds,
        isOfficial: known ? !!known.isOfficial : !!isOfficial,
        deletedAt: new Date().toISOString(),
      };
      // Park it in the trash FIRST; only then take it out of the catalogue.
      const nextTrash = [...trash.filter((t) => t.id !== entry.id), entry];
      const trashSaved = await saveSysTrash(nextTrash);
      if (!trashSaved) {
        showToast("Δεν μπόρεσα να γράψω στον κάδο — το τουρνουά ΔΕΝ μετακινήθηκε.");
        return;
      }
      setTrash(nextTrash);
      const nextIndex = archive.filter((t) => t.id !== entry.id);
      const indexSaved = await saveIndexChecked(nextIndex);
      let check = null;
      try {
        check = indexSaved ? await loadIndexStrict() : null;
      } catch {
        check = null;
      }
      if (!check || check.some((t) => t.id === entry.id)) {
        showToast("Ο κατάλογος δεν ενημερώθηκε — δοκίμασε ξανά.");
        return;
      }
      setArchive(nextIndex);
      setConfirmingDelete(false);
      goToArchive();
      setNotice(`Το τουρνουά "${entry.name}" μετακινήθηκε στον κάδο.`);
      if (runRecompute) {
        await recomputeEloAndSeasonFromScratch(nextIndex);
        setNotice(`Το τουρνουά "${entry.name}" μετακινήθηκε στον κάδο και το ELO / η Βαθμολογία ενημερώθηκαν.`);
      }
    } finally {
      setTrashBusy(false);
    }
  }

  async function restoreFromTrash(id, runRecompute) {
    const entry = trash.find((t) => t.id === id);
    if (!entry || trashBusy) return;
    setTrashBusy(true);
    try {
      const doc = await fetchTournamentData(id);
      if (!doc) {
        showToast("Το έγγραφο του τουρνουά δεν βρέθηκε στη βάση — δεν μπορεί να γίνει επαναφορά.");
        return;
      }
      const { deletedAt, ...restored } = entry;
      const nextIndex = [...archive.filter((t) => t.id !== id), restored];
      const indexSaved = await saveIndexChecked(nextIndex);
      let check = null;
      try {
        check = indexSaved ? await loadIndexStrict() : null;
      } catch {
        check = null;
      }
      if (!check || !check.some((t) => t.id === id)) {
        showToast("Ο κατάλογος δεν ενημερώθηκε — το τουρνουά μένει στον κάδο.");
        return;
      }
      const nextTrash = trash.filter((t) => t.id !== id);
      if (!(await saveSysTrash(nextTrash))) {
        reportSaveFailure(`Κάδος — το «${entry.name}» επανήλθε στον κατάλογο αλλά φαίνεται ακόμα και στον κάδο`);
      }
      setTrash(nextTrash);
      setArchive(nextIndex);
      setTrashAction(null);
      showToast(`Επαναφέρθηκε: ${entry.name}`);
      if (runRecompute) await recomputeEloAndSeasonFromScratch(nextIndex);
    } finally {
      setTrashBusy(false);
    }
  }

  /** Permanent deletion — only for tournaments that are NOT official. */
  async function purgeFromTrash(id) {
    const entry = trash.find((t) => t.id === id);
    if (!entry || trashBusy) return;
    if (entry.isOfficial) {
      showToast("Ένα επίσημο τουρνουά δεν διαγράφεται οριστικά — κάν' το πρώτα ανεπίσημο.");
      return;
    }
    setTrashBusy(true);
    try {
      await deleteTournamentData(id);
      // The built-in historical days would otherwise be re-created on the next load.
      if (id.startsWith("hist-day")) {
        const purgedIds = [...new Set([...(sysState.purgedIds || []), id])];
        if (!(await saveSysState({ purgedIds }))) reportSaveFailure("Ρυθμίσεις — η λίστα οριστικά διαγραμμένων");
        setSysState((s) => ({ ...s, purgedIds }));
      }
      const nextTrash = trash.filter((t) => t.id !== id);
      if (!(await saveSysTrash(nextTrash))) reportSaveFailure("Κάδος");
      setTrash(nextTrash);
      setTrashAction(null);
      showToast("Το τουρνουά διαγράφηκε οριστικά.");
    } finally {
      setTrashBusy(false);
    }
  }

  async function markTrashedUnofficial(id) {
    const entry = trash.find((t) => t.id === id);
    if (!entry || trashBusy) return;
    setTrashBusy(true);
    try {
      const doc = await fetchTournamentData(id);
      if (!doc) {
        showToast("Το έγγραφο του τουρνουά δεν βρέθηκε.");
        return;
      }
      if (!(await saveTournamentData(id, { ...doc, isOfficial: false }))) {
        reportSaveFailure(`Τουρνουά «${entry.name || id}» — η σήμανση ως ανεπίσημο δεν αποθηκεύτηκε`);
        return;
      }
      const nextTrash = trash.map((t) => (t.id === id ? { ...t, isOfficial: false } : t));
      if (!(await saveSysTrash(nextTrash))) reportSaveFailure("Κάδος");
      setTrash(nextTrash);
      setTrashAction(null);
      showToast("Σημειώθηκε ως ανεπίσημο — τώρα μπορεί να διαγραφεί οριστικά.");
    } finally {
      setTrashBusy(false);
    }
  }
  // #endregion Κάδος

  /* ---- permanent person ids ---- */

  // #region Μητρώο & μόνιμα ID (μετάπτωση, ένωση προσώπων)
  function playerHasHistory(key) {
    const h = eloData?.players?.[key];
    return !!h && (h.games > 0 || h.matches > 0);
  }

  async function runIdentityPlan() {
    setIdentityBusy(true);
    try {
      const names = new Map();
      const ids = [...new Set([...archive.map((t) => t.id), ...trash.map((t) => t.id)])];
      for (const id of ids) {
        const d = await fetchTournamentData(id);
        if (!d || !d.players) continue;
        const seen = new Set();
        d.players.forEach((p) => {
          const b = baseName(p.name);
          if (!b || seen.has(b)) return;
          seen.add(b);
          const cur = names.get(b) || { name: p.name, tournaments: 0 };
          cur.tournaments += 1;
          names.set(b, cur);
        });
      }
      setIdentityPlan({ ...buildMigrationPlan({ registry, tournamentNames: names }), scanned: ids.length });
      setIdentityDecisions({});
    } finally {
      setIdentityBusy(false);
    }
  }

  // «Μεταφορά στοιχείων επικοινωνίας» (5A): preview, Export of the last
  // 24 hours, then moveContacts (write, verify, and only then strip the
  // public registry). Works from a fresh strict read of the registry.
  const [contactsPreview, setContactsPreview] = useState(null);
  const [contactsBusy, setContactsBusy] = useState(false);

  async function applyContactsMigration() {
    if (contactsBusy || registrySplitRef.current) return;
    const last = sysState.lastExportAt ? new Date(sysState.lastExportAt).getTime() : 0;
    if (Date.now() - last > 24 * 3600 * 1000) {
      showToast("Κάνε πρώτα Export All Data (των τελευταίων 24 ωρών).");
      return;
    }
    setContactsBusy(true);
    try {
      let fresh;
      try {
        fresh = await loadRegistryStrict();
      } catch {
        showToast("Το μητρώο δεν διαβάστηκε — δεν άλλαξε τίποτα. Δοκίμασε ξανά.");
        return;
      }
      if (fresh.contactsVersion === 1) {
        showToast("Η μεταφορά έχει ήδη γίνει.");
        return;
      }
      const result = await moveContacts(mergeContacts(fresh, null), {
        saveContacts: (doc) => guardedSave(saveContacts, "Στοιχεία επικοινωνίας", doc),
        loadContactsStrict,
        saveRegistry: (r) => guardedSave(saveRegistry, "Μητρώο παικτών", r),
      });
      if (!result.ok) {
        reportSaveFailure(`Μεταφορά στοιχείων επικοινωνίας — ${result.message}`);
        return;
      }
      registrySplitRef.current = true;
      contactsRef.current = { status: "loaded", data: result.contacts };
      const joined = mergeContacts(result.publicRegistry, result.contacts);
      setPersonLookup(joined);
      setRegistry(joined);
      setContactsPreview(null);
      showToast("Τα στοιχεία επικοινωνίας μεταφέρθηκαν σε ιδιωτικό έγγραφο.");
    } finally {
      setContactsBusy(false);
    }
  }

  async function applyIdentityMigration() {
    if (!identityPlan || identityBusy) return;
    const last = sysState.lastExportAt ? new Date(sysState.lastExportAt).getTime() : 0;
    if (Date.now() - last > 24 * 3600 * 1000) {
      showToast("Κάνε πρώτα Export All Data (των τελευταίων 24 ωρών).");
      return;
    }
    setIdentityBusy(true);
    try {
      const migrated = buildMigratedRegistry(registry, identityPlan.unmatched, identityDecisions);
      // Save, then verify by reading it back.
      const saved = await saveRegistryChecked(migrated);
      let check = null;
      try {
        check = saved ? await loadRegistryStrict() : null;
      } catch {
        check = null;
      }
      const written =
        check && check.identityVersion === 2 && Object.keys(check.players || {}).length === Object.keys(migrated.players).length;
      if (!written) {
        showToast("Η αποθήκευση του μητρώου δεν επιβεβαιώθηκε — δεν συνεχίζω. Έλεγξε τη σύνδεση και δοκίμασε ξανά.");
        return;
      }
      setPersonLookup(migrated);
      setRegistry(migrated);
      setIdentityPlan(null);
      await recomputeEloAndSeasonFromScratch();
      await runConsistencyCheck();
      setControlTab("data");
      setPhase("control"); // the consistency report is shown there
      showToast("Η μετάβαση σε μόνιμα ID ολοκληρώθηκε.");
    } finally {
      setIdentityBusy(false);
    }
  }

  async function mergePersons(keepKey, absorbKey, runRecompute) {
    const keep = registry.players[keepKey];
    const absorb = registry.players[absorbKey];
    if (!keep || !absorb || keepKey === absorbKey) return;
    const union = (a, b) => [...new Map([...(a || []), ...(b || [])].map((m) => [JSON.stringify(m), m])).values()];
    const merged = {
      ...keep,
      aliases: [...new Set([...personSpellings(keep), ...personSpellings(absorb)])],
      club: keep.club || absorb.club,
      clubId: keep.clubId || absorb.clubId || null,
      ...(keep.regNo || absorb.regNo ? { regNo: Math.min(...[keep.regNo, absorb.regNo].filter(Boolean)) } : {}),
      email: keep.email || absorb.email,
      phone: keep.phone || absorb.phone,
      membership: union(keep.membership, absorb.membership),
      hasDiscount: !!(keep.hasDiscount || absorb.hasDiscount),
      discountAmount: keep.discountAmount ?? absorb.discountAmount ?? 32,
      needsInfo: !!(keep.needsInfo && absorb.needsInfo),
    };
    const nextPlayers = { ...registry.players, [keepKey]: merged };
    delete nextPlayers[absorbKey];
    persistRegistry({ players: nextPlayers });
    setMergeFor(null);
    setMergeTarget("");
    setExpandedRegistryPlayer(keepKey);
    showToast(`Ενώθηκαν: «${absorb.name}» → «${keep.name}».`);
    if (runRecompute) await recomputeEloAndSeasonFromScratch();
  }
  // #endregion Μητρώο & μόνιμα ID (μετάπτωση, ένωση προσώπων)

  // #region Επίσημο τουρνουά, στοιχεία τουρνουά, μετάπτωση διοργανώσεων
  async function confirmOfficialToggle(runRecompute) {
    const next = !isOfficial;
    setConfirmingOfficial(false);
    setIsOfficial(next);
    if (!tournamentId) return;
    if (!(await saveTournamentData(tournamentId, { ...currentSnapshot(), isOfficial: next }))) {
      // Keep the screen and the catalogue in line with what is stored.
      setIsOfficial(!next);
      reportSaveFailure(`Τουρνουά «${tournamentName || tournamentId}» — η αλλαγή επίσημο/ανεπίσημο δεν αποθηκεύτηκε`);
      return;
    }
    const updated = archive.map((t) => (t.id === tournamentId ? { ...t, isOfficial: next } : t));
    setArchive(updated);
    const indexSaved = await saveIndexChecked(updated);
    if (runRecompute && indexSaved) await recomputeEloAndSeasonFromScratch(updated);
  }

  /* ---- Build 2: tournament details (date, season, competition, club) ---- */

  /** Saves an admin edit of an existing tournament's date, season,
   * competition and organising club, both in its own document and in the
   * catalogue. Numbers (ELO, standings) are not touched here; if the
   * tournament already counts, the admin is told to run Recompute. */
  async function saveTournamentMeta() {
    if (!metaEdit || !tournamentId) return;
    if (!tournamentEditable()) return;
    if (seasonLocked(sysState, Number(metaEdit.seasonYear)) && Number(metaEdit.seasonYear) !== seasonYear) {
      showToast(`Η σεζόν ${sn(metaEdit.seasonYear)} είναι κλειδωμένη — δεν μπορεί να μπει τουρνουά σε αυτήν.`);
      return;
    }
    const nextCreatedAt = withLocalDate(createdAt, metaEdit.date);
    const nextSeason = Number(metaEdit.seasonYear) || seasonYear;
    const changes = {
      createdAt: nextCreatedAt,
      seasonYear: nextSeason,
      competitionId: metaEdit.competitionId,
      organisation: metaEdit.organisation.trim(),
      organisationClubId: metaEdit.organisationClubId || null,
    };
    const ok = await saveTournamentData(tournamentId, { ...currentSnapshot(), ...changes });
    if (!ok) {
      reportSaveFailure(`Στοιχεία τουρνουά «${tournamentName || "Untitled"}» — δεν αποθηκεύτηκαν`);
      return;
    }
    const countsNow = isOfficial && (phase === "finished" || history.length > 0);
    const numbersAffected =
      countsNow &&
      (isoToLocalYMD(nextCreatedAt) !== isoToLocalYMD(createdAt) || nextSeason !== seasonYear || changes.competitionId !== competitionId);
    setCreatedAt(nextCreatedAt);
    setSeasonYear(nextSeason);
    setCompetitionId(changes.competitionId);
    setOrganisation(changes.organisation);
    setOrganisationClubId(changes.organisationClubId);
    setMetaEdit(null);
    const updated = archive.map((t) =>
      t.id === tournamentId ? { ...t, date: nextCreatedAt, seasonYear: nextSeason, competitionId: changes.competitionId } : t
    );
    setArchive(updated);
    if (!(await saveIndexChecked(updated))) return;
    if (numbersAffected) {
      setNotice("Τα στοιχεία αποθηκεύτηκαν. Επειδή το τουρνουά μετράει ήδη σε ELO/Βαθμολογία, τρέξε Recompute ώστε να ενημερωθούν.");
    } else {
      showToast("Τα στοιχεία του τουρνουά αποθηκεύτηκαν.");
    }
  }

  function startMetaEdit() {
    setMetaEdit({
      date: isoToLocalYMD(createdAt) || isoToLocalYMD(new Date().toISOString()),
      seasonYear,
      competitionId,
      organisation: organisation || "",
      organisationClubId: organisationClubId || null,
    });
  }

  /** Opens a tournament from a player card's history, remembering the card. */
  async function openTournamentFromPlayer(id, playerKey) {
    setTournamentReturnPlayer(playerKey);
    await openArchived(id);
  }

  function backToPlayer() {
    const key = tournamentReturnPlayer;
    setTournamentReturnPlayer(null);
    if (!key || !registry.players[key]) {
      setPhase("players");
      return;
    }
    setNotice("");
    setExpandedRegistryPlayer(key);
    setPlayerDetailTab("stats");
    setPhase("playerDetail");
  }

  async function saveHomeClub() {
    const value = (homeClubDraft ?? "").trim();
    if (!value) {
      showToast("Γράψε το όνομα του συλλόγου.");
      return;
    }
    const patch = { homeClub: value };
    if (!Array.isArray(sysState.competitions)) patch.competitions = DEFAULT_COMPETITIONS;
    if (await saveSysState(patch)) {
      setSysState((s) => ({ ...s, ...patch }));
      setHomeClubDraft(null);
      showToast("Ο σύλλογος αποθηκεύτηκε.");
    } else {
      reportSaveFailure("Ρυθμίσεις — ο σύλλογος δεν αποθηκεύτηκε");
    }
  }

  /** Dry run of the Build 2 migration: reads every tournament (catalogue and
   * trash) and reports what would be filled in. Changes nothing. */
  async function runMetaPlan() {
    setMetaBusy(true);
    try {
      const all = [...archive.map((t) => ({ ...t, inTrash: false })), ...trash.map((t) => ({ ...t, inTrash: true }))];
      const rows = [];
      const unreadable = [];
      for (const t of all) {
        let d;
        try {
          d = await fetchTournamentDataStrict(t.id);
        } catch {
          unreadable.push(t.name || t.id);
          continue;
        }
        if (!d) {
          unreadable.push(t.name || t.id);
          continue;
        }
        const expected = seasonForDate(d.createdAt);
        rows.push({
          id: t.id,
          name: d.tournamentName || t.name || t.id,
          inTrash: t.inTrash,
          date: d.createdAt || null,
          seasonYear: d.seasonYear ?? null,
          expectedSeason: expected,
          needsCompetition: !d.competitionId,
          needsOrganisation: d.organisation === undefined || d.organisation === null || d.organisation === "",
          needsSeason: !d.seasonYear,
          seasonMismatch: !!d.seasonYear && !!expected && d.seasonYear !== expected,
          noDate: !d.createdAt || !expected,
          indexOutdated: !t.inTrash && (t.seasonYear !== (d.seasonYear || expected) || t.competitionId !== (d.competitionId || DEFAULT_COMPETITION_ID)),
        });
      }
      setMetaPlan({ rows, unreadable, scannedAt: new Date().toISOString() });
    } finally {
      setMetaBusy(false);
    }
  }

  /** Applies the migration: fills competition (Premier League), organising
   * club (the home club) and, only where missing, the season. Season and
   * date that already exist are never changed. Stops at the first failure. */
  async function applyMetaMigration() {
    if (!metaPlan || metaBusy) return;
    const last = sysState.lastExportAt ? new Date(sysState.lastExportAt).getTime() : 0;
    if (Date.now() - last > 24 * 3600 * 1000) {
      showToast("Κάνε πρώτα Export All Data (των τελευταίων 24 ωρών).");
      return;
    }
    if (!sysState.homeClub) {
      showToast("Συμπλήρωσε πρώτα τον σύλλογό σου.");
      return;
    }
    if (metaPlan.unreadable.length > 0) {
      showToast("Κάποια τουρνουά δεν διαβάστηκαν — ξανατρέξε την αναφορά.");
      return;
    }
    setMetaBusy(true);
    try {
      const filled = {};
      for (const r of metaPlan.rows) {
        let d;
        try {
          d = await fetchTournamentDataStrict(r.id);
        } catch {
          d = null;
        }
        if (!d) {
          reportSaveFailure(`Μετάπτωση διοργανώσεων — το «${r.name}» δεν διαβάστηκε· η μετάπτωση σταμάτησε (ό,τι γράφτηκε ως εδώ είναι σωστό, ξανατρέξε την)`);
          return;
        }
        const next = {
          ...d,
          competitionId: d.competitionId || DEFAULT_COMPETITION_ID,
          organisation: d.organisation || sysState.homeClub,
          seasonYear: d.seasonYear || seasonForDate(d.createdAt) || 2026,
        };
        filled[r.id] = { seasonYear: next.seasonYear, competitionId: next.competitionId };
        const changed = next.competitionId !== d.competitionId || next.organisation !== d.organisation || next.seasonYear !== d.seasonYear;
        if (changed && !(await saveTournamentData(r.id, next))) {
          reportSaveFailure(`Μετάπτωση διοργανώσεων — το «${r.name}» δεν αποθηκεύτηκε· η μετάπτωση σταμάτησε (ό,τι γράφτηκε ως εδώ είναι σωστό, ξανατρέξε την)`);
          return;
        }
      }
      const nextIndex = archive.map((t) => (filled[t.id] ? { ...t, ...filled[t.id] } : t));
      if (!(await saveIndexChecked(nextIndex))) return;
      setArchive(nextIndex);
      const nextTrash = trash.map((t) => (filled[t.id] ? { ...t, ...filled[t.id] } : t));
      if (!(await saveSysTrash(nextTrash))) {
        reportSaveFailure("Μετάπτωση διοργανώσεων — ο κάδος δεν ενημερώθηκε (τα τουρνουά του ενημερώθηκαν κανονικά)");
      } else {
        setTrash(nextTrash);
      }
      const patch = { tournamentMetaVersion: 1, tournamentMetaMigratedAt: new Date().toISOString() };
      if (!Array.isArray(sysState.competitions)) patch.competitions = DEFAULT_COMPETITIONS;
      if (await saveSysState(patch)) setSysState((s) => ({ ...s, ...patch }));
      else reportSaveFailure("Μετάπτωση διοργανώσεων — ολοκληρώθηκε, αλλά δεν καταγράφηκε ως ολοκληρωμένη");
      setMetaPlan(null);
      showToast("Η μετάπτωση διοργανώσεων ολοκληρώθηκε.");
    } finally {
      setMetaBusy(false);
    }
  }
  // #endregion Επίσημο τουρνουά, στοιχεία τουρνουά, μετάπτωση διοργανώσεων

  /* ---- data health: does the stored ELO / season match the catalogue? ---- */

  // #region Έλεγχος συνέπειας
  /** Strict reads: a failed read throws instead of looking like "nothing
   * stored", which would show differences that are not really there. */
  async function loadHealthInputs(indexOverride) {
    const [elo, years] = await Promise.all([loadEloStrict(), listSeasonYearsStrict()]);
    const seasons = {};
    for (const y of years) seasons[y] = await loadSeasonStrict(y);
    const index = Array.isArray(indexOverride) ? indexOverride : await loadIndexStrict();
    return { elo, seasons, index, display: new Map(PERSON_DISPLAY) };
  }

  async function refreshHealth(indexOverride) {
    try {
      setHealth(buildConsistencyReport(await loadHealthInputs(indexOverride)));
    } catch {
      /* the banner is best-effort: on a failed read it keeps its last state */
    }
  }

  async function runConsistencyCheck() {
    setConsistencyLoading(true);
    setConsistencyError("");
    try {
      const report = buildConsistencyReport(await loadHealthInputs());
      setConsistencyReport(report);
      setHealth(report);
    } catch {
      setConsistencyReport(null);
      setConsistencyError("Ο έλεγχος δεν ολοκληρώθηκε — η βάση δεν διαβάστηκε. Δοκίμασε ξανά.");
    } finally {
      setConsistencyLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    if (phase === "dashboard" || phase === "elo" || phase === "season" || phase === "archive" || phase === "control") refreshHealth();
  }, [isAdmin, phase, archive.length]);
  // #endregion Έλεγχος συνέπειας

  /* ---- player registry ---- */

  // #region Μητρώο παικτών: στοιχεία, συνδρομές, ιστορικό
  function persistRegistry(next) {
    const merged = { ...registry, ...next };
    // Registry numbers are never reused: remember the highest one ever given.
    if (merged.regNoVersion === 1) {
      const top = Math.max(merged.regNoMax || 0, ...Object.values(merged.players || {}).map((p) => p.regNo || 0));
      merged.regNoMax = top;
    }
    setPersonLookup(merged);
    setRegistry(merged);
    saveRegistryChecked(merged);
  }

  /** A fresh registry entry. After the migration it gets a permanent id and
   * remembers the spelling it was created with; before it, the old name key. */
  function registryWithNewPerson(name, extra = {}) {
    const migrated = registry.identityVersion === 2;
    const key = migrated ? newPersonId(registry.players) : normalizeName(name);
    const entry = {
      name,
      ...(migrated ? { aliases: [baseName(name)] } : {}),
      club: "", email: "", phone: "", membership: [], needsInfo: true, hasDiscount: false, discountAmount: 32,
      ...(registry.regNoVersion === 1 ? { regNo: nextRegNo(registry) } : {}),
      ...extra,
    };
    return { key, entry };
  }

  function addRegistryPlayer() {
    let suffix = 1;
    let name = "New Player";
    while (registry.players[normalizeName(name)]) {
      suffix += 1;
      name = `New Player ${suffix}`;
    }
    const { key, entry } = registryWithNewPerson(name);
    const next = { players: { ...registry.players, [key]: entry } };
    persistRegistry(next);
    setExpandedRegistryPlayer(key);
    loadPlayerTournamentHistory(name);
  }

  function saveContactDraft(key) {
    const player = registry.players[key];
    if (!player || !contactDraft) return;
    const newName = (contactDraft.name || "").trim();
    if (!newName) {
      showToast("Player needs a name before saving.");
      return;
    }
    const stillNeedsInfo = contactDraft.email.trim() || contactDraft.phone.trim() ? false : player.needsInfo;
    if (registry.identityVersion === 2) {
      // The person keeps their permanent id; the new spelling becomes an alias
      // next to the old ones, so every earlier tournament still finds them.
      const taken = Object.entries(registry.players).find(([k, p]) => k !== key && personSpellings(p).includes(baseName(newName)));
      if (taken) {
        showToast(`Το όνομα «${newName}» ανήκει ήδη σε άλλο πρόσωπο (${taken[1].name}). Αν είναι ο ίδιος παίκτης, χρησιμοποίησε «Ένωση με άλλο πρόσωπο».`);
        return;
      }
      const aliases = [...new Set([...personSpellings(player), baseName(newName)])];
      const updated = { ...player, ...contactDraft, name: newName, aliases, needsInfo: stillNeedsInfo };
      // A guest who joins the Greek registry gets a registry number then.
      if (!updated.guest && !updated.regNo && registry.regNoVersion === 1) updated.regNo = nextRegNo(registry);
      persistRegistry({ players: { ...registry.players, [key]: updated } });
      showToast(`${newName} saved.`);
      return;
    }
    const newKey = normalizeName(newName);
    const updated = { ...player, ...contactDraft, name: newName, needsInfo: stillNeedsInfo };
    const nextPlayers = { ...registry.players };
    if (newKey !== key) delete nextPlayers[key];
    nextPlayers[newKey] = updated;
    persistRegistry({ players: nextPlayers });
    if (newKey !== key) setExpandedRegistryPlayer(newKey);
    showToast(`${newName} saved.`);
  }

  function deleteRegistryPlayer(key) {
    const player = registry.players[key];
    if (!player) return;
    const history = eloData?.players?.[key];
    if (history && (history.games > 0 || history.matches > 0)) {
      setConfirmingDeletePlayer(null);
      showToast(`Ο/Η ${player.name} έχει ιστορικό αγώνων και δεν διαγράφεται από το μητρώο.`);
      return;
    }
    const nextPlayers = { ...registry.players };
    delete nextPlayers[key];
    persistRegistry({ players: nextPlayers });
    setExpandedRegistryPlayer(null);
    setConfirmingDeletePlayer(null);
    showToast(`${player.name} removed from the registry.`);
  }

  function addMembershipRow(key, year) {
    const player = registry.players[key];
    if (!player) return;
    const exists = player.membership.some((m) => m.year === year);
    if (exists) return;
    const nextMembership = [...player.membership, { year, member: true, dues: true }].sort((a, b) => b.year - a.year);
    const next = { players: { ...registry.players, [key]: { ...player, membership: nextMembership } } };
    persistRegistry(next);
  }

  function updateMembershipRow(key, year, field, value) {
    const player = registry.players[key];
    if (!player) return;
    const nextMembership = player.membership.map((m) => (m.year === year ? { ...m, [field]: value } : m));
    const next = { players: { ...registry.players, [key]: { ...player, membership: nextMembership } } };
    persistRegistry(next);
  }

  function removeMembershipRow(key, year) {
    const player = registry.players[key];
    if (!player) return;
    const nextMembership = player.membership.filter((m) => m.year !== year);
    const next = { players: { ...registry.players, [key]: { ...player, membership: nextMembership } } };
    persistRegistry(next);
  }

  async function loadPlayerTournamentHistory(name) {
    const key = normalizeName(name);
    const years = await listSeasonYears();
    const rows = [];
    for (const year of years) {
      const season = await loadSeason(year);
      const entry = season.players[key];
      if (entry) {
        Object.entries(entry.entries).forEach(([tournamentId, e]) => {
          rows.push({ year, tournamentId, tournamentName: e.tournamentName, date: e.date, points: e.points });
        });
      }
    }
    rows.forEach((r) => {
      const t = archive.find((x) => x.id === r.tournamentId);
      r.competitionId = t ? t.competitionId || DEFAULT_COMPETITION_ID : DEFAULT_COMPETITION_ID;
    });
    // imported tournaments the person played in (Build 4B)
    Object.entries(importDocs).forEach(([id, doc]) => {
      if (!doc.personMap) return;
      const names = Object.entries(doc.personMap).filter(([, k]) => k === key).map(([n]) => n);
      if (names.length === 0) return;
      const pl = (doc.placements || []).find((p) => names.includes(p.name));
      const date = importDateIso(doc.date) || doc.importedAt;
      rows.push({ year: importSeason(doc), tournamentId: id, tournamentName: doc.name, date, points: null, position: pl ? pl.position : null, positionLabel: pl ? pl.positionLabel || null : null, competitionId: importCompetitionId(doc), imported: true });
    });
    rows.sort((a, b) => new Date(b.date) - new Date(a.date));
    setPlayerHistoryCache((prev) => ({ ...prev, [key]: rows }));
  }
  // #endregion Μητρώο παικτών: στοιχεία, συνδρομές, ιστορικό

  // #region ELO & Recompute
  /** Replays every match chronologically (the 11 embedded historical days,
   * then any other archived tournament by date) into a fresh, throwaway ELO
   * state, snapshotting each participant's rating and cumulative win rate
   * after each day/tournament. Computed once, cached, and reused for every
   * player card — recomputing per player would repeat the same replay. */
  async function computeEloTimeline() {
    setEloTimelineLoading(true);
    const working = { players: {} };
    const timeline = {};

    function snapshot(date, participantKeys) {
      participantKeys.forEach((key) => {
        const p = working.players[key];
        if (!p) return;
        if (!timeline[key]) timeline[key] = [];
        const wins = p.wins || 0;
        timeline[key].push({ date, rating: p.rating, winRate: p.games > 0 ? (wins / p.games) * 100 : 0 });
      });
    }

    // Build 3D: the per-match ledger ("how this rating was reached"),
    // recorded during the same replay — so it can never disagree with it.
    const ledger = {}; // key -> [{ date, tournamentId, tournamentName, round, opponent, opponentRating, result, delta, ratingAfter, ret }]
    const extraTournaments = archive.filter(countsTowardRatings).sort((a, b) => new Date(a.date) - new Date(b.date));
    for (const t of extraTournaments) {
      const data = await fetchTournamentData(t.id);
      if (!data || !data.history || !data.players) continue;
      const participants = new Set();
      const ml = data.matchLength || 7;
      data.history.forEach((entry, idx) => {
        const roundMatches = [];
        entry.pairs.forEach((pr) => {
          if (!pr.result) return;
          const w = data.players.find((p) => p.id === pr.result.winnerId);
          const l = data.players.find((p) => p.id === pr.result.loserId);
          if (!w || !l) return;
          roundMatches.push({ w: w.name, l: l.name, ret: pr.result.method === "retirement" });
        });
        // ratings before the round (the whole round is applied as one batch)
        const pending = [];
        roundMatches.forEach((m) => {
          const wKey = normalizeName(m.w);
          const lKey = normalizeName(m.l);
          const wR = working.players[wKey]?.rating ?? ELO_INITIAL;
          const lR = working.players[lKey]?.rating ?? ELO_INITIAL;
          const delta = m.ret ? 0 : (1 - eloWinProbability(wR, lR, ml)) * eloPointsAtStake(ml);
          const base = { date: t.date, tournamentId: t.id, tournamentName: t.name, round: entry.round ?? idx + 1, matchLength: ml, ret: m.ret };
          pending.push([wKey, { ...base, opponent: m.l, opponentRating: lR, result: "win", delta }]);
          pending.push([lKey, { ...base, opponent: m.w, opponentRating: wR, result: "loss", delta: -delta }]);
        });
        applyEloRoundBatch(working, roundMatches, ml);
        pending.forEach(([k, row]) => {
          if (!ledger[k]) ledger[k] = [];
          ledger[k].push({ ...row, ratingAfter: working.players[k]?.rating ?? ELO_INITIAL });
        });
        roundMatches.forEach((m) => {
          if (m.ret) return;
          participants.add(normalizeName(m.w));
          participants.add(normalizeName(m.l));
        });
      });
      snapshot(t.date, [...participants]);
    }

    timeline.__ledger = ledger;
    setEloTimeline(timeline);
    setEloTimelineLoading(false);
  }

  /** Rebuilds the ELO and EVERY season's standings entirely from scratch
   * (Build 2: each tournament goes to its own season; a season left with no
   * counting tournament is emptied, so a stray test entry disappears),
   * replaying every tournament flagged "Official" (isOfficial: true), in
   * chronological order, straight from its own stored history — the 11
   * League days are flagged this way by default. Any tournament NOT
   * flagged Official (e.g. a test) is skipped entirely, whether or not it
   * still exists in the archive — no need to delete it first. */
  async function recomputeEloAndSeasonFromScratch(indexOverride, opts = {}) {
    setNotice("Recomputing ELO and Season Standings from official League days…");
    const elo = { players: {}, initialized: true };
    const seasonsBuilt = {}; // year -> { players }
    const seasonTournaments = {}; // year -> count
    const appliedNow = {};
    let matchesCounted = 0;
    const builtAt = new Date().toISOString();

    const catalogue = Array.isArray(indexOverride) ? indexOverride : archive;
    const officialTournaments = catalogue.filter(countsTowardRatings).sort((a, b) => new Date(a.date) - new Date(b.date));
    for (const t of officialTournaments) {
      // Strict read: if any official tournament cannot be read, stop and
      // write nothing — a rebuild without it would silently drop its matches.
      let data;
      try {
        data = await fetchTournamentDataStrict(t.id);
      } catch {
        setNotice("");
        reportSaveFailure(`Recompute — το τουρνουά «${t.name}» δεν διαβάστηκε· ΔΕΝ γράφτηκε τίποτα. Δοκίμασε ξανά.`);
        return;
      }
      if (!data || !data.history || !data.players) continue;
      appliedNow[t.id] = { name: data.tournamentName, mode: "recompute", at: builtAt };
      data.history.forEach((entry) => {
        const roundMatches = [];
        entry.pairs.forEach((pr) => {
          if (!pr.result) return;
          const w = data.players.find((p) => p.id === pr.result.winnerId);
          const l = data.players.find((p) => p.id === pr.result.loserId);
          if (!w || !l) return;
          roundMatches.push({ w: w.name, l: l.name, ret: pr.result.method === "retirement" });
        });
        matchesCounted += roundMatches.length;
        applyEloRoundBatch(elo, roundMatches, data.matchLength || 7);
      });
      if (data.phase === "finished") {
        const year = Number(data.seasonYear) || seasonForDate(data.createdAt) || 2026;
        if (!seasonsBuilt[year]) seasonsBuilt[year] = { players: {} };
        seasonTournaments[year] = (seasonTournaments[year] || 0) + 1;
        const season = seasonsBuilt[year];
        data.players.forEach((p) => {
          const key = normalizeName(p.name);
          if (!season.players[key]) season.players[key] = { name: displayNameFor(key, p.name), entries: {} };
          season.players[key].name = displayNameFor(key, p.name);
          const wins = p.matchLog.filter((m) => m.method === "normal" && m.result === "win").length;
          const aa = p.matchLog.filter((m) => m.method === "retirement_win").length;
          const bye = p.matchLog.filter((m) => m.method === "bye").length;
          // Retirement wins don't count toward the winner's matches-played total
    // (they get the standings point, but the match itself doesn't "count"
    // for them); a retirement loss, a double retirement, and every normal
    // match do count, for whoever played them.
    const matches = p.matchLog.filter((m) => m.method !== "bye" && m.method !== "retirement_win").length;
          const normalMatches = p.matchLog.filter((m) => m.method === "normal").length;
          season.players[key].entries[t.id] = {
            tournamentName: data.tournamentName, date: data.createdAt, points: p.wins, wins, aa, bye, matches, normalMatches,
          };
        });
      }
    }

    // Every season that exists in the database is rewritten — those with no
    // counting tournament become empty. The listing is strict: if it fails,
    // nothing at all is written.
    let existingYears;
    try {
      existingYears = await listSeasonYearsStrict();
    } catch {
      setNotice("");
      reportSaveFailure("Recompute — η λίστα σεζόν δεν διαβάστηκε· ΔΕΝ γράφτηκε τίποτα. Δοκίμασε ξανά.");
      return;
    }
    const yearsToWrite = [...new Set([...existingYears, ...Object.keys(seasonsBuilt).map(Number)])].sort((a, b) => a - b);

    // A locked season's standings may only change with explicit consent.
    if (!opts.allowLocked) {
      const conflicts = [];
      for (const y of yearsToWrite.filter((x) => seasonLocked(sysState, x))) {
        let current;
        try {
          current = await loadSeasonStrict(y);
        } catch {
          setNotice("");
          reportSaveFailure(`Recompute — η κλειδωμένη σεζόν ${sn(y)} δεν διαβάστηκε· ΔΕΝ γράφτηκε τίποτα. Δοκίμασε ξανά.`);
          return;
        }
        if (seasonFingerprint(current) !== seasonFingerprint(seasonsBuilt[y] || { players: {} })) conflicts.push(y);
      }
      if (conflicts.length > 0) {
        setNotice("");
        setRecomputeLockConflict({ years: conflicts, indexOverride: Array.isArray(indexOverride) ? indexOverride : null });
        return;
      }
    }

    elo.appliedTournaments = appliedNow;
    elo.builtFrom = {
      at: builtAt,
      tournaments: Object.keys(appliedNow).length,
      matches: matchesCounted,
      players: Object.keys(elo.players).length,
      seasons: Object.fromEntries(
        yearsToWrite.map((y) => [String(y), { tournaments: seasonTournaments[y] || 0, players: Object.keys(seasonsBuilt[y]?.players || {}).length }])
      ),
    };
    const eloSaved = await saveEloChecked(elo);
    let seasonsOk = eloSaved;
    if (eloSaved) {
      for (const y of yearsToWrite) {
        if (!(await saveSeason(y, seasonsBuilt[y] || { players: {} }))) {
          const notWritten = yearsToWrite.filter((x) => x >= y).join(", ");
          reportSaveFailure(`Recompute — δεν αποθηκεύτηκε η Βαθμολογία των σεζόν ${notWritten} (η ELO αποθηκεύτηκε). Τρέξε ξανά το Recompute.`);
          seasonsOk = false;
          break;
        }
      }
    }
    setNotice("");
    if (!eloSaved || !seasonsOk) {
      refreshHealth(catalogue);
      return;
    }
    setEloData(elo);
    setEloTimeline(null);
    setPlayerMatchStatsCache({});
    setSeasonData(seasonsBuilt[seasonBrowseYear] || { players: {} });
    const perSeason = yearsToWrite.map((y) => `${y}: ${seasonTournaments[y] || 0} τουρνουά`).join(" · ");
    showToast(`Recompute ολοκληρώθηκε — ${perSeason}`);
    refreshHealth(catalogue);
  }
  // #endregion ELO & Recompute

  // #region RSS & σύνοψη
  /** Builds a ready-to-paste Greek recap of this tournament: top finishers,
   * movement at the top of Season Standings, and ELO movement at the top —
   * with plain-text links back into the app (deep-linking via #season/#elo)
   * for anyone who wants the full detail. Pure text generation; nothing is
   * posted or sent anywhere — the admin copies and pastes it themselves. */
  async function generateRecap() {
    setRecapLoading(true);
    try {
      const APP_URL = "https://bgfed-tournament.vercel.app";
      const thisEntry = archive.find((t) => t.id === tournamentId);
      const dateLabel = thisEntry
        ? new Date(thisEntry.date).toLocaleDateString("el-GR", { day: "numeric", month: "long", year: "numeric" })
        : "";
      const dayNamesEl = [
        { name: "Κυριακή", article: "την" },
        { name: "Δευτέρα", article: "τη" },
        { name: "Τρίτη", article: "την" },
        { name: "Τετάρτη", article: "την" },
        { name: "Πέμπτη", article: "την" },
        { name: "Παρασκευή", article: "την" },
        { name: "Σάββατο", article: "το" },
      ];
      const dayInfo = thisEntry ? dayNamesEl[new Date(thisEntry.date).getDay()] : null;
      const dayName = dayInfo ? `${dayInfo.article} ${dayInfo.name}` : "";
      const ordinalMatch = tournamentName.match(/Ημέρα\s*(\d+)/) || tournamentName.match(/(\d+)/);
      const ordinalPhrase = ordinalMatch ? `το ${ordinalMatch[1]}ο τουρνουά` : "το τουρνουά αυτής της αγωνιστικής";
      const introLine = dayName && dateLabel
        ? `${dayName.charAt(0).toUpperCase()}${dayName.slice(1)} ${dateLabel}, πραγματοποιήθηκε ${ordinalPhrase} της φετινής σεζόν. Είχε ${players.length} συμμετοχές, και τα αποτελέσματα έχουν ως εξής:`
        : `Πραγματοποιήθηκε ${ordinalPhrase} της φετινής σεζόν, με ${players.length} συμμετοχές. Τα αποτελέσματα έχουν ως εξής:`;

      // 1. Top finishers of this specific tournament. "Winner(s) of the
      // day" = only players with a perfect record (wins === totalRounds).
      const perfectWinners = players.filter((p) => p.wins === totalRounds);
      const runnersUp = totalRounds > 1 ? players.filter((p) => p.wins === totalRounds - 1) : [];

      // 2. Season Standings: compare with vs. without this tournament's entries.
      const seasonFull = await loadSeason(seasonYear);
      const recapBestOf = rulesForSeason(sysState, seasonYear).bestOf;
      const afterStandings = computeSeasonStandings(seasonFull, recapBestOf);
      const seasonBefore = JSON.parse(JSON.stringify(seasonFull));
      Object.values(seasonBefore.players).forEach((p) => { delete p.entries[tournamentId]; });
      const beforeStandings = computeSeasonStandings(seasonBefore, recapBestOf);
      const beforeRank = {};
      beforeStandings.forEach((p, i) => { beforeRank[p.name] = i + 1; });
      const top5Season = afterStandings.slice(0, 5).map((p, i) => {
        const prev = beforeRank[p.name];
        let move = "νέος στην κορυφή";
        if (prev) {
          const diff = prev - (i + 1);
          move = diff > 0 ? `▲ από #${prev}` : diff < 0 ? `▼ από #${prev}` : "παραμένει";
        }
        return `${i + 1}. ${p.name} — ${p.total}β (${move})`;
      });

      // 3. ELO: replay every earlier tournament (by date) to get a clean
      // "before today" snapshot, then diff against the current live ratings.
      const seenIds = new Set();
      const chronological = [...archive]
        .filter((t) => { if (seenIds.has(t.id)) return false; seenIds.add(t.id); return true; })
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      const selfIdx = chronological.findIndex((t) => t.id === tournamentId);
      const priorTournaments = selfIdx >= 0 ? chronological.slice(0, selfIdx) : [];
      const eloBefore = { players: {} };
      for (const t of priorTournaments) {
        const data = await fetchTournamentData(t.id);
        if (!data || !data.history) continue;
        data.history.forEach((entry) => {
          const roundMatches = [];
          entry.pairs.forEach((pr) => {
            if (!pr.result) return;
            const w = data.players.find((p) => p.id === pr.result.winnerId);
            const l = data.players.find((p) => p.id === pr.result.loserId);
            if (!w || !l) return;
            roundMatches.push({ w: w.name, l: l.name, ret: pr.result.method === "retirement" });
          });
          applyEloRoundBatch(eloBefore, roundMatches, data.matchLength || 7);
        });
      }
      const eloNow = await loadElo();
      const top5Elo = Object.values(eloNow.players)
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 5)
        .map((p, i) => {
          const key = normalizeName(p.name);
          const before = eloBefore.players[key]?.rating ?? ELO_INITIAL;
          const delta = Math.round(p.rating - before);
          const deltaLabel = delta > 0 ? `Δ +${delta}` : delta < 0 ? `Δ ${delta}` : "χωρίς μεταβολή σήμερα";
          return `${i + 1}. ${p.name} — ${Math.round(p.rating)} (${deltaLabel})`;
        });

      const lines = [
        `📊 Αποτελέσματα: ${tournamentName}${dateLabel ? " — " + dateLabel : ""}`,
        introLine,
        "",
        perfectWinners.length > 0
          ? `🏆 ${perfectWinners.length > 1 ? "Νικητές της ημέρας" : "Νικητής της ημέρας"}: ${perfectWinners.map((p) => p.name).join(", ")} (${totalRounds} νίκες)`
          : `🏆 Κανείς με τέλειο σκορ σήμερα`,
        ...(runnersUp.length > 0 ? [`Από ${totalRounds - 1} νίκες έκαναν οι: ${runnersUp.map((p) => p.name).join(", ")}`] : []),
        "",
        "📈 Βαθμολογία:",
        ...top5Season,
        "",
        "⭐ Κατάταξη ELO:",
        ...top5Elo,
        "",
        "Δείτε αναλυτικά:",
        `👉 Βαθμολογία: ${APP_URL}#season`,
        `👉 Κατάταξη ELO: ${APP_URL}#elo`,
      ];

      setRecapText(lines.join("\n"));
    } catch (err) {
      showToast("Αποτυχία δημιουργίας σύνοψης — δοκίμασε ξανά.");
    } finally {
      setRecapLoading(false);
    }
  }

  /** Adds the already-generated recap as a new item in the shared RSS
   * feed (Firestore), which /api/feed turns into real RSS XML. WordPress
   * (via a plugin like Feedzy) — or anything else that reads RSS — picks
   * it up on its own schedule; nothing is pushed to bgfed.gr directly,
   * so Cloudflare's bot protection never sees an incoming request from us. */
  const [addingToFeed, setAddingToFeed] = useState(false);
  async function addRecapToFeed() {
    if (!recapText) return;
    setAddingToFeed(true);
    try {
      // Read strictly: a failed read must not look like an empty feed, or the
      // write below would replace every published item with this one.
      let items;
      try {
        items = await loadFeedItemsStrict();
      } catch {
        reportSaveFailure("RSS feed — δεν επιχειρήθηκε, γιατί το feed δεν διαβάστηκε");
        return;
      }

      // Group the plain-text lines into visual sections (title, winner,
      // standings, ELO, links) and render each as its own styled box —
      // only for the WordPress/HTML version. The copy/paste version stays
      // plain text, since Facebook etc. can't render boxes anyway.
      const rawLines = recapText.split("\n").filter((line) => line.trim() !== "");
      const groups = [];
      const startMarkers = ["📊", "🏆", "📈", "⭐", "Δείτε αναλυτικά:"];
      rawLines.forEach((line) => {
        const isNewGroup = startMarkers.some((m) => line.startsWith(m));
        if (isNewGroup || groups.length === 0) groups.push([line]);
        else groups[groups.length - 1].push(line);
      });
      // WordPress strips inline style="" attributes from imported content
      // for security, so custom boxes never survive, and blockquote/hr
      // didn't look good either. Use plain headings for most sections —
      // every WP theme styles <h4> distinctly with zero custom CSS needed.
      // The two ranking groups (Standings/ELO) become real <table>
      // elements instead, so the numbers line up — something plain text
      // can never do reliably (and Facebook/copy-paste can't render a
      // table at all, hence this is only worth doing for the HTML feed).
      const linkLineRe = /^👉 (.+?): (https?:\/\/\S+)$/;
      const rankLineRe = /^(\d+)\.\s+(.+?)\s+—\s+(.+?)\s+\((.+?)\)$/;
      const rankGroupHeaders = { "📈 Βαθμολογία:": "Βαθμοί", "⭐ Κατάταξη ELO:": "ELO" };
      const htmlDescription = groups
        .map((group) => {
          const header = group[0];
          if (rankGroupHeaders[header]) {
            const rows = group
              .slice(1)
              .map((line) => line.match(rankLineRe))
              .filter(Boolean)
              .map((m) => {
                // A couple of &nbsp; give the cells breathing room — WordPress
                // strips inline style="" (incl. padding) from imported content,
                // so real CSS spacing isn't an option here, only literal text.
                // The "β"/"Δ" suffix-prefix make sense in plain-text copy/paste
                // but are redundant once there's an actual column header, so
                // they're stripped only for this table version.
                const value = m[3].replace(/β$/, "");
                const trend = m[4].replace(/^Δ\s*/, "");
                return `<tr><td>&nbsp;${m[1]}&nbsp;</td><td>&nbsp;${m[2]}&nbsp;</td><td>&nbsp;${value}&nbsp;</td><td>&nbsp;${trend}&nbsp;</td></tr>`;
              })
              .join("");
            // Fixed, matching column widths on both tables (the "width"
            // attribute, not style="" — WordPress keeps this one), so the
            // Player column lines up the same whether the longest name in
            // this particular table happens to be short or long.
            return `<h4>${header}</h4><table width="100%"><thead><tr><th width="8%">#</th><th width="46%">Παίκτης</th><th width="20%">${rankGroupHeaders[header]}</th><th width="26%">Μεταβολή</th></tr></thead><tbody>${rows}</tbody></table>`;
          }
          return group
            .map((line, i) => {
              const linkMatch = line.match(linkLineRe);
              if (linkMatch) return `<p>👉 <a href="${linkMatch[2]}">${linkMatch[1]}</a></p>`;
              if (i === 0) return line.startsWith("🏆") ? `<h3>${line}</h3>` : `<h4>${line}</h4>`;
              return `<p>${line}</p>`;
            })
            .join("");
        })
        .join("");
      const newItem = {
        guid: `${tournamentId || "tournament"}-${Date.now()}`,
        title: `Αποτελέσματα: ${tournamentName}`,
        description: htmlDescription,
        link: `https://bgfed-tournament.vercel.app/?recap=${tournamentId || "tournament"}-${Date.now()}`,
        pubDate: new Date().toISOString(),
      };
      const updated = [newItem, ...items].slice(0, 20); // keep the feed small
      if (await saveFeedItemsChecked(updated)) showToast("Προστέθηκε στο RSS feed!");
    } catch (err) {
      setNotice(`Αποτυχία προσθήκης στο feed: ${err.message}`);
    } finally {
      setAddingToFeed(false);
    }
  }

  /** Empties the RSS feed entirely — does not touch anything already
   * imported into WordPress (those are now regular WP posts/drafts,
   * independent of us); it only clears what /api/feed will show next. */
  async function clearFeed() {
    try {
      if (await saveFeedItemsChecked([])) showToast("Το RSS feed αδειάστηκε.");
    } catch (err) {
      setNotice(`Αποτυχία αδειάσματος feed: ${err.message}`);
    }
  }
  // #endregion RSS & σύνοψη

  // #region Στατιστικά & καρτέλα παίκτη
  /** Full breakdown of one player against every opponent they've ever
   * faced — across the 11 historical days and every other saved
   * tournament. Matched by normalized name (same approach as ELO/season
   * aggregation elsewhere in the app). Returns one row per opponent with
   * the full meeting list, so the UI can show a compact table with an
   * expandable per-opponent detail instead of one pair at a time. */
  async function computeOpponentBreakdown(playerName, scope = statsScope, competition = statsCompetition) {
    setH2hLoading(true);
    setH2hResult(null);
    try {
      const key = normalizeName(playerName);
      const opponentsMap = {};

      const others = archive
        .filter((t) => t.isOfficial && tournamentInScope(t, scope) && (competition === "all" || (t.competitionId || DEFAULT_COMPETITION_ID) === competition))
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      for (const t of others) {
        const data = await fetchTournamentData(t.id);
        if (!data || !data.history || !data.players) continue;
        data.history.forEach((entry) => {
          entry.pairs.forEach((pr) => {
            if (!pr.result) return;
            const p1 = data.players.find((p) => p.id === pr.p1);
            const p2 = data.players.find((p) => p.id === pr.p2);
            if (!p1 || !p2) return;
            const k1 = normalizeName(p1.name);
            const k2 = normalizeName(p2.name);
            if (k1 !== key && k2 !== key) return;
            const oppPlayer = k1 === key ? p2 : p1;
            const oppKey = normalizeName(oppPlayer.name);
            if (!opponentsMap[oppKey]) opponentsMap[oppKey] = { name: oppPlayer.name, meetings: [] };
            if (pr.result.method === "double_retirement") {
              opponentsMap[oppKey].meetings.push({ date: t.date, tournamentName: shortTournamentLabel(t.name), winner: null, loser: null, method: "double_retirement" });
            } else {
              const w = data.players.find((p) => p.id === pr.result.winnerId);
              const l = data.players.find((p) => p.id === pr.result.loserId);
              if (!w || !l) return;
              opponentsMap[oppKey].meetings.push({ date: t.date, tournamentName: shortTournamentLabel(t.name), winner: w.name, loser: l.name, method: pr.result.method });
            }
          });
        });
      }

      // matches of the imported tournaments (Build 4B)
      importedMatches(scope, competition).forEach((m) => {
        if (m.p1Key !== key && m.p2Key !== key) return;
        const oppKey = m.p1Key === key ? m.p2Key : m.p1Key;
        const opp = oppKey ? registry.players[oppKey] : null;
        if (!opp) return;
        const winner = registry.players[m.winnerKey];
        const loser = registry.players[m.winnerKey === m.p1Key ? m.p2Key : m.p1Key];
        if (!opponentsMap[oppKey]) opponentsMap[oppKey] = { name: opp.name, meetings: [] };
        opponentsMap[oppKey].meetings.push({ date: m.date, tournamentName: shortTournamentLabel(m.tournamentName), winner: winner?.name, loser: loser?.name, method: m.method });
      });

      const rows = Object.values(opponentsMap).map((o) => {
        const meetings = [...o.meetings].sort((a, b) => new Date(a.date) - new Date(b.date));
        // A double retirement is listed but is not a game that anyone won or lost.
        const decided = meetings.filter((m) => m.method !== "double_retirement");
        const wins = decided.filter((m) => m.winner && normalizeName(m.winner) === key).length;
        const total = decided.length;
        const losses = total - wins;
        const pct = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
        return { name: o.name, meetings, total, wins, losses, pct };
      });
      rows.sort((a, b) => b.total - a.total);

      setH2hResult({ playerName, rows, scope });
    } catch (err) {
      showToast("Αποτυχία υπολογισμού — δοκίμασε ξανά.");
    } finally {
      setH2hLoading(false);
    }
  }

  /** Federation-wide statistics: longest win/loss streaks, tournament title
   * counts, and how many tournament-days each player has spent leading
   * Season Standings and ELO. Replays every saved tournament in chronological
   * order once; heavier than Head-to-Head, so it's triggered by a button
   * rather than running automatically. Retirements and byes are excluded
   * entirely from streaks (as if that match never happened), matching how
   * they're already excluded from ELO and win%. */
  /** Season-level overview: how many players/tournaments this season,
   * average turnout, how many players are brand new this year, roughly
   * how many individual matches were played, plus two highlights — the
   * biggest ELO upset and the player who gained the most rating — both
   * scoped to matches that happened within this season's own tournaments
   * (ELO itself stays continuous/all-time; only the "which matches count
   * as this season's highlights" question is scoped by year). */
  async function computeSeasonOverview(year) {
    setSeasonStatsLoading(true);
    setSeasonStatsResult(null);
    try {
      // "all": every season merged into one (each tournament belongs to one season).
      let season;
      if (year === "all") {
        season = { players: {} };
        for (const y of await listSeasonYears()) {
          const s = await loadSeason(y);
          Object.entries(s.players || {}).forEach(([k, p]) => {
            if (!season.players[k]) season.players[k] = { name: p.name, entries: {} };
            Object.assign(season.players[k].entries, p.entries || {});
          });
        }
      } else {
        season = await loadSeason(year);
      }
      const playerEntries = Object.entries(season.players || {}).filter(([, p]) => Object.keys(p.entries || {}).length > 0);
      const tournamentIdSet = new Set();
      const perTournamentCounts = {};
      playerEntries.forEach(([, p]) => {
        Object.keys(p.entries || {}).forEach((id) => {
          tournamentIdSet.add(id);
          perTournamentCounts[id] = (perTournamentCounts[id] || 0) + 1;
        });
      });
      const tournamentCount = tournamentIdSet.size;
      const playerCount = playerEntries.length;
      const avgParticipants = tournamentCount > 0
        ? Math.round((Object.values(perTournamentCounts).reduce((a, b) => a + b, 0) / tournamentCount) * 10) / 10
        : 0;
      let totalMatchInstances = 0;
      playerEntries.forEach(([, p]) => Object.values(p.entries || {}).forEach((e) => { totalMatchInstances += e.matches ?? 0; }));
      const totalMatches = Math.round(totalMatchInstances / 2);

      const allYears = await listSeasonYears();
      const priorKeys = new Set();
      for (const y of year === "all" ? [] : allYears.filter((y) => y < year)) {
        const s = await loadSeason(y);
        Object.entries(s.players || {}).forEach(([key, p]) => {
          if (Object.keys(p.entries || {}).length > 0) priorKeys.add(key);
        });
      }
      const newPlayers = year === "all" ? null : playerEntries.filter(([key]) => !priorKeys.has(key)).length;

      const seenIds = new Set();
      const chronological = [...archive]
        .filter((t) => { if (seenIds.has(t.id)) return false; seenIds.add(t.id); return true; })
        .filter(countsTowardRatings)
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      const eloRunning = { players: {} };
      const ratingAtSeasonStart = {};
      const ratingAtSeasonEnd = {};
      let biggestUpset = null;
      let totalNormalMatches = 0;
      let totalUpsets = 0;
      const perTournamentUpsets = {};
      for (const t of chronological) {
        const data = await fetchTournamentData(t.id);
        if (!data || !data.history) continue;
        const byId = {};
        (data.players || []).forEach((p) => { byId[p.id] = p; });
        const inSeason = tournamentIdSet.has(t.id);
        if (inSeason && !perTournamentUpsets[t.id]) perTournamentUpsets[t.id] = { name: t.name, matches: 0, upsets: 0 };
        data.history.forEach((entry) => {
          if (inSeason) {
            entry.pairs.forEach((pr) => {
              if (!pr.result || pr.result.method !== "normal") return;
              const w = byId[pr.result.winnerId];
              const l = byId[pr.result.loserId];
              if (!w || !l) return;
              const wKey = normalizeName(w.name);
              const lKey = normalizeName(l.name);
              if (ratingAtSeasonStart[wKey] === undefined) ratingAtSeasonStart[wKey] = eloRunning.players[wKey]?.rating ?? ELO_INITIAL;
              if (ratingAtSeasonStart[lKey] === undefined) ratingAtSeasonStart[lKey] = eloRunning.players[lKey]?.rating ?? ELO_INITIAL;
              const wRatingBefore = eloRunning.players[wKey]?.rating ?? ELO_INITIAL;
              const lRatingBefore = eloRunning.players[lKey]?.rating ?? ELO_INITIAL;
              totalNormalMatches += 1;
              perTournamentUpsets[t.id].matches += 1;
              if (wRatingBefore < lRatingBefore) {
                totalUpsets += 1;
                perTournamentUpsets[t.id].upsets += 1;
                const margin = Math.round(lRatingBefore - wRatingBefore);
                if (!biggestUpset || margin > biggestUpset.margin) {
                  biggestUpset = {
                    winner: w.name, loser: l.name, margin, date: t.date, tournamentName: t.name,
                    winnerRatingBefore: Math.round(wRatingBefore), loserRatingBefore: Math.round(lRatingBefore),
                  };
                }
              }
            });
          }
          applyEloRoundBatch(eloRunning, buildEloRoundMatches(entry.pairs, byId), data.matchLength || 7);
        });
        if (inSeason) {
          (data.players || []).forEach((p) => {
            const key = normalizeName(p.name);
            if (eloRunning.players[key]) ratingAtSeasonEnd[key] = eloRunning.players[key].rating;
          });
        }
      }

      let mostImproved = null;
      Object.keys(ratingAtSeasonEnd).forEach((key) => {
        const start = ratingAtSeasonStart[key];
        const end = ratingAtSeasonEnd[key];
        if (start === undefined) return;
        const delta = Math.round(end - start);
        if (!mostImproved || delta > mostImproved.delta) {
          mostImproved = { name: eloRunning.players[key]?.name || key, delta, startRating: Math.round(start), endRating: Math.round(end) };
        }
      });

      const upsetRate = totalNormalMatches > 0 ? Math.round((totalUpsets / totalNormalMatches) * 1000) / 10 : 0;
      let mostSurprisingTournament = null;
      Object.values(perTournamentUpsets).forEach((tt) => {
        if (tt.matches === 0) return;
        const rate = Math.round((tt.upsets / tt.matches) * 1000) / 10;
        if (!mostSurprisingTournament || rate > mostSurprisingTournament.rate) {
          mostSurprisingTournament = { name: tt.name, rate, upsets: tt.upsets, matches: tt.matches };
        }
      });

      setSeasonStatsResult({ year, scope: year, tournamentCount, playerCount, avgParticipants, newPlayers, totalMatches, biggestUpset, mostImproved, upsetRate, mostSurprisingTournament });
    } catch (err) {
      showToast("Αποτυχία υπολογισμού στατιστικών σεζόν — δοκίμασε ξανά.");
    } finally {
      setSeasonStatsLoading(false);
    }
  }

  async function computeStatistics(scope = statsScope, competition = statsCompetition) {
    setStatsLoading(true);
    setStatsResult(null);
    try {
      const seenIds = new Set();
      const chronological = [...archive]
        .filter((t) => { if (seenIds.has(t.id)) return false; seenIds.add(t.id); return true; })
        .filter((t) => t.isOfficial)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      const eloRunning = { players: {} };
      const seasonRunningByYear = {}; // each season runs on its own, with its own rules
      const perPlayerSequence = {};
      const titleCounts = {};
      const eloLeaderDays = {};
      const standingsLeaderDays = {};
      const attendance = {}; // key -> { name, current, max, currentStart, maxStart, maxEnd }

      for (const t of chronological) {
        const data = await fetchTournamentData(t.id);
        if (!data || !data.players) continue;
        const tPlayers = data.players;
        const byId = {};
        tPlayers.forEach((p) => { byId[p.id] = p; });
        // ELO is continuous: every counting tournament is replayed, but only
        // tournaments inside the chosen period add to streaks, titles and
        // leadership days.
        const feedsElo = countsTowardRatings(t);
        if (!tournamentInScope(t, scope) || (competition !== "all" && (t.competitionId || DEFAULT_COMPETITION_ID) !== competition)) {
          if (feedsElo && data.history) {
            data.history.forEach((entry) => applyEloRoundBatch(eloRunning, buildEloRoundMatches(entry.pairs, byId), data.matchLength || 7));
          }
          continue;
        }

        // Participation streak: every player ever seen gets bumped this
        // round — present (in tPlayers) extends their streak, absent
        // resets it to 0. Covers players who joined partway through too.
        const presentKeys = new Set(tPlayers.map((p) => normalizeName(p.name)));
        const allKnownKeys = new Set([...Object.keys(attendance), ...presentKeys]);
        allKnownKeys.forEach((key) => {
          const present = presentKeys.has(key);
          const name = present ? tPlayers.find((p) => normalizeName(p.name) === key).name : attendance[key]?.name;
          if (!attendance[key]) attendance[key] = { name, current: 0, max: 0, currentStart: null, maxStart: null, maxEnd: null };
          const a = attendance[key];
          a.name = name || a.name;
          if (present) {
            if (a.current === 0) a.currentStart = t.date;
            a.current += 1;
            if (a.current > a.max) { a.max = a.current; a.maxStart = a.currentStart; a.maxEnd = t.date; }
          } else {
            a.current = 0;
          }
        });

        // Tournament title — only for tournaments that have actually
        // finished; an in-progress test tournament has no real winner yet.
        if (data.phase === "finished") {
          const buch = computeBuchholz(tPlayers);
          const standings = sortStandings(tPlayers, buch);
          if (standings.length > 0) {
            const winner = standings[0];
            const key = normalizeName(winner.name);
            if (!titleCounts[key]) titleCounts[key] = { name: winner.name, count: 0, tournaments: [] };
            titleCounts[key].count += 1;
            titleCounts[key].tournaments.push({ name: t.name, date: t.date });
          }
        }

        // Per-player chronological sequence, normal matches only
        tPlayers.forEach((p) => {
          const key = normalizeName(p.name);
          if (!perPlayerSequence[key]) perPlayerSequence[key] = { name: p.name, seq: [] };
          (p.matchLog || []).forEach((m) => {
            if (m.method !== "normal") return;
            perPlayerSequence[key].seq.push({ date: t.date, tournamentName: t.name, result: m.result });
          });
        });

        // ELO running total + leader snapshot for this tournament
        if (data.history && feedsElo) {
          data.history.forEach((entry) => {
            applyEloRoundBatch(eloRunning, buildEloRoundMatches(entry.pairs, byId), data.matchLength || 7);
          });
        }
        const eloValues = Object.entries(eloRunning.players);
        if (eloValues.length > 0) {
          const [leaderKey] = eloValues.reduce((a, b) => (b[1].rating > a[1].rating ? b : a));
          eloLeaderDays[leaderKey] = (eloLeaderDays[leaderKey] || 0) + 1;
        }

        // Season Standings running total + leader snapshot
        const runYear = Number(t.seasonYear) || seasonForDate(t.date) || 2026;
        if (!seasonRunningByYear[runYear]) seasonRunningByYear[runYear] = { players: {} };
        const seasonRunning = seasonRunningByYear[runYear];
        tPlayers.forEach((p) => {
          const key = normalizeName(p.name);
          if (!seasonRunning.players[key]) seasonRunning.players[key] = { name: p.name, entries: {} };
          seasonRunning.players[key].name = p.name;
          const wins = p.matchLog.filter((m) => m.method === "normal" && m.result === "win").length;
          const matches = p.matchLog.filter((m) => m.method !== "bye" && m.method !== "retirement_win").length;
          const normalMatches = p.matchLog.filter((m) => m.method === "normal").length;
          seasonRunning.players[key].entries[t.id] = { points: p.wins, wins, matches, normalMatches };
        });
        const seasonStandingsNow = computeSeasonStandings(seasonRunning, rulesForSeason(sysState, runYear).bestOf);
        if (seasonStandingsNow.length > 0) {
          const leaderKey = normalizeName(seasonStandingsNow[0].name);
          standingsLeaderDays[leaderKey] = (standingsLeaderDays[leaderKey] || 0) + 1;
        }
      }

      // Streaks: every maximal run per player, then take the global top 3.
      const winStreaks = [];
      Object.values(perPlayerSequence).forEach(({ name, seq }) => {
        let i = 0;
        while (i < seq.length) {
          let j = i;
          while (j < seq.length && seq[j].result === seq[i].result) j++;
          if (seq[i].result === "win") winStreaks.push({ name, length: j - i, startDate: seq[i].date, endDate: seq[j - 1].date });
          i = j;
        }
      });
      winStreaks.sort((a, b) => b.length - a.length);

      const participationStreaks = Object.values(attendance)
        .filter((a) => a.max > 0)
        .map((a) => ({ name: a.name, length: a.max, startDate: a.maxStart, endDate: a.maxEnd }))
        .sort((a, b) => b.length - a.length);

      // titles won in imported tournaments (Build 4B)
      Object.values(importDocs).forEach((doc) => {
        if (!doc.personMap || !doc.placements || !doc.placements[0]) return;
        const date = importDateIso(doc.date) || doc.importedAt;
        if (!tournamentInScope({ date, seasonYear: importSeason(doc) }, scope)) return;
        if (competition !== "all" && importCompetitionId(doc) !== competition) return;
        const wKey = doc.personMap[doc.placements[0].name];
        const w = wKey ? registry.players[wKey] : null;
        if (!w) return;
        if (!titleCounts[wKey]) titleCounts[wKey] = { name: w.name, count: 0, tournaments: [] };
        titleCounts[wKey].count += 1;
        titleCounts[wKey].tournaments.push({ name: doc.name, date });
      });
      const titles = Object.values(titleCounts).sort((a, b) => b.count - a.count);
      const eloLeaders = Object.entries(eloLeaderDays)
        .map(([key, days]) => ({ name: eloRunning.players[key]?.name || key, days }))
        .sort((a, b) => b.days - a.days);
      const standingsLeaders = Object.entries(standingsLeaderDays)
        .map(([key, days]) => ({
          name: Object.values(seasonRunningByYear).map((sr) => sr.players[key]?.name).find(Boolean) || displayNameFor(key, key),
          days,
        }))
        .sort((a, b) => b.days - a.days);

      setStatsResult({ scope,
        topWinStreaks: winStreaks.slice(0, 3),
        topParticipationStreaks: participationStreaks.slice(0, 3),
        titles,
        eloLeaders,
        standingsLeaders,
      });
    } catch (err) {
      showToast("Αποτυχία υπολογισμού στατιστικών — δοκίμασε ξανά.");
    } finally {
      setStatsLoading(false);
    }
  }

  async function loadPlayerMatchStats(name) {
    const key = normalizeName(name);
    const myRating = eloData.players?.[key]?.rating ?? ELO_INITIAL;
    let vsStrongerW = 0, vsStrongerL = 0, vsWeakerW = 0, vsWeakerL = 0;
    for (const t of archive) {
      const data = await fetchTournamentData(t.id);
      if (!data || !data.players) continue;
      const me = data.players.find((p) => normalizeName(p.name) === key);
      if (!me || !me.matchLog) continue;
      me.matchLog.forEach((m) => {
        if (m.method === "bye" || !m.opponentId) return;
        const opp = data.players.find((p) => p.id === m.opponentId);
        if (!opp) return;
        const oppRating = eloData.players?.[normalizeName(opp.name)]?.rating ?? ELO_INITIAL;
        const isWin = m.result === "win";
        if (oppRating > myRating) {
          if (isWin) vsStrongerW += 1; else vsStrongerL += 1;
        } else {
          if (isWin) vsWeakerW += 1; else vsWeakerL += 1;
        }
      });
    }
    setPlayerMatchStatsCache((prev) => ({ ...prev, [key]: { vsStrongerW, vsStrongerL, vsWeakerW, vsWeakerL } }));
  }

  function openPlayerDetail(key) {
    setCardEloPool(null);
    setNotice("");
    setConfirmingDeletePlayer(null);
    setPlayerDetailTab(isAdmin ? "contact" : "stats");
    setExpandedRegistryPlayer(key);
    setPlayerDetailReturnPhase(phase);
    setPhase("playerDetail");
    if (!playerHistoryCache[key]) {
      loadPlayerTournamentHistory(registry.players[key].name);
    }
    if (!playerMatchStatsCache[key]) {
      loadPlayerMatchStats(registry.players[key].name);
    }
    if (eloTimeline === null && !eloTimelineLoading) {
      computeEloTimeline();
    }
  }
  // #endregion Στατιστικά & καρτέλα παίκτη

  // #region Ιστορική σεζόν 2026
  async function importHistoricalSeason2026(seasonAlreadyRead) {
    // Called at start-up with the season it has just read strictly.
    const season = seasonAlreadyRead || (await loadSeasonStrict(2026));
    const realDates = {
      1: "2025-09-27", 2: "2025-10-18", 3: "2025-11-08", 4: "2025-11-29",
      5: "2026-01-10", 6: "2026-02-14", 7: "2026-03-14", 8: "2026-03-28",
      9: "2026-04-25", 10: "2026-05-17", 11: "2026-06-13",
    };
    HISTORICAL_IMPORT_2026.forEach((player) => {
      const key = normalizeName(player.name);
      if (!season.players[key]) season.players[key] = { name: player.name, entries: {} };
      season.players[key].name = player.name;
      Object.entries(player.days).forEach(([dayNum, d]) => {
        const tournamentId = `hist-day${dayNum}`;
        const date = new Date(realDates[dayNum] + "T00:00:00Z").toISOString();
        season.players[key].entries[tournamentId] = {
          tournamentName: `Backgammon Premier League 2026 - Ημέρα ${dayNum}`,
          date,
          points: d.points,
          wins: d.wins,
          bye: d.bye,
          aa: d.aa,
          matches: d.matches,
          // This pre-aggregated historical source doesn't track retirement
          // losses separately, so this is an approximation (only excludes
          // A.A. wins, not retirement losses). Running "Recompute ELO &
          // Season Standings from scratch" replaces it with the exact
          // figure, derived from each day's real match log.
          normalMatches: Math.max(d.matches - (d.aa || 0), 0),
        };
      });
    });
    if (!(await saveSeason(2026, season))) reportSaveFailure("Σεζόν 2026 — ιστορική εισαγωγή");
    if (seasonBrowseYear === 2026) setSeasonData(season);
    setNotice(`Imported ${HISTORICAL_IMPORT_2026.length} players across 11 days into the 2026 season.`);
  }
  // #endregion Ιστορική σεζόν 2026

  /* ---------------------------------------------------------------------- */
  /* Derived data                                                           */
  /* ---------------------------------------------------------------------- */

  // #region Παράγωγες τιμές για τις οθόνες
  const buchholz = phase === "finished" ? computeBuchholz(players) : null;

  // Shared, visible "recompute" panel — used on both Season Standings and
  // ELO Ratings so admins actually notice it, instead of a small hidden
  // link at the very bottom of one page.
  const staleReasons = isAdmin ? describeStaleReasons(health) : [];
  const staleBlock =
    isAdmin && health && health.needsRecompute && staleReasons.length > 0 ? (
      <div className="notice" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--ink)" }}>
        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <p style={{ margin: "0 0 4px 0", fontWeight: 700 }}>Το αποθηκευμένο ELO / η Βαθμολογία ίσως δεν ταιριάζουν με τα τουρνουά</p>
          {staleReasons.map((r, i) => (
            <p key={i} style={{ margin: "0 0 2px 0" }}>• {r}</p>
          ))}
          <p style={{ margin: "6px 0 0 0" }}>Πάτα Recompute για να ξαναχτιστούν.</p>
        </div>
      </div>
    ) : null;
  const builtFrom = eloData?.builtFrom;
  const nationalElo = computeNationalElo();
  // keep module-level helpers (ELO counting) in step with the settings
  setRuntimeCompetitionState(sysState);
  // On the Season and ELO pages only the warning stays; the tools live in
  // the admin page ("Διαχείριση").
  const staleNotice = staleBlock ? (
    <div style={{ marginBottom: 16 }}>
      {staleBlock}
      <button className="btn-secondary" onClick={() => { setControlTab("data"); setPhase("control"); }}>Άνοιγμα Διαχείρισης για Recompute</button>
    </div>
  ) : null;

  const recomputePanel = isAdmin && (
    !confirmingRecompute ? (
      <>
      {staleBlock}
      <div className="recompute-panel">
        <div>
          <p style={{ fontWeight: 700, margin: "0 0 2px 0" }}>Χρειάζεσαι να ξαναχτίσεις τα δεδομένα;</p>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Ξαναϋπολογίζει την ELO και τη Βαθμολογία κάθε σεζόν από την αρχή, μόνο από επίσημα τουρνουά Premier League· κάθε τουρνουά πηγαίνει στη σεζόν του.</p>
          {builtFrom && (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0 0" }}>
              Τελευταίο Recompute: {formatDate(builtFrom.at)} — {builtFrom.tournaments} τουρνουά, {builtFrom.matches} αγώνες, {builtFrom.players} παίκτες.
              {builtFrom.seasons && (
                  <> Ανά σεζόν: {Object.entries(builtFrom.seasons).map(([y, v]) => `${sn(y)}: ${v.tournaments} τουρνουά, ${v.players} παίκτες`).join(" · ")}.</>
                )}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn-secondary" onClick={exportBaselineExcel}>
            <Download size={15} /> Εξαγωγή σε Excel
          </button>
          <button className="btn-secondary" onClick={runConsistencyCheck} disabled={consistencyLoading}>
            <Check size={15} /> {consistencyLoading ? "Έλεγχος…" : "Έλεγχος συνέπειας"}
          </button>
          <button className="btn-secondary" onClick={() => setConfirmingRecompute(true)}>
            <RotateCcw size={15} /> Recompute ELO &amp; Season Standings
          </button>
        </div>
      </div>
      {consistencyError && <p className="field-warning">{consistencyError}</p>}
      {consistencyReport && <ConsistencyReportView report={consistencyReport} onClose={() => setConsistencyReport(null)} />}
      </>
    ) : (
      <div className="delete-confirm">
        <span>Rebuild ELO and the Season Standings of every season from scratch (each tournament goes to its own season), using only tournaments marked "Official League day" — any test tournament is ignored automatically, whether or not you've deleted it. This can't be undone.</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-secondary" onClick={() => setConfirmingRecompute(false)}>Cancel</button>
          <button
            className="btn-primary"
            style={{ background: "var(--accent)" }}
            onClick={() => {
              recomputeEloAndSeasonFromScratch();
              setConfirmingRecompute(false);
            }}
          >
            Yes, recompute
          </button>
        </div>
      </div>
    )
  );
  const standings = sortStandings(players, buchholz);
  const byId = {};
  players.forEach((p) => (byId[p.id] = p));

  function getRoundData(r) {
    if (phase === "tournament" && r === round) {
      return currentPairings ? { pairs: currentPairings.pairs, bye: currentPairings.bye, editable: true } : null;
    }
    const h = history.find((entry) => entry.round === r);
    if (!h) return null;
    return { pairs: h.pairs, bye: h.bye, editable: false };
  }

  const availableRounds =
    phase === "finished"
      ? Array.from({ length: totalRounds }, (_, i) => i + 1)
      : Array.from({ length: round }, (_, i) => i + 1);

  const roundData = getRoundData(selectedRound);

  const filteredArchive = [...archive, ...importedCatalogue()]
    .filter((t) => (searchName ? t.name.toLowerCase().includes(searchName.toLowerCase()) : true))
    .filter((t) => (dateFrom ? new Date(t.date) >= new Date(dateFrom) : true))
    .filter((t) => (dateTo ? new Date(t.date) <= new Date(dateTo + "T23:59:59") : true))
    .filter((t) => (archiveSeason ? (Number(t.seasonYear) || seasonForDate(t.date)) === Number(archiveSeason) : true))
    .filter((t) => (archiveCompetition ? (t.competitionId || DEFAULT_COMPETITION_ID) === archiveCompetition : true))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const archiveHasFilter = searchName || dateFrom || dateTo || archiveSeason || archiveCompetition;
  const archiveSeasonOptions = [...new Set([...archive, ...importedCatalogue()].map((t) => Number(t.seasonYear) || seasonForDate(t.date)).filter(Boolean))].sort((a, b) => b - a);
  const visibleArchive = archiveHasFilter || showAllArchive ? filteredArchive : filteredArchive.slice(0, 10);
  // #endregion Παράγωγες τιμές για τις οθόνες

  // #region Βοηθητικά οθονών: ανάλυση ELO, λίστα ζευγαρωμάτων
  /** "How this rating was reached" for one player: summary line and the
   * per-match table. Used on the player card and on the ELO page. Needs the
   * ELO replay (computeEloTimeline) to have run. */
  function renderEloLedger(key, pool = "club") {
    if (pool === "club" && (!eloTimeline || !eloTimeline.__ledger)) {
      return <p style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0" }}>Υπολογισμός…</p>;
    }
    const rows = pool === "national" ? nationalElo.ledger[key] || [] : eloTimeline.__ledger[key] || [];
    const stored = pool === "national" ? nationalElo.elo.players?.[key]?.rating : eloData.players?.[key]?.rating;
    const final = rows.length ? rows[rows.length - 1].ratingAfter : ELO_INITIAL;
    const agrees = stored === undefined || Math.abs(stored - final) < 0.5;
    return (
      <>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0" }}>
          Αφετηρία {ELO_INITIAL}. {pool === "national" ? "Κάθε αγώνας των Τελικών Φάσεων (Κυπέλλου και Πρωταθλήματος) αλλάζει την ELO· οι φιλοξενούμενοι παίζουν πάντα με 1500." : "Κάθε αγώνας της Premier League αλλάζει την ELO"} ανάλογα με τη διαφορά δυναμικότητας και το μήκος του αγώνα· οι αγώνες ενός γύρου υπολογίζονται μαζί. Οι νίκες με Α.Α. δεν μετράνε.
          {" "}Τελική: <strong>{Math.round(final)}</strong>
          {agrees ? " ✓ ίδια με την κατάταξη." : ` ⚠ η αποθηκευμένη ELO είναι ${Math.round(stored)} — χρειάζεται Recompute.`}
        </p>
        <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
          <table className="cal-table ledger-table">
            <thead>
              <tr><th>Τουρνουά</th><th>Γύρος</th><th>Αντίπαλος (ELO)</th><th>Αποτ.</th><th>Μεταβολή</th><th>ELO</th></tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r, i) => (
                <tr key={i}>
                  <td>
                    <button className="history-link" onClick={() => (r.imported ? openImportPublic(r.tournamentId, { kind: "player", key }) : openTournamentFromPlayer(r.tournamentId, key))}>{r.imported ? r.tournamentName : shortTournamentLabel(r.tournamentName)}</button>
                    <span className="cal-note"> · {formatDate(r.date)}</span>
                  </td>
                  <td>{r.round}</td>
                  <td>{r.opponent} <span className="cal-note">({Math.round(r.opponentRating)})</span></td>
                  <td>{r.ret ? (r.result === "win" ? "Ν (Α.Α.)" : "Η (Α.Α.)") : r.result === "win" ? "Νίκη" : "Ήττα"}</td>
                  <td className={r.delta > 0 ? "pos" : r.delta < 0 ? "neg" : ""}>{r.ret ? "—" : `${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)}`}</td>
                  <td>{Math.round(r.ratingAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  /* ---- Pairings: list layout (same data and actions as the cards) ---- */

  /** Compact table of a round. Admin clicks the score to open the same
   * result actions the cards offer. `live` = tournament still running. */
  function renderPairingsList(live) {
    if (!roundData) return null;
    const rows = [];
    if (roundData.bye) {
      rows.push(
        <tr key="bye" className="pl-decided">
          <td className="cal-note">BYE</td>
          <td className="pl-name pl-win">{byId[roundData.bye]?.name}</td>
          <td className="pl-score">bye</td>
          <td className="pl-name cal-note">—</td>
        </tr>
      );
    }
    roundData.pairs.forEach((pr, i) => {
      const p1 = byId[pr.p1];
      const p2 = byId[pr.p2];
      if (!p1 || !p2) return;
      const result = pr.result;
      const isDoubleRet = result && result.method === "double_retirement";
      const ret = result && result.method === "retirement";
      const s1 = !result || isDoubleRet ? 0 : result.winnerId === p1.id ? matchLength : 0;
      const s2 = !result || isDoubleRet ? 0 : result.winnerId === p2.id ? matchLength : 0;
      const doSetResult = (winnerId, loserId, method) =>
        live && roundData.editable ? setResult(i, winnerId, loserId, method) : setHistoricalResult(selectedRound, i, winnerId, loserId, method);
      const doClearResult = () => (live && roundData.editable ? clearResult(i) : clearHistoricalResult(selectedRound, i));
      const open = isAdmin && expandedMatch === i;
      rows.push(
        <tr key={`m${i}`} className={result ? "pl-decided" : ""}>
          <td className="cal-note">M{i + 1}-{selectedRound}</td>
          <td className={`pl-name ${result && !isDoubleRet ? (result.winnerId === p1.id ? "pl-win" : "pl-lose") : isDoubleRet ? "pl-lose" : ""}`}>{p1.name}</td>
          <td className="pl-score">
            {isAdmin ? (
              <button className={`pl-score-btn ${open ? "active" : ""}`} onClick={() => setExpandedMatch(open ? null : i)} title="Καταχώρηση / αλλαγή αποτελέσματος">
                {result ? (isDoubleRet ? "Α.Α. – Α.Α." : `${s1} – ${s2}`) : "–  :  –"}
                <Pencil size={11} style={{ marginLeft: 6, opacity: 0.6 }} />
              </button>
            ) : result ? (
              isDoubleRet ? "Α.Α. – Α.Α." : `${s1} – ${s2}`
            ) : (
              <span className="cal-note">εκκρεμεί</span>
            )}
          </td>
          <td className={`pl-name ${result && !isDoubleRet ? (result.winnerId === p2.id ? "pl-win" : "pl-lose") : isDoubleRet ? "pl-lose" : ""}`}>
            {p2.name}
            {ret && <span className="cal-note"> · {byId[result.loserId]?.name} Α.Α.</span>}
          </td>
        </tr>
      );
      if (open) {
        rows.push(
          <tr key={`e${i}`} className="pl-edit">
            <td colSpan={4}>
              {!result ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button className="btn-secondary" onClick={() => { doSetResult(p1.id, p2.id, "normal"); setExpandedMatch(null); }}>Νίκη {p1.name}</button>
                  <button className="btn-secondary" onClick={() => { doSetResult(p2.id, p1.id, "normal"); setExpandedMatch(null); }}>Νίκη {p2.name}</button>
                  <button className="btn-ghost" onClick={() => { doSetResult(p2.id, p1.id, "retirement"); setExpandedMatch(null); }}><UserX size={13} /> {p1.name} Α.Α.</button>
                  <button className="btn-ghost" onClick={() => { doSetResult(p1.id, p2.id, "retirement"); setExpandedMatch(null); }}><UserX size={13} /> {p2.name} Α.Α.</button>
                  <button className="btn-ghost" style={{ color: "var(--muted)" }} onClick={() => { doSetResult(null, null, "double_retirement"); setExpandedMatch(null); }}><UserX size={13} /> Και οι δύο Α.Α.</button>
                  <button className="btn-ghost" onClick={() => setExpandedMatch(null)}>Κλείσιμο</button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13 }}>Για να αλλάξεις το αποτέλεσμα, αναίρεσέ το πρώτα.</span>
                  <button className="btn-secondary" onClick={doClearResult}>Αναίρεση αποτελέσματος</button>
                  <button className="btn-ghost" onClick={() => setExpandedMatch(null)}>Κλείσιμο</button>
                </div>
              )}
            </td>
          </tr>
        );
      }
    });
    return (
      <div style={{ overflowX: "auto" }}>
        <table className="cal-table pairings-list">
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  }

  function choosePairingsLayout(layout) {
    setPairingsLayout(layout);
    setExpandedMatch(null);
    try {
      localStorage.setItem("bgfed.pairingsLayout", layout);
    } catch {
      /* per-device convenience only */
    }
  }
  // #endregion Βοηθητικά οθονών: ανάλυση ELO, λίστα ζευγαρωμάτων

  /* ---- Imported tournaments (isolated preview) ---- */

  // #region Εισαγωγές & Πανελλήνια ELO
  async function loadImportsList() {
    try {
      const d = await fetchTournamentDataStrict(SYS_IMPORTS_ID);
      setImportsList(d && Array.isArray(d.list) ? d.list : []);
    } catch {
      setImportsList(null);
      showToast("Η λίστα εισαγωγών δεν διαβάστηκε — δοκίμασε ξανά.");
    }
  }

  function onImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let doc = null;
      try {
        doc = JSON.parse(String(reader.result));
      } catch {
        showToast("Το αρχείο δεν διαβάζεται (δεν είναι έγκυρο JSON).");
        return;
      }
      const { problems, summary } = validateImport(doc);
      const existing = (importsList || []).find((t) => doc && t.sourceUrl && t.sourceUrl === doc.sourceUrl);
      setImportView(null);
      setImportPreview({ doc, problems, summary, fileName: file.name, replaceId: existing ? existing.id : null });
    };
    reader.readAsText(file);
  }

  async function saveImportList(list) {
    if (await saveTournamentData(SYS_IMPORTS_ID, { list })) {
      setImportsList(list);
      return true;
    }
    reportSaveFailure("Εισαγωγές — η λίστα δεν αποθηκεύτηκε");
    return false;
  }

  async function confirmImport() {
    if (!importPreview || importPreview.problems.length > 0 || !importsList) return;
    setImportBusy(true);
    try {
      const { doc, summary, replaceId } = importPreview;
      const id = replaceId || `imp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const stored = { ...doc, importedAt: new Date().toISOString() };
      if (!(await saveTournamentData(id, stored))) {
        reportSaveFailure(`Εισαγωγή «${doc.name}» — δεν αποθηκεύτηκε`);
        return;
      }
      const entry = {
        id, name: doc.name, date: doc.date || "", dateEnd: doc.dateEnd || "", dateAssumed: !!doc.dateAssumed,
        competition: doc.competition || "", organiser: doc.organiser || "", sourceUrl: doc.sourceUrl || "",
        players: summary.players, matches: summary.matches, winner: summary.winner, importedAt: stored.importedAt,
      };
      const list = [...importsList.filter((t) => t.id !== id), entry];
      if (await saveImportList(list)) {
        setImportPreview(null);
        showToast(replaceId ? "Το τουρνουά αντικαταστάθηκε." : "Το τουρνουά εισήχθη.");
      refreshImports();
      }
    } finally {
      setImportBusy(false);
    }
  }

  async function openImport(id) {
    try {
      const doc = await fetchTournamentDataStrict(id);
      if (!doc) {
        showToast("Το τουρνουά δεν βρέθηκε.");
        return;
      }
      setImportPreview(null);
      setImportDateDraft(null);
      setImportConfirmDelete(false);
      setSourceLinkDraft(null);
      const b0 = doc.brackets && doc.brackets.length ? doc.brackets[0].id : "main";
      setImportView({ id, doc, tab: "standings", bracket: b0, round: Math.min(...(doc.matches || []).filter((m) => (m.bracket || "main") === b0).map((m) => m.round)) });
    } catch {
      showToast("Το τουρνουά δεν διαβάστηκε — δοκίμασε ξανά.");
    }
  }

  async function saveImportDates() {
    if (!importView || !importDateDraft || !importsList) return;
    const doc = { ...importView.doc, date: importDateDraft.date, dateEnd: importDateDraft.dateEnd, dateAssumed: !!importDateDraft.dateAssumed, seasonYear: Number(importDateDraft.seasonYear) || importSeason({ date: importDateDraft.date }) };
    if (!(await saveTournamentData(importView.id, doc))) {
      reportSaveFailure("Εισαγωγές — οι ημερομηνίες δεν αποθηκεύτηκαν");
      return;
    }
    const list = importsList.map((t) => (t.id === importView.id ? { ...t, date: doc.date, dateEnd: doc.dateEnd, dateAssumed: doc.dateAssumed } : t));
    if (await saveImportList(list)) {
      setImportView({ ...importView, doc });
      setImportDateDraft(null);
      showToast("Οι ημερομηνίες αποθηκεύτηκαν.");
      refreshImports();
    }
  }

  async function deleteImport() {
    if (!importView || !importsList) return;
    const list = importsList.filter((t) => t.id !== importView.id);
    if (!(await saveImportList(list))) return;
    await deleteTournamentData(importView.id);
    setImportView(null);
    setImportConfirmDelete(false);
    showToast("Το εισαγόμενο τουρνουά διαγράφηκε.");
      refreshImports();
  }

  function importDateLabel(t) {
    if (!t.date) return "χωρίς ημερομηνία";
    const f = (d) => { const [y, m, dd] = d.split("-"); return `${Number(dd)}/${Number(m)}/${y}`; };
    return `${f(t.date)}${t.dateEnd && t.dateEnd !== t.date ? ` – ${f(t.dateEnd)}` : ""}${t.dateAssumed ? " (εκτίμηση)" : ""}`;
  }

  /** Name in an imported tournament: the registry person when matched
   * (linked to their card, except guests), otherwise the source spelling. */
  function renderImportedName(doc, sourceName) {
    const key = doc.personMap ? doc.personMap[sourceName] : null;
    const person = key ? registry.players[key] : null;
    if (!person) return sourceName;
    if (person.guest) return <span>{person.name}<span className="cal-note"> · φιλοξ.</span></span>;
    return (
      <button className="history-link" onClick={() => openPlayerDetail(key)} title="Καρτέλα παίκτη">{formatNameForDisplay(person.name, nameDisplayMode)}</button>
    );
  }

  /* ---- Bracket tree (knock-out imports) ---- */

  /** Draws one bracket of a knock-out import as a tree. Where each player
   * comes from is derived from the matches themselves: their previous match
   * (won in this bracket = a line from that match; lost elsewhere = an entry
   * label such as «χαμένος 85»; none = their seat, e.g. «Ο1»). */
  function renderBracketTree(doc, bracketId) {
    const all = [...(doc.matches || [])].sort((a, b) => (a.slot ?? a.round) - (b.slot ?? b.round));
    const idx = new Map(all.map((m, i) => [m, i]));
    const prevOf = (m, name) => {
      for (let i = idx.get(m) - 1; i >= 0; i--) {
        const x = all[i];
        if (x.p1 === name || x.p2 === name) return x;
      }
      return null;
    };
    const inB = all.filter((m) => (m.bracket || "main") === bracketId);
    if (inB.length === 0) return null;
    const rounds = [...new Set(inB.map((m) => m.round))].sort((a, b) => a - b);
    const finalMatch = inB.filter((m) => m.round === rounds[rounds.length - 1]).slice(-1)[0];
    const short = (n) => {
      const key = doc.personMap ? doc.personMap[n] : null;
      const p = key ? registry.players[key] : null;
      return p ? p.name : n;
    };
    const COLW = 250;
    const BOXW = 205;
    const BOXH = 50;
    const ROWH = 62;
    const nodes = [];
    let leaf = 0;
    const visit = (m) => {
      const sides = [m.p1, m.p2].map((name) => {
        const pm = name ? prevOf(m, name) : null;
        if (pm && (pm.bracket || "main") === bracketId && pm.winner === name) return { name, child: pm };
        let tag = "";
        let title = "";
        if (pm) {
          tag = pm.winner === name ? `Ν${pm.match}` : `↓${pm.match}`;
          title = pm.winner === name ? `Νικητής αγώνα ${pm.match}` : `Χαμένος αγώνα ${pm.match}`;
        } else if (doc.seats && doc.seats[name]) {
          tag = doc.seats[name];
          title = `Θέση πίνακα ${doc.seats[name]}`;
        }
        return { name, tag, title };
      });
      const kids = sides.filter((sd) => sd.child).map((sd) => visit(sd.child));
      const y = kids.length === 0 ? leaf++ * ROWH : kids.reduce((a, k) => a + k.y, 0) / kids.length;
      const node = { m, sides, y, x: rounds.indexOf(m.round) * COLW, kids };
      nodes.push(node);
      return node;
    };
    visit(finalMatch);
    const height = Math.max(leaf, 1) * ROWH + 30;
    const width = rounds.length * COLW;
    const hl = importView?.highlight || null;
    const isHl = (n) => hl && n === hl;
    const scoreOf = (m, n) => {
      if (m.method === "retirement") return m.winner === n ? "" : "α.α.";
      const s = n === m.p1 ? m.score1 : m.score2;
      return s == null ? "" : `${s}${m.scoreRecorded === false ? "*" : ""}`;
    };
    return (
      <div className="bt-wrap">
        <div className="bt-canvas" style={{ width, height: height + 26 }}>
          {rounds.map((r, i) => (
            <div key={r} className="bt-col-head" style={{ left: i * COLW, width: BOXW }}>
              {(inB.find((m) => m.round === r && m.roundLabel) || {}).roundLabel || `Γύρος ${r}`}
            </div>
          ))}
          <svg className="bt-lines" width={width} height={height + 26}>
            {nodes.flatMap((nd) =>
              nd.kids.map((k, j) => {
                const x1 = k.x + BOXW;
                const y1 = k.y + 26 + BOXH / 2;
                const x2 = nd.x;
                const y2 = nd.y + 26 + BOXH / 2;
                const mx = (x1 + x2) / 2;
                const on = hl && (k.m.p1 === hl || k.m.p2 === hl) && (nd.m.p1 === hl || nd.m.p2 === hl);
                return <path key={`${nd.m.match}-${j}`} d={`M${x1},${y1} H${mx} V${y2} H${x2}`} className={on ? "on" : ""} />;
              })
            )}
          </svg>
          {nodes.map((nd) => (
            <div
              key={nd.m.match}
              className={`bt-box ${hl && (nd.m.p1 === hl || nd.m.p2 === hl) ? "hl" : ""}`}
              style={{ left: nd.x, top: nd.y + 26, width: BOXW, height: BOXH }}
              title={`Αγώνας ${nd.m.match}`}
            >
              {nd.sides.map((sd) => (
                <div
                  key={sd.name}
                  className={`bt-line ${nd.m.winner === sd.name ? "win" : ""} ${isHl(sd.name) ? "me" : ""}`}
                  onClick={() => setImportView({ ...importView, highlight: hl === sd.name ? null : sd.name })}
                >
                  {sd.tag && <span className="bt-tag" title={sd.title}>{sd.tag}</span>}
                  <span className="bt-name">{short(sd.name)}</span>
                  <span className="bt-score">{scoreOf(nd.m, sd.name)}</span>
                </div>
              ))}
              <span className="bt-no">{nd.m.match}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /** The organiser's original spreadsheet, as it was (read-only). Cells that
   * contain the highlighted player's surname are marked. */
  function renderSourceSheets(doc) {
    const sheets = sourceSheetsOf(doc);
    if (sheets.length === 0) return null;
    const si = Math.min(importView?.sheet || 0, sheets.length - 1);
    const sh = sheets[si];
    const bold = new Set((sh.bold || []).map(([r, c]) => `${r}:${c}`));
    const hl = importView?.highlight || null;
    const hlSur = hl ? stripAccents(sourceSurname(hl)).toUpperCase() : null;
    const colName = (i) => {
      let n = "";
      let x = i + 1;
      while (x > 0) {
        const m = (x - 1) % 26;
        n = String.fromCharCode(65 + m) + n;
        x = Math.floor((x - 1) / 26);
      }
      return n;
    };
    const download = () => {
      try {
        const f = doc.sourceFile;
        const bin = atob(f.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: f.mime || "application/octet-stream" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = f.name || "source.xlsx";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } catch {
        showToast("Η λήψη απέτυχε.");
      }
    };
    return (
      <>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <div className="tabs" style={{ margin: 0 }}>
            {sheets.map((x, i) => (
              <button key={x.name} className={`tab ${i === si ? "active" : ""}`} onClick={() => setImportView({ ...importView, sheet: i })}>{x.name}</button>
            ))}
          </div>
          {doc.sourceLink && (
            <a className="btn-secondary" href={doc.sourceLink} target="_blank" rel="noreferrer" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <LinkIcon size={14} /> Άνοιγμα σε νέα καρτέλα
            </a>
          )}
          {doc.sourceFile && (
            <button className="btn-secondary" onClick={download}><Download size={14} /> Λήψη αρχικού αρχείου</button>
          )}
        </div>
        <div className="xs-wrap">
          <table className="xs-table">
            <thead>
              <tr>
                <th className="xs-corner"></th>
                {(sh.widths || sh.rows[0].map(() => 9)).map((w, c) => (
                  <th key={c} style={{ minWidth: Math.max(28, Math.round(w * 7)) }}>{colName(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sh.rows.map((row, r) => (
                <tr key={r}>
                  <th>{r + 1}</th>
                  {row.map((v, c) => {
                    const mark = hlSur && v && stripAccents(v).toUpperCase().includes(hlSur);
                    return (
                      <td key={c} className={`${bold.has(`${r}:${c}`) ? "b" : ""} ${mark ? "mark" : ""}`}>{v}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  /** Admin: saves the public link of the original file (e.g. Google Drive). */
  async function saveSourceLink() {
    if (!importView || sourceLinkDraft === null) return;
    const link = sourceLinkDraft.trim();
    if (link && !/^https:\/\//i.test(link)) {
      showToast("Ο σύνδεσμος πρέπει να ξεκινά με https://");
      return;
    }
    let cur;
    try {
      cur = await fetchTournamentDataStrict(importView.id);
    } catch {
      cur = null;
    }
    if (!cur) {
      showToast("Το τουρνουά δεν διαβάστηκε — δοκίμασε ξανά.");
      return;
    }
    const next = { ...cur, sourceLink: link };
    if (await saveTournamentData(importView.id, next)) {
      setImportView({ ...importView, doc: next });
      setSourceLinkDraft(null);
      refreshImports();
      showToast(link ? "Ο σύνδεσμος αποθηκεύτηκε." : "Ο σύνδεσμος αφαιρέθηκε.");
    } else {
      reportSaveFailure("Εισαγωγές — ο σύνδεσμος του αρχικού αρχείου δεν αποθηκεύτηκε");
    }
  }

  /** Admin: attaches the organiser's original spreadsheet (a prepared
   * «bgfed-source/1» file) to an imported tournament, keeping everything else. */
  function onSourceFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !importView) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let src;
      try {
        src = JSON.parse(String(reader.result));
        if (src.format !== "bgfed-source/1" || !Array.isArray(src.sourceSheets)) throw new Error("format");
      } catch {
        showToast("Το αρχείο δεν είναι αρχείο πηγής (bgfed-source/1).");
        return;
      }
      let cur;
      try {
        cur = await fetchTournamentDataStrict(importView.id);
      } catch {
        cur = null;
      }
      if (!cur) {
        showToast("Το τουρνουά δεν διαβάστηκε — δοκίμασε ξανά.");
        return;
      }
      const { sourceSheets: _old, ...rest } = cur;
      const next = { ...rest, sourceSheetsJson: JSON.stringify(src.sourceSheets), ...(src.sourceFile ? { sourceFile: src.sourceFile } : {}) };
      if (await saveTournamentData(importView.id, next)) {
        setImportView({ ...importView, doc: next });
        refreshImports();
        showToast("Το αρχικό αρχείο προστέθηκε.");
      } else {
        reportSaveFailure("Εισαγωγές — το αρχικό αρχείο δεν αποθηκεύτηκε");
      }
    };
    reader.readAsText(file);
  }

  /** The body of an imported tournament (tabs: standings, rounds, details). */
  function renderImportBody(adminMode) {
    if (!importView) return null;
    const { doc, tab, round } = importView;
    const brackets = doc.brackets && doc.brackets.length ? doc.brackets : [{ id: "main", name: "" }];
    const bracket = importView.bracket || brackets[0].id;
    const inBracket = (doc.matches || []).filter((m) => (m.bracket || "main") === bracket);
    const rounds = [...new Set(inBracket.map((m) => m.round))].sort((a, b) => a - b);
    const roundLabelOf = (r) => (inBracket.find((m) => m.round === r && m.roundLabel) || {}).roundLabel || `Γύρος ${r}`;
    const roundMatches = inBracket.filter((m) => m.round === round);
    const scoreText = (m) => {
      if (m.method === "bye") return "bye";
      if (m.method === "retirement") return "α.α.";
      if (m.score1 == null || m.score2 == null) return "—";
      return `${m.score1} – ${m.score2}${m.scoreRecorded === false ? "*" : ""}`;
    };
    const hasSeats = !!doc.seats;
    return (
      <>
          <div className="tabs" style={{ marginBottom: 12 }}>
            {[["standings", "Κατάταξη"], ["rounds", "Γύροι"], ["info", "Στοιχεία"]].map(([k, v]) => (
              <button key={k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setImportView({ ...importView, tab: k })}>{v}</button>
            ))}
          </div>
          {tab === "standings" && (
            <div style={{ overflowX: "auto" }}>
              <table className="cal-table">
                <thead><tr><th>Θέση</th><th>Παίκτης</th>{hasSeats && <th title="Η θέση του πίνακα που κάλυψε ο παίκτης">Θέση πίνακα</th>}{adminMode && doc.personMap && <th>Στην πηγή</th>}<th>Νίκες</th><th>Ήττες</th><th>Αγώνες</th></tr></thead>
                <tbody>
                  {(doc.placements || []).map((p) => {
                    return (
                      <tr key={p.name}>
                        <td>{p.positionLabel || p.position}</td>
                        <td>{renderImportedName(doc, p.name)}</td>
                        {hasSeats && <td className="cal-note">{doc.seats[p.name] || ""}</td>}
                        {adminMode && doc.personMap && <td className="cal-note">{p.name}</td>}
                        <td>{p.wins}</td><td>{p.losses}</td><td>{p.matches}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="cal-note" style={{ marginTop: 6 }}>
                {doc.brackets && doc.brackets.length > 1
                  ? "Οι θέσεις είναι αυτές της διοργάνωσης· μετά την 4η, ανά γύρο αποκλεισμού. Η «Θέση πίνακα» (π.χ. Κ6) είναι η θέση του πίνακα που κάλυψε ο παίκτης — όχι απαραίτητα ο σύλλογός του."
                  : "Οι νίκες περιλαμβάνουν τα bye, όπως στην πηγή. Η σειρά είναι αυτή της πηγής."}
              </p>
            </div>
          )}
          {tab === "rounds" && (
            <>
              {brackets.length > 1 && importView.view !== "excel" && (
                <div className="tabs" style={{ marginBottom: 8 }}>
                  {brackets.map((b) => (
                    <button
                      key={b.id}
                      className={`tab ${bracket === b.id ? "active" : ""}`}
                      onClick={() => {
                        const rs = [...new Set((doc.matches || []).filter((m) => (m.bracket || "main") === b.id).map((m) => m.round))];
                        setImportView({ ...importView, bracket: b.id, round: Math.min(...rs) });
                      }}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              )}
              {(brackets.length > 1 || sourceSheetsOf(doc).length > 0) && (
                <div className="layout-toggle" role="group" aria-label="Εμφάνιση" style={{ marginBottom: 10 }}>
                  <button className={importView.view !== "tree" ? "active" : ""} onClick={() => setImportView({ ...importView, view: "list" })}>
                    <List size={14} /> Λίστα
                  </button>
                  {brackets.length > 1 && (
                    <button className={importView.view === "tree" ? "active" : ""} onClick={() => setImportView({ ...importView, view: "tree" })}>
                      <LayoutGrid size={14} /> Δέντρο
                    </button>
                  )}
                  {sourceSheetsOf(doc).length > 0 && (
                    <button className={importView.view === "excel" ? "active" : ""} onClick={() => setImportView({ ...importView, view: "excel" })}>
                      <FileSpreadsheet size={14} /> Excel
                    </button>
                  )}
                </div>
              )}
              {importView.view === "excel" && sourceSheetsOf(doc).length > 0 ? (
                <>
                  <p className="cal-note" style={{ margin: "0 0 8px 0" }}>
                    Το αρχικό αρχείο της διοργάνωσης, όπως ήταν. {importView.highlight ? `Σημειώνονται τα κελιά με «${sourceSurname(importView.highlight)}».` : "Διάλεξε έναν παίκτη στο Δέντρο για να σημειωθούν τα κελιά του."}
                  </p>
                  {renderSourceSheets(doc)}
                </>
              ) : importView.view === "tree" && brackets.length > 1 ? (
                <>
                  <p className="cal-note" style={{ margin: "0 0 8px 0" }}>
                    Πάτα ένα όνομα για να φωτιστεί η πορεία του. Ετικέτες: <strong>Ο1, Κ6…</strong> θέση πίνακα · <strong>↓85</strong> ήρθε ως χαμένος του αγώνα 85 · <strong>Ν123</strong> ήρθε ως νικητής του αγώνα 123.
                  </p>
                  {renderBracketTree(doc, bracket)}
                </>
              ) : (
              <>
              <div className="round-pills" style={{ marginBottom: 10 }}>
                {rounds.map((r) => (
                  <button key={r} className={`round-pill ${round === r ? "active" : ""}`} onClick={() => setImportView({ ...importView, round: r })}>{roundLabelOf(r)}</button>
                ))}
              </div>
              <table className="cal-table">
                <tbody>
                  {roundMatches.map((m) => (
                    <tr key={m.match}>
                      <td className="cal-note">{m.match}</td>
                      <td style={{ fontWeight: m.winner === m.p1 ? 700 : 400 }}>{renderImportedName(doc, m.p1)}</td>
                      <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>{scoreText(m)}</td>
                      <td style={{ fontWeight: m.winner === m.p2 ? 700 : 400 }}>{m.p2 ? renderImportedName(doc, m.p2) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </>
              )}
              {inBracket.some((m) => m.scoreRecorded === false && m.method !== "retirement") && (
                <p className="cal-note" style={{ marginTop: 6 }}>* Το σκορ δεν είχε καταγραφεί· είναι γνωστός μόνο ο νικητής.</p>
              )}
            </>
          )}
          {tab === "info" && (
            <>
              <dl className="details-list">
                <dt>Ημερομηνίες</dt><dd>{importDateLabel(doc)}{doc.venue ? ` · ${doc.venue}` : ""}</dd>
                <dt>Σεζόν</dt><dd>{importSeason(doc) || "—"}</dd>
                <dt>Διοργάνωση</dt><dd>{doc.competition || "—"}</dd>
                <dt>Διοργανωτής</dt><dd>{doc.organiser || "—"}</dd>
                <dt>Σύστημα</dt><dd>{doc.system || "—"}</dd>
                <dt>Μήκος αγώνα</dt><dd>{doc.matchLength ? `${doc.matchLength} πόντοι` : "—"}</dd>
                <dt>Παίκτες / αγώνες</dt><dd>{(doc.players || []).length} / {(doc.matches || []).filter((m) => m.method !== "bye").length}</dd>
                <dt>Πηγή</dt><dd>{doc.sourceUrl ? <a href={doc.sourceUrl} target="_blank" rel="noreferrer">{doc.sourceName || doc.sourceUrl}</a> : doc.sourceName || "—"}</dd>
                {doc.sourceLink && (<><dt>Αρχικό αρχείο</dt><dd><a href={doc.sourceLink} target="_blank" rel="noreferrer">Άνοιγμα σε νέα καρτέλα</a></dd></>)}
                <dt>Εισαγωγή</dt><dd>{doc.importedAt ? formatDate(doc.importedAt) : "—"}</dd>
              </dl>
              {adminMode && (importDateDraft ? (
                <div className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
                  <div style={{ width: 160 }}><label>Από</label><input type="date" value={importDateDraft.date} onChange={(e) => setImportDateDraft({ ...importDateDraft, date: e.target.value })} /></div>
                  <div style={{ width: 160 }}><label>Έως</label><input type="date" value={importDateDraft.dateEnd} onChange={(e) => setImportDateDraft({ ...importDateDraft, dateEnd: e.target.value })} /></div>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", paddingBottom: 10 }}>
                    <input type="checkbox" checked={!!importDateDraft.dateAssumed} onChange={(e) => setImportDateDraft({ ...importDateDraft, dateAssumed: e.target.checked })} /> εκτίμηση
                  </label>
                  <div style={{ width: 100 }}><label>Σεζόν</label><input type="number" value={importDateDraft.seasonYear} onChange={(e) => setImportDateDraft({ ...importDateDraft, seasonYear: e.target.value })} /></div>
                  <button className="btn-secondary" onClick={() => setImportDateDraft(null)}>Άκυρο</button>
                  <button className="btn-primary" onClick={saveImportDates} disabled={!importDateDraft.date}>Αποθήκευση</button>
                </div>
              ) : (
                <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => setImportDateDraft({ date: doc.date || "", dateEnd: doc.dateEnd || "", dateAssumed: !!doc.dateAssumed, seasonYear: importSeason(doc) || "" })}>
                  <Pencil size={14} /> Αλλαγή ημερομηνιών και σεζόν
                </button>
              ))}
              {adminMode && (
                <div className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
                  <div className="field">
                    <label>Σύνδεσμος αρχικού αρχείου (π.χ. Google Drive)</label>
                    <input type="text" value={sourceLinkDraft ?? (doc.sourceLink || "")} onChange={(e) => setSourceLinkDraft(e.target.value)} placeholder="https://drive.google.com/…" />
                  </div>
                  <button className="btn-secondary" onClick={saveSourceLink} disabled={sourceLinkDraft === null || sourceLinkDraft.trim() === (doc.sourceLink || "")}>
                    <Save size={14} /> Αποθήκευση
                  </button>
                </div>
              )}
              {adminMode && (
                <div style={{ marginTop: 12 }}>
                  <button className="btn-secondary" onClick={() => sourceFileRef.current?.click()}>
                    <FileSpreadsheet size={14} /> {sourceSheetsOf(doc).length ? "Αντικατάσταση αρχικού αρχείου" : "Προσθήκη αρχικού αρχείου (.json)"}
                  </button>
                  <input type="file" accept="application/json,.json" ref={sourceFileRef} onChange={onSourceFile} style={{ display: "none" }} />
                </div>
              )}
              {adminMode && <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                {!importConfirmDelete ? (
                  <button className="btn-ghost" onClick={() => setImportConfirmDelete(true)}><Trash2 size={14} /> Διαγραφή εισαγωγής</button>
                ) : (
                  <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 14 }}>
                    Οριστική διαγραφή του «{doc.name}»; (Δεν επηρεάζει τίποτα άλλο.)
                    <button className="btn-ghost" onClick={() => setImportConfirmDelete(false)}>Άκυρο</button>
                    <button className="btn-secondary" onClick={deleteImport}>Ναι, διαγραφή</button>
                  </span>
                )}
              </div>}
            </>
          )}
      </>
    );
  }

  function renderImportsTab() {
    if (importView) {
      const { doc } = importView;
      return (
        <div className="card control-section">
          <button className="btn-ghost" onClick={() => setImportView(null)} style={{ marginBottom: 8 }}>
            <ArrowLeft size={14} /> Πίσω στις εισαγωγές
          </button>
          <h2 className="control-h">{doc.name}</h2>
          <p className="control-sub">
            {importDateLabel(doc)} · {competitionName(competitionsFrom(sysState), importCompetitionId(doc))} · Εισαγόμενο από {doc.sourceName || "εξωτερική πηγή"}
          </p>
          {renderImportBody(true)}
        </div>
      );
    }

    return (
      <div className="card control-section">
        <h2 className="control-h">Εισαγωγές (δοκιμαστικά)</h2>
        <p className="control-sub">
          Τουρνουά που έγιναν εκτός εφαρμογής (π.χ. DrawBoss), μόνο για προβολή. Είναι εντελώς απομονωμένα: δεν μπαίνουν στον κατάλογο τουρνουά και δεν μετράνε σε Βαθμολογία, ELO, Στατιστικά ή μητρώο παικτών. Φαίνονται μόνο εδώ.
        </p>
        {importsList === null ? (
          <button className="btn-secondary" onClick={loadImportsList}>Φόρτωση</button>
        ) : importsList.length === 0 ? (
          <p style={{ fontSize: 14 }}>Δεν υπάρχουν εισαγόμενα τουρνουά.</p>
        ) : (
          <table className="cal-table">
            <thead><tr><th>Τουρνουά</th><th>Ημερομηνίες</th><th>Παίκτες</th><th>Αγώνες</th><th>Νικητής</th></tr></thead>
            <tbody>
              {[...importsList].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((t) => (
                <tr key={t.id}>
                  <td><button className="history-link" onClick={() => openImport(t.id)}>{t.name}</button></td>
                  <td>{importDateLabel(t)}</td>
                  <td>{t.players}</td>
                  <td>{t.matches}</td>
                  <td>{t.winner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {importsList !== null && !importPreview && (
          <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => importFileRef.current?.click()}>
            <Upload size={15} /> Εισαγωγή αρχείου (.json)
          </button>
        )}
        <input type="file" accept="application/json,.json" ref={importFileRef} onChange={onImportFile} style={{ display: "none" }} />
        {importsList && importsList.length > 0 && !importPreview && renderMatchingCard()}
        {importPreview && (
          <div className="control-sub-card">
            <strong>Προεπισκόπηση: {importPreview.doc?.name || importPreview.fileName}</strong>
            {importPreview.summary && (
              <p style={{ fontSize: 14, margin: "6px 0" }}>
                {importDateLabel(importPreview.doc)} · {importPreview.summary.players} παίκτες · {importPreview.summary.matches} αγώνες + {importPreview.summary.byes} bye · {importPreview.summary.rounds} γύροι · Νικητής: <strong>{importPreview.summary.winner}</strong>
              </p>
            )}
            {importPreview.problems.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--win)", margin: "0 0 8px 0" }}>✓ Οι έλεγχοι πέρασαν: κανείς δεν παίζει δύο φορές στον ίδιο γύρο, και οι νίκες κάθε παίκτη συμφωνούν με την κατάταξη της πηγής.</p>
            ) : (
              <div className="field-warning">
                ⚠ Το αρχείο έχει προβλήματα και δεν μπορεί να εισαχθεί:
                <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>{importPreview.problems.slice(0, 12).map((p, i) => <li key={i}>{p}</li>)}</ul>
              </div>
            )}
            {importPreview.replaceId && <p className="field-warning">Το ίδιο τουρνουά (ίδιο link πηγής) υπάρχει ήδη· η εισαγωγή θα το αντικαταστήσει.</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn-secondary" onClick={() => setImportPreview(null)}>Άκυρο</button>
              <button className="btn-primary" onClick={confirmImport} disabled={importBusy || importPreview.problems.length > 0}>
                {importBusy ? "Αποθήκευση…" : importPreview.replaceId ? "Αντικατάσταση" : "Εισαγωγή"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ---- Build 4C: national ELO ---- */

  /** The national ELO, computed from the imported tournaments of national
   * competitions (owner club marked as organiser, e.g. «Πανελλήνιες
   * Διοργανώσεις»). Everyone starts at 1500; guests play every match at a
   * fixed 1500 and keep no rating of their own; walkovers do not count.
   * Same formula as the federation ELO. Recomputed whenever the imports or
   * the registry change — no stored copy to drift. */
  function computeNationalElo() {
    const elo = { players: {} };
    const timeline = {};
    const ledger = {};
    const clubs = clubsFrom(sysState);
    const isNational = (doc) => {
      const c = competitionById(importCompetitionId(doc));
      if (!c || c.countsElo === false) return false;
      if (c.ownerClubId) {
        const owner = clubs.find((x) => x.id === c.ownerClubId);
        return !!(owner && owner.organiserOnly);
      }
      return eloPoolOf(c.id) === "national";
    };
    const docs = Object.entries(importDocs)
      .filter(([, d]) => d.personMap && isNational(d))
      .map(([id, d]) => ({ id, d, date: importDateIso(d.date) || d.importedAt }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    docs.forEach(({ id, d, date }) => {
      const participants = new Set();
      const groups = new Map(); // "slot|length" -> matches, in play order
      [...(d.matches || [])]
        .filter((m) => m.method !== "bye" && m.p2)
        .sort((a, b) => (a.slot ?? a.round) - (b.slot ?? b.round))
        .forEach((m) => {
          const g = `${m.slot ?? m.round}|${m.matchLength || d.matchLength || 7}`;
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g).push(m);
        });
      groups.forEach((ms, g) => {
        const ml = Number(g.split("|")[1]);
        const batch = [];
        const pending = [];
        ms.forEach((m) => {
          const wKey = d.personMap[m.winner];
          const lKey = d.personMap[m.winner === m.p1 ? m.p2 : m.p1];
          const W = wKey && registry.players[wKey];
          const Lp = lKey && registry.players[lKey];
          if (!W || !Lp) return;
          // guests play every match at a fresh 1500
          [[wKey, W], [lKey, Lp]].forEach(([k, p]) => { if (p.guest) delete elo.players[k]; });
          const wR = elo.players[wKey]?.rating ?? ELO_INITIAL;
          const lR = elo.players[lKey]?.rating ?? ELO_INITIAL;
          const ret = m.method === "retirement";
          const delta = ret ? 0 : (1 - eloWinProbability(wR, lR, ml)) * eloPointsAtStake(ml);
          const base = { date, tournamentId: id, tournamentName: d.name, round: m.roundLabel || m.round, matchLength: ml, ret, imported: true };
          pending.push([wKey, W, { ...base, opponent: Lp.name + (Lp.guest ? " (φιλοξ.)" : ""), opponentRating: lR, result: "win", delta }]);
          pending.push([lKey, Lp, { ...base, opponent: W.name + (W.guest ? " (φιλοξ.)" : ""), opponentRating: wR, result: "loss", delta: -delta }]);
          batch.push({ w: W.name, l: Lp.name, ret });
        });
        applyEloRoundBatch(elo, batch, ml);
        pending.forEach(([k, p, row]) => {
          if (p.guest) return;
          participants.add(k);
          if (!ledger[k]) ledger[k] = [];
          ledger[k].push({ ...row, ratingAfter: elo.players[k]?.rating ?? ELO_INITIAL });
        });
        // guests keep nothing
        pending.forEach(([k, p]) => { if (p.guest) delete elo.players[k]; });
      });
      participants.forEach((k) => {
        const p = elo.players[k];
        if (!p) return;
        if (!timeline[k]) timeline[k] = [];
        timeline[k].push({ date, rating: p.rating, winRate: p.games > 0 ? ((p.wins || 0) / p.games) * 100 : 0 });
      });
    });
    return { elo, timeline, ledger, tournaments: docs.length };
  }

  /* ---- Build 4B: imported tournaments in public view ---- */

  /** Loads the imported tournaments for everyone (read-only use). */
  async function refreshImports() {
    const d = await fetchTournamentData(SYS_IMPORTS_ID);
    const list = d && Array.isArray(d.list) ? d.list : [];
    const docs = {};
    for (const t of list) {
      const doc = await fetchTournamentData(t.id);
      if (doc) docs[t.id] = doc;
    }
    setImportDocs(docs);
    if (isAdmin) setImportsList(list);
  }

  /** Imported tournaments as rows of the tournaments list. */
  function importedCatalogue() {
    return Object.entries(importDocs).map(([id, doc]) => {
      const date = importDateIso(doc.date) || doc.importedAt;
      return {
        id, name: doc.name, date, status: "Completed", isOfficial: true, imported: true,
        competitionId: importCompetitionId(doc), seasonYear: importSeason(doc),
      };
    });
  }

  function openImportPublic(id, back) {
    const doc = importDocs[id];
    if (!doc) return;
    setImportReturn(back || { kind: "archive" });
    const b0 = doc.brackets && doc.brackets.length ? doc.brackets[0].id : "main";
    setImportView({ id, doc, tab: "standings", bracket: b0, round: Math.min(...(doc.matches || []).filter((m) => (m.bracket || "main") === b0).map((m) => m.round)) });
    setPhase("imported");
  }

  function backFromImport() {
    const r = importReturn;
    setImportView(null);
    if (r && r.kind === "player" && registry.players[r.key]) {
      setExpandedRegistryPlayer(r.key);
      setPlayerDetailTab("stats");
      setPhase("playerDetail");
    } else {
      setPhase("archive");
    }
  }

  /** Matches of the imported tournaments in the chosen period/competition,
   * as { date, tournamentName, p1Key, p2Key, winnerKey, method }. */
  function importedMatches(scope, competition) {
    const out = [];
    Object.values(importDocs).forEach((doc) => {
      if (!doc.personMap) return;
      const date = importDateIso(doc.date) || doc.importedAt;
      const t = { date, seasonYear: importSeason(doc) };
      if (!tournamentInScope(t, scope)) return;
      if (competition !== "all" && importCompetitionId(doc) !== competition) return;
      (doc.matches || []).forEach((m) => {
        if (m.method === "bye" || !m.p2) return;
        out.push({ date, tournamentName: doc.name, p1Key: doc.personMap[m.p1], p2Key: doc.personMap[m.p2], winnerKey: doc.personMap[m.winner], method: m.method });
      });
    });
    return out;
  }
  // #endregion Εισαγωγές & Πανελλήνια ELO

  /* ---- Build 4A: matching imported names to persons ---- */

  // #region Εισαγωγές: αντιστοίχιση παικτών
  /** Builds the matching table for every imported tournament not matched yet.
   * `decisions` (optional) is a prepared file: rows of { names, action,
   * person | name, club, guest }. Changes nothing. */
  async function buildMatchPlan(decisions) {
    setMatchBusy(true);
    try {
      const list = importsList || [];
      const imports = [];
      for (const t of list) {
        let d;
        try {
          d = await fetchTournamentDataStrict(t.id);
        } catch {
          showToast("Κάποιο εισαγόμενο τουρνουά δεν διαβάστηκε — δοκίμασε ξανά.");
          return;
        }
        if (d && !d.personMap) imports.push({ id: t.id, name: d.name, doc: d });
      }
      if (imports.length === 0) {
        showToast("Όλα τα εισαγόμενα τουρνουά έχουν ήδη αντιστοιχιστεί.");
        return;
      }
      // every source name with where it appears
      const occ = {};
      imports.forEach((imp) => {
        const pos = Object.fromEntries((imp.doc.placements || []).map((p) => [p.name, p.position]));
        (imp.doc.players || []).forEach((n) => {
          occ[n] = occ[n] || [];
          occ[n].push({ importId: imp.id, importName: imp.name, position: pos[n] });
        });
      });
      const persons = Object.entries(registry.players);
      const byName = (nm) => persons.find(([, p]) => p.name.trim().toLowerCase() === String(nm || "").trim().toLowerCase());
      const clubByName = (nm) => {
        if (!nm) return null;
        const k = normClubKey(nm);
        return clubsFrom(sysState).find((c) => !c.organiserOnly && (normClubKey(c.name) === k || (c.aliases || []).some((a) => normClubKey(a) === k))) || null;
      };
      const rows = [];
      const taken = new Set();
      // 1. groups from the prepared decisions
      (decisions?.rows || []).forEach((r) => {
        const names = (r.names || []).filter((n) => occ[n] && !taken.has(n));
        if (names.length === 0) return;
        names.forEach((n) => taken.add(n));
        let choice = null;
        let note = "";
        if (r.action === "existing") {
          const hit = byName(r.person);
          if (hit) choice = { type: "existing", key: hit[0], ...(r.rename ? { rename: r.rename } : {}) };
          else note = `Το πρόσωπο «${r.person}» δεν βρέθηκε στο μητρώο — διάλεξε.`;
        } else if (r.action === "new") {
          const club = clubByName(r.club);
          choice = { type: "new", name: r.name || titleCaseName(names[0]), clubId: club ? club.id : null, guest: !!r.guest };
          if (r.club && !club && !r.guest) note = `Ο σύλλογος «${r.club}» δεν υπάρχει στη λίστα.`;
        }
        rows.push({ names, level: "Από το αρχείο αποφάσεων", choice, note });
      });
      // 2. the rest, grouped by skeleton across imports
      Object.keys(occ).filter((n) => !taken.has(n)).forEach((n) => {
        const sk = nameSkeletons(sourceSurname(n));
        const g = rows.find((r) => r.auto && r.names.every((m) => !occ[m].some((o) => occ[n].some((p) => p.importId === o.importId))) && [...nameSkeletons(sourceSurname(r.names[0]))].some((x) => sk.has(x)));
        if (g) g.names.push(n);
        else rows.push({ names: [n], auto: true });
        taken.add(n);
      });
      rows.filter((r) => r.auto).forEach((r) => {
        const known = persons.filter(([, p]) => (p.extNames || []).some((x) => r.names.includes(x)));
        if (known.length === 1) {
          r.level = "Γνωστή γραφή";
          r.choice = { type: "existing", key: known[0][0] };
          return;
        }
        const sks = new Set(r.names.flatMap((n) => [...nameSkeletons(sourceSurname(n))]));
        const exact = persons.filter(([, p]) => [...nameSkeletons(sourceSurname(p.name))].some((x) => sks.has(x)));
        if (exact.length === 1) {
          r.level = "Βέβαιο";
          r.choice = { type: "existing", key: exact[0][0] };
        } else if (exact.length > 1) {
          r.level = "Αμφίσημο";
          r.candidates = exact.map(([k]) => k);
        } else {
          const close = persons.filter(([, p]) => skeletonsMinDistance(sks, nameSkeletons(sourceSurname(p.name))) <= 1 && sourceSurname(r.names[0]).length >= 5);
          if (close.length) {
            r.level = "Πιθανό";
            r.candidates = close.map(([k]) => k);
          } else {
            r.level = "Νέο πρόσωπο";
            r.choice = { type: "new", name: titleCaseName(r.names[0]), clubId: null, guest: false };
          }
        }
      });
      rows.forEach((r) => { r.occ = r.names.flatMap((n) => occ[n].map((o) => ({ ...o, name: n }))); });
      const order = { "Αμφίσημο": 0, "Πιθανό": 1, "Από το αρχείο αποφάσεων": 2, "Γνωστή γραφή": 3, "Βέβαιο": 4, "Νέο πρόσωπο": 5 };
      rows.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9) || a.names[0].localeCompare(b.names[0]));
      setMatchPlan({ rows, imports: imports.map((i) => ({ id: i.id, name: i.name })) });
    } finally {
      setMatchBusy(false);
    }
  }

  function onMatchFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const doc = JSON.parse(String(reader.result));
        if (doc.format !== "bgfed-matching/1") throw new Error("format");
        buildMatchPlan(doc);
      } catch {
        showToast("Το αρχείο αποφάσεων δεν διαβάζεται (bgfed-matching/1).");
      }
    };
    reader.readAsText(file);
  }

  function setMatchChoice(i, choice) {
    setMatchPlan((mp) => ({ ...mp, rows: mp.rows.map((r, j) => (j === i ? { ...r, choice } : r)) }));
  }

  /** Problems that block applying the plan. */
  function matchPlanProblems(mp) {
    const out = [];
    mp.rows.forEach((r) => {
      if (!r.choice) out.push(`«${r.names.join(" / ")}»: δεν έχει γίνει επιλογή.`);
      else if (r.choice.type === "new" && !String(r.choice.name || "").trim()) out.push(`«${r.names.join(" / ")}»: το νέο πρόσωπο χρειάζεται όνομα.`);
    });
    // the same person twice in one tournament is impossible
    const seen = {};
    mp.rows.forEach((r) => {
      if (r.choice?.type !== "existing") return;
      r.occ.forEach((o) => {
        const k = `${o.importId}|${r.choice.key}`;
        if (seen[k] && seen[k] !== r) out.push(`${registry.players[r.choice.key]?.name}: αντιστοιχίζεται σε δύο διαφορετικά ονόματα του «${o.importName}».`);
        seen[k] = r;
      });
    });
    // a new person's name must not belong to someone else already
    const spellings = new Map();
    Object.entries(registry.players).forEach(([k, p]) => personSpellings(p).forEach((sp) => spellings.set(sp, k)));
    const newNames = new Set();
    mp.rows.forEach((r) => {
      if (r.choice?.type !== "new") return;
      const b = baseName(r.choice.name || "");
      if (mp.rows.some((o) => o.choice?.type === "existing" && o.choice.rename && baseName(o.choice.rename) === b)) out.push(`Το όνομα «${r.choice.name}» δίνεται και ως νέο όνομα σε υπάρχον πρόσωπο.`);
      if (spellings.has(b)) out.push(`Το όνομα «${r.choice.name}» υπάρχει ήδη στο μητρώο (${registry.players[spellings.get(b)]?.name}) — διάλεξε «Ίδιο με» ή άλλαξε το όνομα.`);
      if (newNames.has(b)) out.push(`Δύο νέα πρόσωπα με το ίδιο όνομα «${r.choice.name}».`);
      newNames.add(b);
    });
    return [...new Set(out)];
  }

  async function applyMatchPlan() {
    if (!matchPlan || matchBusy) return;
    const problems = matchPlanProblems(matchPlan);
    if (problems.length) {
      showToast("Υπάρχουν εκκρεμότητες στην αντιστοίχιση.");
      return;
    }
    const last = sysState.lastExportAt ? new Date(sysState.lastExportAt).getTime() : 0;
    if (Date.now() - last > 24 * 3600 * 1000) {
      showToast("Κάνε πρώτα Export All Data (των τελευταίων 24 ωρών).");
      return;
    }
    setMatchBusy(true);
    try {
      const players = { ...registry.players };
      let topNo = nextRegNo(registry) - 1;
      const created = [];
      const renamed = {}; // key -> previous name
      const linked = {}; // key -> names added to extNames
      const keyOfName = {};
      matchPlan.rows.forEach((r) => {
        let key;
        if (r.choice.type === "existing") {
          key = r.choice.key;
          const p = players[key];
          players[key] = { ...p, extNames: [...new Set([...(p.extNames || []), ...r.names])] };
          if (r.choice.rename && r.choice.rename.trim() && r.choice.rename.trim() !== p.name) {
            // enrich the name (e.g. a first name learned from this tournament); the old spelling stays as an alias
            const nn = r.choice.rename.trim();
            players[key] = { ...players[key], name: nn, aliases: [...new Set([...personSpellings(p), baseName(nn)])] };
            renamed[key] = p.name;
          }
          linked[key] = [...new Set([...(linked[key] || []), ...r.names])];
        } else {
          key = registry.identityVersion === 2 ? newPersonId(players) : normalizeName(r.choice.name);
          const name = r.choice.name.trim();
          const club = r.choice.clubId ? clubsFrom(sysState).find((c) => c.id === r.choice.clubId) : null;
          players[key] = {
            name,
            ...(registry.identityVersion === 2 ? { aliases: [baseName(name)] } : {}),
            club: club ? club.name : "",
            clubId: club ? club.id : null,
            email: "", phone: "", membership: [], needsInfo: false, hasDiscount: false, discountAmount: 32,
            guest: !!r.choice.guest,
            ...(registry.regNoVersion === 1 && !r.choice.guest ? { regNo: ++topNo } : {}),
            extNames: [...r.names],
            createdByImport: true,
          };
          created.push(key);
        }
        r.names.forEach((n) => { keyOfName[n] = key; });
      });
      const nextRegistry = { ...registry, players, ...(registry.regNoVersion === 1 ? { regNoMax: Math.max(registry.regNoMax || 0, topNo) } : {}) };
      if (!(await saveRegistryChecked(nextRegistry))) return;
      setPersonLookup(nextRegistry);
      setRegistry(nextRegistry);
      for (const imp of matchPlan.imports) {
        let d;
        try {
          d = await fetchTournamentDataStrict(imp.id);
        } catch {
          d = null;
        }
        if (!d) {
          reportSaveFailure(`Αντιστοίχιση — το «${imp.name}» δεν διαβάστηκε· τα πρόσωπα δημιουργήθηκαν, ξανάνοιξε την αντιστοίχιση για να συνδεθεί`);
          return;
        }
        const personMap = Object.fromEntries((d.players || []).map((n) => [n, keyOfName[n]]).filter(([, k]) => k));
        if (!(await saveTournamentData(imp.id, { ...d, personMap }))) {
          reportSaveFailure(`Αντιστοίχιση — το «${imp.name}» δεν αποθηκεύτηκε`);
          return;
        }
      }
      const record = { at: new Date().toISOString(), created, linked, renamed, imports: matchPlan.imports.map((i) => i.id) };
      const patch = { importMatching: [...(sysState.importMatching || []), record] };
      if (await saveSysState(patch)) setSysState((st) => ({ ...st, ...patch }));
      else reportSaveFailure("Αντιστοίχιση — ολοκληρώθηκε, αλλά δεν καταγράφηκε (η αναίρεση δεν θα είναι διαθέσιμη)");
      setMatchPlan(null);
      showToast(`Αντιστοίχιση: ${created.length} νέα πρόσωπα, ${Object.keys(linked).length} υπάρχοντα.`);
      refreshImports();
    } finally {
      setMatchBusy(false);
    }
  }

  /** Undo of the last matching: removes the persons it created (unless they
   * have played in one of our tournaments since) and unlinks the imports. */
  async function undoLastMatching() {
    const all = sysState.importMatching || [];
    const rec = all[all.length - 1];
    if (!rec || matchBusy) return;
    setMatchBusy(true);
    try {
      const players = { ...registry.players };
      const kept = [];
      rec.created.forEach((k) => {
        if (eloData.players?.[k]) kept.push(players[k]?.name || k);
        else delete players[k];
      });
      Object.entries(rec.linked || {}).forEach(([k, names]) => {
        if (players[k]) players[k] = { ...players[k], extNames: (players[k].extNames || []).filter((n) => !names.includes(n)) };
      });
      Object.entries(rec.renamed || {}).forEach(([k, oldName]) => {
        if (players[k]) players[k] = { ...players[k], name: oldName };
      });
      const nextRegistry = { ...registry, players };
      if (!(await saveRegistryChecked(nextRegistry))) return;
      setPersonLookup(nextRegistry);
      setRegistry(nextRegistry);
      for (const id of rec.imports) {
        let d;
        try {
          d = await fetchTournamentDataStrict(id);
        } catch {
          d = null;
        }
        if (d && d.personMap) {
          const { personMap: _drop, ...rest } = d;
          if (!(await saveTournamentData(id, rest))) reportSaveFailure(`Εισαγωγή «${d.name || id}» — καθάρισμα αντιστοίχισης`);
        }
      }
      const patch = { importMatching: all.slice(0, -1) };
      if (await saveSysState(patch)) setSysState((st) => ({ ...st, ...patch }));
      showToast(kept.length ? `Αναιρέθηκε. Κρατήθηκαν (έχουν παίξει από τότε): ${kept.join(", ")}` : "Η αντιστοίχιση αναιρέθηκε.");
      refreshImports();
    } finally {
      setMatchBusy(false);
    }
  }

  function renderMatchingCard() {
    const recs = sysState.importMatching || [];
    const last = recs[recs.length - 1];
    const playersSorted = Object.entries(registry.players).sort((a, b) => a[1].name.localeCompare(b[1].name, "el"));
    const playerClubs = [...clubsFrom(sysState)].filter((c) => !c.organiserOnly).sort((a, b) => a.name.localeCompare(b.name, "el"));
    const sel = { fontSize: 14, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 6, background: "#fff", maxWidth: 260 };
    return (
      <div className="control-sub-card">
        <strong>Αντιστοίχιση παικτών με το μητρώο</strong>
        {last && !matchPlan && (
          <p style={{ fontSize: 13, margin: "6px 0" }}>
            ✓ Τελευταία αντιστοίχιση: {formatDate(last.at)} — {last.created.length} νέα πρόσωπα, {Object.keys(last.linked || {}).length} υπάρχοντα.{" "}
            <button className="btn-ghost" onClick={undoLastMatching} disabled={matchBusy}>Αναίρεση</button>
          </p>
        )}
        {!matchPlan ? (
          <>
            <p className="control-sub" style={{ marginTop: 6 }}>
              Κάθε όνομα των εισαγόμενων τουρνουά γίνεται πρόσωπο του μητρώου — υπάρχον ή νέο. Πρώτα βλέπεις τον πίνακα· τίποτα δεν αλλάζει μέχρι την «Εφαρμογή».
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-secondary" onClick={() => buildMatchPlan(null)} disabled={matchBusy || !importsList || importsList.length === 0}>
                {matchBusy ? "Υπολογισμός…" : "Αντιστοίχιση (με αυτόματες προτάσεις)"}
              </button>
              <button className="btn-secondary" onClick={() => matchFileRef.current?.click()} disabled={matchBusy || !importsList || importsList.length === 0}>
                <Upload size={14} /> Με αρχείο αποφάσεων (.json)
              </button>
            </div>
          </>
        ) : (
          (() => {
            const problems = matchPlanProblems(matchPlan);
            const exportFresh = !!sysState.lastExportAt && Date.now() - new Date(sysState.lastExportAt).getTime() < 24 * 3600 * 1000;
            const nNew = matchPlan.rows.filter((r) => r.choice?.type === "new").length;
            const nGuests = matchPlan.rows.filter((r) => r.choice?.type === "new" && r.choice.guest).length;
            const nExisting = matchPlan.rows.filter((r) => r.choice?.type === "existing").length;
            return (
              <>
                <p style={{ fontSize: 13, margin: "6px 0" }}>
                  {matchPlan.rows.length} πρόσωπα από {matchPlan.imports.map((i) => i.name).join(", ")} · {nExisting} υπάρχοντα · {nNew} νέα ({nGuests} φιλοξενούμενοι)
                </p>
                <div style={{ overflowX: "auto", maxHeight: 560, overflowY: "auto" }}>
                  <table className="cal-table">
                    <thead><tr><th>Όνομα στην πηγή</th><th>Επίπεδο</th><th>Πρόσωπο</th><th>Στοιχεία νέου προσώπου</th></tr></thead>
                    <tbody>
                      {matchPlan.rows.map((r, i) => {
                        const c = r.choice;
                        const value = !c ? "" : c.type === "new" ? "__new" : c.key;
                        const cand = new Set(r.candidates || []);
                        return (
                          <tr key={i}>
                            <td>
                              {r.occ.map((o, j) => (
                                <div key={j}>{o.name} <span className="cal-note">· {o.importName}{o.position ? `, ${o.position}ος` : ""}</span></div>
                              ))}
                              {r.note && <div className="field-warning" style={{ margin: 0 }}>{r.note}</div>}
                            </td>
                            <td>
                              {r.level}
                              {c?.type === "existing" && c.rename && <div className="cal-note">νέο όνομα: {c.rename}</div>}
                            </td>
                            <td>
                              <select
                                value={value}
                                style={sel}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (!v) setMatchChoice(i, null);
                                  else if (v === "__new") setMatchChoice(i, { type: "new", name: titleCaseName(r.names[0]), clubId: null, guest: false });
                                  else setMatchChoice(i, { type: "existing", key: v });
                                }}
                              >
                                <option value="">— επίλεξε —</option>
                                <option value="__new">Νέο πρόσωπο</option>
                                {cand.size > 0 && (
                                  <optgroup label="Προτάσεις">
                                    {[...cand].map((k) => <option key={k} value={k}>{registry.players[k]?.name}</option>)}
                                  </optgroup>
                                )}
                                <optgroup label="Όλο το μητρώο">
                                  {playersSorted.filter(([k]) => !cand.has(k)).map(([k, p]) => <option key={k} value={k}>{p.name}{p.guest ? " (φιλοξ.)" : ""}</option>)}
                                </optgroup>
                              </select>
                            </td>
                            <td>
                              {c?.type === "new" && (
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                  <input type="text" value={c.name} onChange={(e) => setMatchChoice(i, { ...c, name: e.target.value })} style={{ width: 170, padding: "5px 8px", fontSize: 14 }} />
                                  <select value={c.clubId || ""} style={sel} disabled={c.guest} onChange={(e) => setMatchChoice(i, { ...c, clubId: e.target.value || null })}>
                                    <option value="">χωρίς σύλλογο</option>
                                    {playerClubs.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                                  </select>
                                  <label style={{ fontSize: 13, display: "flex", gap: 4, alignItems: "center" }}>
                                    <input type="checkbox" checked={!!c.guest} onChange={(e) => setMatchChoice(i, { ...c, guest: e.target.checked, clubId: e.target.checked ? null : c.clubId })} /> φιλοξ.
                                  </label>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {problems.length > 0 && (
                  <div className="field-warning">
                    ⚠ Πριν την εφαρμογή:
                    <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>{problems.slice(0, 10).map((p, k) => <li key={k}>{p}</li>)}</ul>
                  </div>
                )}
                {!exportFresh && (
                  <div className="notice" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--ink)", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                    <span>Για την εφαρμογή χρειάζεται <strong>Export All Data των τελευταίων 24 ωρών</strong>.</span>
                    <button className="btn-secondary" onClick={exportAllData}><Download size={15} /> Export τώρα</button>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="btn-secondary" onClick={() => setMatchPlan(null)} disabled={matchBusy}>Άκυρο</button>
                  <button className="btn-primary" onClick={applyMatchPlan} disabled={matchBusy || problems.length > 0 || !exportFresh}>
                    {matchBusy ? "Εφαρμογή… (περίμενε)" : "Εφαρμογή αντιστοίχισης"}
                  </button>
                </div>
              </>
            );
          })()
        )}
        <input type="file" accept="application/json,.json" ref={matchFileRef} onChange={onMatchFile} style={{ display: "none" }} />
      </div>
    );
  }
  // #endregion Εισαγωγές: αντιστοίχιση παικτών

  /* ---- Build 3D: locked seasons ---- */

  // #region Σεζόν: κλείσιμο & κλείδωμα
  /** True when the open tournament may be changed. In a locked season the
   * admin must first unlock changes for this one tournament (tab «Στοιχεία»). */
  function tournamentEditable() {
    if (!seasonLocked(sysState, seasonYear) || lockOverrideId === tournamentId) return true;
    showToast(`Η σεζόν ${sn(seasonYear)} είναι κλειδωμένη — ξεκλείδωσε τις αλλαγές από το tab «Στοιχεία».`);
    return false;
  }

  async function confirmLockAction() {
    if (!lockAction || String(lockTyped).trim() !== String(lockAction.year)) {
      showToast("Πληκτρολόγησε το έτος της σεζόν για επιβεβαίωση.");
      return;
    }
    const { kind, year } = lockAction;
    if (kind === "tournament") {
      setLockOverrideId(tournamentId);
      setLockAction(null);
      setLockTyped("");
      showToast("Επιτρέπονται αλλαγές σε αυτό το τουρνουά, μέχρι να ανοίξεις άλλο.");
      return;
    }
    const locks = { ...(sysState.seasonLocks || {}) };
    if (kind === "lock") locks[String(year)] = { lockedAt: new Date().toISOString() };
    else delete locks[String(year)];
    if (await saveSysState({ seasonLocks: locks })) {
      setSysState((st) => ({ ...st, seasonLocks: locks }));
      setLockAction(null);
      setLockTyped("");
      showToast(kind === "lock" ? `Η σεζόν ${sn(year)} έκλεισε και κλειδώθηκε.` : `Η σεζόν ${sn(year)} ξεκλειδώθηκε.`);
    } else {
      reportSaveFailure(`Σεζόν ${sn(year)} — το ${kind === "lock" ? "κλείδωμα" : "ξεκλείδωμα"} δεν αποθηκεύτηκε`);
    }
  }

  function renderLockPrompt(kind, year, text) {
    const open = lockAction && lockAction.kind === kind && lockAction.year === year;
    if (!open) return null;
    return (
      <div className="lock-prompt">
        <p style={{ margin: "0 0 8px 0", fontSize: 14 }}>{text}</p>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ width: 140 }}>
            <label>Πληκτρολόγησε «{year}»</label>
            <input type="text" value={lockTyped} onChange={(e) => setLockTyped(e.target.value)} />
          </div>
          <button className="btn-secondary" onClick={() => { setLockAction(null); setLockTyped(""); }}>Άκυρο</button>
          <button className="btn-primary" onClick={confirmLockAction} disabled={String(lockTyped).trim() !== String(year)}>Επιβεβαίωση</button>
        </div>
      </div>
    );
  }

  /** Admin: closing and locking a season (Σεζόν tab). */
  function renderSeasonCloseCard(year) {
    const locked = seasonLocked(sysState, year);
    const prog = calendarProgress(buildCalendarView(sysState, year, archive));
    const ended = todayYMD() > (year === 2026 ? "2026-12-31" : `${year}-12-31`);
    const calendarDone = prog.total > 0 && prog.done === prog.total;
    const exportFresh = !!sysState.lastExportAt && Date.now() - new Date(sysState.lastExportAt).getTime() < 24 * 3600 * 1000;
    if (locked) {
      return (
        <div className="control-sub-card">
          <strong>Σεζόν {sn(year)} — κλειστή 🔒</strong>
          <p style={{ margin: "6px 0 0 0", fontSize: 13, color: "var(--muted)" }}>
            Κλείδωσε στις {formatDate(sysState.seasonLocks[String(year)].lockedAt)}. Οι κανόνες και το ημερολόγιό της δεν αλλάζουν, κάθε αλλαγή σε τουρνουά της θέλει ξεχωριστό ξεκλείδωμα, και ένα Recompute που θα άλλαζε τη Βαθμολογία της σταματά και ρωτά.
          </p>
          {!lockAction && (
            <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => { setLockAction({ kind: "unlock", year }); setLockTyped(""); }}>
              Ξεκλείδωμα σεζόν…
            </button>
          )}
          {renderLockPrompt("unlock", year, `Το ξεκλείδωμα επιτρέπει ξανά αλλαγές στη σεζόν ${sn(year)}. Χρησιμοποίησέ το μόνο για διόρθωση λάθους.`)}
        </div>
      );
    }
    return (
      <div className="control-sub-card">
        <strong>Σεζόν {sn(year)} — κλείσιμο</strong>
        <p style={{ margin: "6px 0 8px 0", fontSize: 13, color: ended || calendarDone ? "var(--win)" : "var(--muted)" }}>
          {ended || calendarDone
            ? "✓ Η σεζόν έχει ολοκληρωθεί και μπορεί να κλείσει."
            : `Η σεζόν δεν έχει ολοκληρωθεί ακόμα${prog.total > 0 ? ` (${prog.done} από ${prog.total} αγωνιστικές)` : ""}. Μπορεί να κλείσει, αλλά συνήθως κλείνει μετά την τελευταία αγωνιστική.`}
        </p>
        <ol className="close-steps">
          <li className={exportFresh ? "done" : ""}>
            Πλήρες backup: {exportFresh ? `✓ ${formatDate(sysState.lastExportAt)}` : <button className="btn-secondary" onClick={exportAllData}><Download size={14} /> Export All Data</button>}
          </li>
          <li className={excelDoneAt ? "done" : ""}>
            Τελική Βαθμολογία σε Excel: {excelDoneAt ? "✓ κατέβηκε" : <button className="btn-secondary" onClick={async () => { await exportBaselineExcel(); setExcelDoneAt(new Date().toISOString()); }}><Download size={14} /> Εξαγωγή Excel</button>}
          </li>
          <li>
            Κλείδωμα:{" "}
            <button className="btn-primary" disabled={!exportFresh || !excelDoneAt || !!lockAction} onClick={() => { setLockAction({ kind: "lock", year }); setLockTyped(""); }}>
              🔒 Κλείσιμο σεζόν {sn(year)}
            </button>
            {(!exportFresh || !excelDoneAt) && (
              <div className="cal-note" style={{ marginTop: 4 }}>
                Ενεργοποιείται όταν ολοκληρωθούν {!exportFresh && !excelDoneAt ? "τα βήματα 1 και 2" : !exportFresh ? "το βήμα 1" : "το βήμα 2"}.
              </div>
            )}
          </li>
        </ol>
        {renderLockPrompt("lock", year, `Μετά το κλείσιμο, οι κανόνες, το ημερολόγιο και τα αποτελέσματα της σεζόν ${sn(year)} προστατεύονται από αλλαγές.`)}
      </div>
    );
  }
  // #endregion Σεζόν: κλείσιμο & κλείδωμα

  /* ---- Competitions owned by clubs (Build 4A) ---- */

  // #region Διοργανώσεις
  /** One-off upgrade: every competition gets the club it belongs to. The
   * finals go to a new organiser-only club «Πανελλήνιες Διοργανώσεις» and are
   * renamed. Numbers do not change: the home club's ranking is today's ELO. */
  async function upgradeCompetitions() {
    if (!clubsActive(sysState) || !sysState.homeClubId) {
      showToast("Χρειάζεται πρώτα η λίστα συλλόγων με επιλεγμένο «ο σύλλογός μου».");
      return;
    }
    const clubs = [...clubsFrom(sysState)];
    let national = clubs.find((c) => c.organiserOnly && normClubKey(c.name) === normClubKey("Πανελλήνιες Διοργανώσεις"));
    if (!national) {
      national = { id: newClubId(), name: "Πανελλήνιες Διοργανώσεις", aliases: [], organiserOnly: true };
      clubs.push(national);
    }
    const competitions = competitionsFrom(sysState).map((c) => {
      if (c.id === DEFAULT_COMPETITION_ID) return { ...c, ownerClubId: sysState.homeClubId, countsElo: true };
      if (c.id === "final-phase") return { ...c, name: "Τελική Φάση Πρωταθλήματος", ownerClubId: national.id, countsElo: true };
      if (c.id === "cup") return { ...c, name: "Τελική Φάση Κυπέλλου", ownerClubId: national.id, countsElo: true };
      return c.ownerClubId ? c : { ...c, ownerClubId: national.id, countsElo: c.countsElo !== false };
    });
    const patch = { clubs, competitions, competitionsVersion: 2 };
    if (await saveSysState(patch)) {
      setSysState((st) => ({ ...st, ...patch }));
      showToast("Οι διοργανώσεις συνδέθηκαν με συλλόγους.");
    } else {
      reportSaveFailure("Διοργανώσεις — η αναβάθμιση δεν αποθηκεύτηκε");
    }
  }

  async function saveCompDraft() {
    const name = (compDraft?.name || "").trim();
    if (!name) return;
    const comps = competitionsFrom(sysState);
    if (comps.some((c) => c.id !== compDraft.id && c.name.trim().toLowerCase() === name.toLowerCase())) {
      showToast("Υπάρχει ήδη διοργάνωση με αυτό το όνομα.");
      return;
    }
    let next;
    if (compDraft.id) {
      next = comps.map((c) => (c.id === compDraft.id ? { ...c, name } : c));
    } else {
      if (!compDraft.ownerClubId) {
        showToast("Διάλεξε σε ποιον σύλλογο ανήκει η διοργάνωση.");
        return;
      }
      const id = `comp_${Date.now().toString(36)}`;
      next = [...comps, { id, name, ownerClubId: compDraft.ownerClubId, countsElo: compDraft.countsElo !== false, level: "club", pool: "club" }];
    }
    if (await saveSysState({ competitions: next })) {
      setSysState((st) => ({ ...st, competitions: next }));
      setCompDraft(null);
      showToast("Η διοργάνωση αποθηκεύτηκε.");
    } else {
      reportSaveFailure("Διοργανώσεις — η αλλαγή δεν αποθηκεύτηκε");
    }
  }

  async function deleteCompetition(id) {
    if (id === DEFAULT_COMPETITION_ID) return;
    const used = [...archive, ...trash].some((t) => (t.competitionId || DEFAULT_COMPETITION_ID) === id);
    if (used) {
      showToast("Η διοργάνωση έχει τουρνουά — μπορεί μόνο να μετονομαστεί.");
      return;
    }
    const next = competitionsFrom(sysState).filter((c) => c.id !== id);
    if (await saveSysState({ competitions: next })) {
      setSysState((st) => ({ ...st, competitions: next }));
      showToast("Η διοργάνωση διαγράφηκε.");
    }
  }

  async function toggleClubOrganiserOnly(club) {
    if (!club.organiserOnly && Object.values(registry.players).some((p) => p.clubId === club.id)) {
      showToast("Ο σύλλογος έχει παίκτες — δεν μπορεί να γίνει φορέας.");
      return;
    }
    const next = clubsFrom(sysState).map((c) => (c.id === club.id ? { ...c, organiserOnly: !c.organiserOnly } : c));
    if (await saveSysState({ clubs: next })) setSysState((st) => ({ ...st, clubs: next }));
  }

  function renderCompetitionsCard() {
    const comps = competitionsFrom(sysState);
    if (sysState.competitionsVersion !== 2) {
      return (
        <div className="control-sub-card">
          <strong>Διοργανώσεις — σύνδεση με συλλόγους</strong>
          <p className="control-sub" style={{ marginTop: 6 }}>
            Κάθε διοργάνωση θα ανήκει σε έναν σύλλογο, και κάθε σύλλογος έχει τη δική του κατάταξη ELO. Η αναβάθμιση: Premier League → {clubDisplay(sysState, sysState.homeClubId, "ο σύλλογός σου")}·
            «Κύπελλο» → «Τελική Φάση Κυπέλλου» και «Τελική φάση» → «Τελική Φάση Πρωταθλήματος», και οι δύο στον νέο φορέα «Πανελλήνιες Διοργανώσεις». Η ELO και η Βαθμολογία δεν αλλάζουν.
          </p>
          <button className="btn-primary" onClick={upgradeCompetitions} disabled={!clubsActive(sysState) || !sysState.homeClubId}>
            Σύνδεση διοργανώσεων με συλλόγους
          </button>
          {(!clubsActive(sysState) || !sysState.homeClubId) && <p className="field-warning">Χρειάζεται πρώτα η λίστα συλλόγων, με επιλεγμένο «ο σύλλογός μου».</p>}
        </div>
      );
    }
    const clubsSorted = [...clubsFrom(sysState)].sort((a, b) => a.name.localeCompare(b.name, "el"));
    return (
      <div className="control-sub-card">
        <strong>Διοργανώσεις</strong>
        <p className="control-sub" style={{ marginTop: 6 }}>
          Κάθε διοργάνωση ανήκει σε έναν σύλλογο· ο σύλλογος ορίζει την κατάταξη ELO όπου μετράει. Σήμερα ενεργή είναι η ELO του συλλόγου σου ({clubDisplay(sysState, sysState.homeClubId, "—")}). Ο σύλλογος μιας διοργάνωσης κλειδώνει μετά τη δημιουργία.
        </p>
        <table className="cal-table">
          <thead><tr><th>Διοργάνωση</th><th>Σύλλογος</th><th>ELO</th><th title="Έχει πίνακα Βαθμολογίας σεζόν">Βαθμολογία</th><th>Τουρνουά</th><th></th></tr></thead>
          <tbody>
            {comps.map((c) => {
              const count = archive.filter((t) => (t.competitionId || DEFAULT_COMPETITION_ID) === c.id).length;
              const editing = compDraft && compDraft.id === c.id;
              return (
                <tr key={c.id}>
                  <td>{editing ? <input type="text" value={compDraft.name} onChange={(e) => setCompDraft({ ...compDraft, name: e.target.value })} /> : c.name}</td>
                  <td>{clubDisplay(sysState, c.ownerClubId, "—")}</td>
                  <td>{c.countsElo === false ? "δεν μετράει" : c.ownerClubId === sysState.homeClubId ? "ELO Ομοσπονδίας" : clubsFrom(sysState).find((x) => x.id === c.ownerClubId)?.organiserOnly ? "Πανελλήνια ELO" : "—"}</td>
                  <td><input type="checkbox" checked={competitionHasStandings(c)} onChange={() => toggleCompetitionStandings(c)} title="Έχει Βαθμολογία σεζόν" /></td>
                  <td>{count}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {editing ? (
                      <>
                        <button className="btn-ghost" onClick={() => setCompDraft(null)}>Άκυρο</button>
                        <button className="btn-secondary" onClick={saveCompDraft}>Αποθήκευση</button>
                      </>
                    ) : (
                      <>
                        <button className="btn-ghost" style={{ padding: "2px 6px" }} title="Μετονομασία" onClick={() => setCompDraft({ id: c.id, name: c.name })}><Pencil size={13} /></button>
                        {c.id !== DEFAULT_COMPETITION_ID && count === 0 && (
                          <button className="btn-ghost" style={{ padding: "2px 6px" }} title="Διαγραφή" onClick={() => deleteCompetition(c.id)}><Trash2 size={13} /></button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {compDraft && !compDraft.id ? (
          <div className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
            <div className="field"><label>Νέα διοργάνωση</label><input type="text" value={compDraft.name} onChange={(e) => setCompDraft({ ...compDraft, name: e.target.value })} /></div>
            <div style={{ width: 220 }}>
              <label>Ανήκει στον σύλλογο</label>
              <select value={compDraft.ownerClubId || ""} onChange={(e) => setCompDraft({ ...compDraft, ownerClubId: e.target.value })} style={{ width: "100%", fontSize: 15, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 7, background: "#fff" }}>
                <option value="">—</option>
                {clubsSorted.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <label style={{ display: "flex", gap: 6, alignItems: "center", paddingBottom: 10 }}>
              <input type="checkbox" checked={compDraft.countsElo !== false} onChange={(e) => setCompDraft({ ...compDraft, countsElo: e.target.checked })} /> μετράει σε ELO
            </label>
            <button className="btn-secondary" onClick={() => setCompDraft(null)}>Άκυρο</button>
            <button className="btn-primary" onClick={saveCompDraft} disabled={!compDraft.name.trim() || !compDraft.ownerClubId}>Δημιουργία</button>
          </div>
        ) : (
          <button className="btn-secondary" style={{ marginTop: 10 }} onClick={() => setCompDraft({ name: "", ownerClubId: "", countsElo: true })}><Plus size={14} /> Νέα διοργάνωση</button>
        )}
      </div>
    );
  }
  // #endregion Διοργανώσεις

  /* ---- Build 3B3: clubs and registry numbers ---- */

  // #region Σύλλογοι
  /** Dry run of the clubs migration: every club name in use today (players,
   * tournaments, the home club), grouped by spelling. Changes nothing. */
  async function runClubPlan() {
    setClubBusy(true);
    try {
      const groups = {}; // key -> { variants: {raw: n}, players, tournaments, home }
      const add = (raw, kind) => {
        const name = String(raw || "").trim();
        if (!name) return;
        const key = normClubKey(name);
        if (!key) return;
        if (!groups[key]) groups[key] = { key, variants: {}, players: 0, tournaments: 0, home: false };
        groups[key].variants[name] = (groups[key].variants[name] || 0) + 1;
        if (kind === "player") groups[key].players += 1;
        if (kind === "tournament") groups[key].tournaments += 1;
        if (kind === "home") groups[key].home = true;
      };
      Object.values(registry.players || {}).forEach((p) => add(p.club, "player"));
      add(sysState.homeClub, "home");
      const unreadable = [];
      const ids = [...new Set([...archive.map((t) => t.id), ...trash.map((t) => t.id)])];
      for (const id of ids) {
        try {
          const d = await fetchTournamentDataStrict(id);
          if (d) add(d.organisation, "tournament");
        } catch {
          unreadable.push(id);
        }
      }
      const list = Object.values(groups).map((g) => {
        const variants = Object.entries(g.variants).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
        return { ...g, variants: variants.map(([v]) => v), name: variants[0][0] };
      });
      list.sort((a, b) => b.players + b.tournaments - (a.players + a.tournaments) || a.name.localeCompare(b.name, "el"));
      // Suggest "probably the same club" for close spellings (never applied on its own).
      list.forEach((g) => {
        const tg = g.key.split(" ").filter((w) => w.length >= 3);
        const other = list.find((o) => {
          if (o.key === g.key) return false;
          const to = o.key.split(" ").filter((w) => w.length >= 3);
          const subset = tg.length > 0 && to.length > tg.length && tg.every((w) => to.includes(w));
          return subset || (g.key.length >= 5 && editDistance(g.key, o.key) <= 2 && list.indexOf(o) < list.indexOf(g));
        });
        g.suggestion = other ? other.key : null;
      });
      setClubPlan({ list, unreadable, scanned: ids.length });
      setClubDecisions({});
      setClubNames(Object.fromEntries(list.map((g) => [g.key, g.name])));
    } finally {
      setClubBusy(false);
    }
  }

  /** The key a club name ends up under, following "same as" choices. */
  function resolveClubKey(key, decisions) {
    const seen = new Set();
    let k = key;
    while (decisions[k] && decisions[k] !== "new" && !seen.has(k)) {
      seen.add(k);
      k = decisions[k];
    }
    return k;
  }

  async function applyClubMigration() {
    if (!clubPlan || clubBusy) return;
    const last = sysState.lastExportAt ? new Date(sysState.lastExportAt).getTime() : 0;
    if (Date.now() - last > 24 * 3600 * 1000) {
      showToast("Κάνε πρώτα Export All Data (των τελευταίων 24 ωρών).");
      return;
    }
    if (clubPlan.unreadable.length > 0) {
      showToast("Κάποια τουρνουά δεν διαβάστηκαν — ξανατρέξε την αναφορά.");
      return;
    }
    setClubBusy(true);
    try {
      // 1. the club list
      const roots = clubPlan.list.filter((g) => resolveClubKey(g.key, clubDecisions) === g.key);
      const clubs = roots.map((g) => ({
        id: newClubId() + g.key.replace(/\s/g, "").slice(0, 3),
        name: (clubNames[g.key] || g.name).trim(),
        aliases: [],
      }));
      const idByRoot = Object.fromEntries(roots.map((g, i) => [g.key, clubs[i].id]));
      clubPlan.list.forEach((g) => {
        const root = resolveClubKey(g.key, clubDecisions);
        const c = clubs.find((x) => x.id === idByRoot[root]);
        if (c) c.aliases = [...new Set([...c.aliases, ...g.variants])];
      });
      const idFor = (raw) => {
        const k = normClubKey(raw);
        if (!k) return null;
        return idByRoot[resolveClubKey(k, clubDecisions)] || null;
      };
      const nameOf = (id) => clubs.find((c) => c.id === id)?.name || "";
      // 2. players
      const players = Object.fromEntries(
        Object.entries(registry.players).map(([k, p]) => {
          const id = idFor(p.club);
          return [k, id ? { ...p, clubId: id, club: nameOf(id) } : p];
        })
      );
      const nextRegistry = { ...registry, players };
      if (!(await saveRegistryChecked(nextRegistry))) return;
      setPersonLookup(nextRegistry);
      setRegistry(nextRegistry);
      // 3. tournaments (catalogue and trash)
      const ids = [...new Set([...archive.map((t) => t.id), ...trash.map((t) => t.id)])];
      for (const tid of ids) {
        let d;
        try {
          d = await fetchTournamentDataStrict(tid);
        } catch {
          d = undefined;
        }
        if (d === undefined) {
          reportSaveFailure("Μετάπτωση συλλόγων — ένα τουρνουά δεν διαβάστηκε· η μετάπτωση σταμάτησε (ό,τι γράφτηκε ως εδώ είναι σωστό, ξανατρέξε την)");
          return;
        }
        if (!d || !d.organisation) continue;
        const id = idFor(d.organisation);
        if (!id || (d.organisationClubId === id && d.organisation === nameOf(id))) continue;
        if (!(await saveTournamentData(tid, { ...d, organisationClubId: id, organisation: nameOf(id) }))) {
          reportSaveFailure(`Μετάπτωση συλλόγων — το «${d.tournamentName || tid}» δεν αποθηκεύτηκε· η μετάπτωση σταμάτησε (ξανατρέξε την)`);
          return;
        }
        if (tid === tournamentId) {
          setOrganisationClubId(id);
          setOrganisation(nameOf(id));
        }
      }
      // 4. the list itself, last: until it is saved the app keeps working with text
      const homeClubId = idFor(sysState.homeClub);
      const patch = { clubs, homeClubId, homeClub: homeClubId ? nameOf(homeClubId) : sysState.homeClub || "", clubsVersion: 1, clubsMigratedAt: new Date().toISOString() };
      if (await saveSysState(patch)) {
        setSysState((st) => ({ ...st, ...patch }));
        setClubPlan(null);
        showToast(`Η μετάπτωση συλλόγων ολοκληρώθηκε: ${clubs.length} σύλλογοι.`);
      } else {
        reportSaveFailure("Μετάπτωση συλλόγων — η λίστα συλλόγων δεν αποθηκεύτηκε· ξανατρέξε τη μετάπτωση");
      }
    } finally {
      setClubBusy(false);
    }
  }

  async function saveClubDraft() {
    const name = (clubDraft?.name || "").trim();
    if (!name) return;
    const clubs = clubsFrom(sysState);
    const clash = clubs.find((c) => c.id !== clubDraft.id && normClubKey(c.name) === normClubKey(name));
    if (clash) {
      showToast(`Υπάρχει ήδη ο σύλλογος «${clash.name}».`);
      return;
    }
    const next = clubDraft.id
      ? clubs.map((c) => (c.id === clubDraft.id ? { ...c, name, aliases: [...new Set([...(c.aliases || []), c.name])] } : c))
      : [...clubs, { id: newClubId(), name, aliases: [] }];
    const patch = { clubs: next };
    if (clubDraft.id && clubDraft.id === sysState.homeClubId) patch.homeClub = name;
    if (await saveSysState(patch)) {
      setSysState((st) => ({ ...st, ...patch }));
      setClubDraft(null);
      showToast("Ο σύλλογος αποθηκεύτηκε.");
    } else {
      reportSaveFailure("Σύλλογοι — η αλλαγή δεν αποθηκεύτηκε");
    }
  }

  async function setHomeClubId(id) {
    if (sysState.competitionsVersion === 2 && sysState.homeClubId && id !== sysState.homeClubId) {
      // The home club decides which ELO is the app's ranking — not a casual switch.
      showToast("Ο σύλλογός σου ορίζει την κατάταξη ELO της εφαρμογής και δεν αλλάζει από εδώ.");
      return;
    }
    const patch = { homeClubId: id, homeClub: clubDisplay(sysState, id, "") };
    if (await saveSysState(patch)) {
      setSysState((st) => ({ ...st, ...patch }));
      showToast("Ο σύλλογός σου ορίστηκε.");
    } else {
      reportSaveFailure("Σύλλογοι — ο σύλλογός σου δεν αποθηκεύτηκε");
    }
  }
  // #endregion Σύλλογοι

  // #region Αριθμός Μητρώου
  /** Dry run of the registry numbers: order of first participation. */
  async function runRegNoPlan() {
    setClubBusy(true);
    try {
      const order = [];
      const seen = new Set();
      const chronological = [...archive].sort((a, b) => new Date(a.date) - new Date(b.date));
      for (const t of chronological) {
        let d;
        try {
          d = await fetchTournamentDataStrict(t.id);
        } catch {
          showToast("Κάποιο τουρνουά δεν διαβάστηκε — δοκίμασε ξανά.");
          return;
        }
        (d?.players || []).forEach((p) => {
          const key = normalizeName(p.name);
          if (registry.players[key] && !seen.has(key)) {
            seen.add(key);
            order.push(key);
          }
        });
      }
      const rest = Object.keys(registry.players)
        .filter((k) => !seen.has(k))
        .sort((a, b) => registry.players[a].name.localeCompare(registry.players[b].name, "el"));
      const all = [...order, ...rest];
      setRegNoPlan({ order: all, played: order.length });
    } finally {
      setClubBusy(false);
    }
  }

  async function applyRegNos() {
    if (!regNoPlan) return;
    const players = { ...registry.players };
    regNoPlan.order.forEach((k, i) => {
      if (players[k]) players[k] = { ...players[k], regNo: i + 1 };
    });
    const next = { ...registry, players, regNoVersion: 1, regNoMax: regNoPlan.order.length };
    if (await saveRegistryChecked(next)) {
      setPersonLookup(next);
      setRegistry(next);
      setRegNoPlan(null);
      showToast(`Δόθηκαν ${regNoPlan.order.length} αριθμοί μητρώου.`);
    }
  }
  // #endregion Αριθμός Μητρώου

  /* ---- Build 3B2: calendar ---- */

  // #region Σεζόν & ημερολόγιο
  /** Fills the new-tournament form from a calendar day (or clears the link). */
  function applyCalendarEntry(entry, year) {
    if (!entry) {
      setCalendarEntryId(null);
      return;
    }
    setCalendarEntryId(entry.id);
    setTournamentName(calendarEntryTitle(entry, year, competitionsFrom(sysState)));
    setCreatedAt((prev) => withLocalDate(prev || new Date().toISOString(), entry.date));
    setSeasonYear(year);
    setCompetitionId(entry.competitionId || DEFAULT_COMPETITION_ID);
  }

  async function saveCalendar(year, entries) {
    const all = { ...(sysState.seasonCalendars || {}), [String(year)]: entries };
    setCalBusy(true);
    try {
      if (await saveSysState({ seasonCalendars: all })) {
        setSysState((st) => ({ ...st, seasonCalendars: all }));
        return true;
      }
      reportSaveFailure(`Ημερολόγιο σεζόν ${sn(year)} — δεν αποθηκεύτηκε`);
      return false;
    } finally {
      setCalBusy(false);
    }
  }

  function calendarOf(year) {
    return [...((sysState.seasonCalendars && sysState.seasonCalendars[String(year)]) || [])];
  }

  async function saveCalDraft() {
    if (!calDraft || !calDraft.date) return;
    const { year } = calDraft;
    const entries = calendarOf(year);
    const clean = { date: calDraft.date, competitionId: calDraft.competitionId || DEFAULT_COMPETITION_ID, note: (calDraft.note || "").trim() };
    let next;
    if (calDraft.id) next = entries.map((e) => (e.id === calDraft.id ? { ...e, ...clean } : e));
    else next = [...entries, { id: newCalendarEntryId(), ...clean, tournamentId: null }];
    if (await saveCalendar(year, next)) {
      setCalDraft(null);
      showToast("Το ημερολόγιο αποθηκεύτηκε.");
    }
  }

  async function deleteCalEntry(year, id) {
    const next = calendarOf(year).filter((e) => e.id !== id);
    if (await saveCalendar(year, next)) showToast("Η αγωνιστική διαγράφηκε από το ημερολόγιο.");
  }

  /** Adds a calendar day for every tournament of the season that is not on
   * the calendar yet (used once, for 2026). Dates come from the tournaments. */
  async function fillCalendarFromTournaments(year) {
    const entries = calendarOf(year);
    const linked = new Set(entries.map((e) => e.tournamentId).filter(Boolean));
    const view = buildCalendarView(sysState, year, archive);
    view.forEach((e) => e.tournament && linked.add(e.tournament.id));
    const toAdd = archive
      .filter((t) => Number(t.seasonYear) === Number(year) && t.isOfficial && !linked.has(t.id))
      .map((t) => ({ id: newCalendarEntryId() + t.id.slice(-4), date: isoToLocalYMD(t.date), competitionId: t.competitionId || DEFAULT_COMPETITION_ID, note: "", tournamentId: t.id }));
    if (toAdd.length === 0) {
      showToast("Όλα τα επίσημα τουρνουά της σεζόν υπάρχουν ήδη στο ημερολόγιο.");
      return;
    }
    if (await saveCalendar(year, [...entries, ...toAdd])) showToast(`Προστέθηκαν ${toAdd.length} αγωνιστικές από τα υπάρχοντα τουρνουά.`);
  }

  async function createSeason() {
    // 5B.2β: a season belongs to a competition and has a free name; it is
    // not tied to dates. New seasons get ids from NEW_SEASON_ID_BASE up.
    const name = String(newSeasonYear || "").trim();
    const comp = controlCompId || DEFAULT_COMPETITION_ID;
    if (!name) {
      showToast("Δώσε όνομα σεζόν (π.χ. 2027 ή 2026–27).");
      return;
    }
    const existing = seasonsOfCompetition(sysState, comp, controlSeasons);
    if (existing.some((s) => s.name.trim().toLowerCase() === name.toLowerCase())) {
      showToast(`Η σεζόν ${name} υπάρχει ήδη σε αυτή τη διοργάνωση.`);
      return;
    }
    const id = nextSeasonId(sysState, controlSeasons);
    const now = new Date().toISOString();
    // Pin the rules of this competition's earlier seasons that still inherit,
    // then give the new season a copy of the latest rules.
    const rules = { ...(sysState.seasonRules || {}) };
    existing.filter((s) => !rules[String(s.id)]).forEach((s) => {
      const r = rulesForSeason({ ...sysState, seasonRules: rules }, s.id);
      rules[String(s.id)] = { bestOf: r.bestOf, cutoffR32: r.cutoffR32, cutoffR48: r.cutoffR48, setAt: now };
    });
    const seasons = { ...(sysState.seasons || {}), [String(id)]: { competitionId: comp, name, createdAt: now } };
    const base = rulesForSeason({ ...sysState, seasons, seasonRules: rules }, id);
    rules[String(id)] = { bestOf: base.bestOf, cutoffR32: base.cutoffR32, cutoffR48: base.cutoffR48, setAt: now };
    const calendars = { ...(sysState.seasonCalendars || {}), [String(id)]: [] };
    const patch = { seasons, seasonRules: rules, seasonCalendars: calendars, seasonsOpened: { ...(sysState.seasonsOpened || {}), [String(id)]: now } };
    if (await saveSysState(patch)) {
      setSysState((st) => ({ ...st, ...patch }));
      setNewSeasonYear(null);
      setControlSeasonYear(id);
      showToast(`Η σεζόν ${name} δημιουργήθηκε· έλεγξε τους κανόνες και πρόσθεσε τις αγωνιστικές.`);
    } else {
      reportSaveFailure(`Νέα σεζόν ${name} — δεν δημιουργήθηκε`);
    }
  }

  /** 5B.2β: «Έχει Βαθμολογία σεζόν» per competition. */
  async function toggleCompetitionStandings(comp) {
    const next = competitionsFrom(sysState).map((c) => (c.id === comp.id ? { ...c, hasStandings: !competitionHasStandings(c) } : c));
    if (await saveSysState({ competitions: next })) setSysState((st) => ({ ...st, competitions: next }));
    else reportSaveFailure("Διοργανώσεις — η αλλαγή δεν αποθηκεύτηκε");
  }

  /** 5B.2β: season picker limited to one competition's seasons. */
  function renderSeasonSelect(compId, value, onChange) {
    const list = seasonsOfCompetition(sysState, compId, controlSeasons).map((s) => s.id);
    if (value && !list.includes(Number(value))) list.push(Number(value));
    return (
      <select value={value || ""} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%", fontFamily: "'Source Sans 3', sans-serif", fontSize: 15, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 7, background: "#fff" }}>
        {[...list].sort((a, b) => b - a).map((id) => (
          <option key={id} value={id}>{sn(id)}{seasonLocked(sysState, id) ? " 🔒" : ""}</option>
        ))}
      </select>
    );
  }

  /** Admin: calendar card of one season (inside the admin page). */
  function renderCalendarCard(year) {
    const comps = competitionsFrom(sysState);
    const view = buildCalendarView(sysState, year, archive);
    const prog = calendarProgress(view);
    const editing = calDraft && calDraft.year === year;
    const unlinkedOfficial = archive.filter(
      (t) => Number(t.seasonYear) === Number(year) && t.isOfficial && !view.some((e) => e.tournament && e.tournament.id === t.id)
    );
    return (
      <div className="control-sub-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong>Σεζόν {sn(year)} — ημερολόγιο</strong>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            {prog.total > 0 ? `Premier League: ${prog.done} από ${prog.total} αγωνιστικές` : "Χωρίς αγωνιστικές ακόμα"}
          </span>
        </div>
        {view.length > 0 && (
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table className="cal-table">
              <thead>
                <tr><th>Αγωνιστική</th><th>Ημερομηνία</th><th>Διοργάνωση</th><th>Κατάσταση</th><th></th></tr>
              </thead>
              <tbody>
                {view.map((e) => (
                  <tr key={e.id} className={`cal-${e.status}`}>
                    <td>{e.day ? `Ημέρα ${e.day}` : "—"}{e.note ? <span className="cal-note"> · {e.note}</span> : null}</td>
                    <td>{formatYMD(e.effectiveDate)}</td>
                    <td>{competitionName(comps, e.competitionId)}</td>
                    <td>
                      {e.tournament ? (
                        <button className="history-link" onClick={() => openArchived(e.tournament.id)}>{CAL_STATUS_LABEL[e.status]}</button>
                      ) : (
                        CAL_STATUS_LABEL[e.status]
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {!e.tournament && !seasonLocked(sysState, year) && (
                        <>
                          <button className="btn-ghost" style={{ padding: "2px 6px" }} onClick={() => setCalDraft({ year, id: e.id, date: e.date, competitionId: e.competitionId || DEFAULT_COMPETITION_ID, note: e.note || "" })} title="Αλλαγή ημερομηνίας">
                            <Pencil size={13} />
                          </button>
                          <button className="btn-ghost" style={{ padding: "2px 6px" }} onClick={() => deleteCalEntry(year, e.id)} disabled={calBusy} title="Διαγραφή αγωνιστικής">
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {seasonLocked(sysState, year) ? null : editing ? (
          <div className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
            <div style={{ width: 160 }}>
              <label>Ημερομηνία</label>
              <input type="date" value={calDraft.date} onChange={(ev) => setCalDraft({ ...calDraft, date: ev.target.value })} />
            </div>
            <div style={{ width: 200 }}>
              <label>Διοργάνωση</label>
              <select
                value={calDraft.competitionId}
                onChange={(ev) => setCalDraft({ ...calDraft, competitionId: ev.target.value })}
                style={{ width: "100%", fontFamily: "'Source Sans 3', sans-serif", fontSize: 15, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 7, background: "#fff" }}
              >
                {comps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Σημείωση (προαιρετική)</label>
              <input type="text" value={calDraft.note} onChange={(ev) => setCalDraft({ ...calDraft, note: ev.target.value })} placeholder="π.χ. χώρος, ώρα" />
            </div>
            <button className="btn-secondary" onClick={() => setCalDraft(null)}>Άκυρο</button>
            <button className="btn-primary" onClick={saveCalDraft} disabled={!calDraft.date || calBusy}>Αποθήκευση</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button className="btn-secondary" onClick={() => setCalDraft({ year, date: "", competitionId: DEFAULT_COMPETITION_ID, note: "" })}>
              <Plus size={14} /> Προσθήκη αγωνιστικής
            </button>
            {unlinkedOfficial.length > 0 && (
              <button className="btn-secondary" onClick={() => fillCalendarFromTournaments(year)} disabled={calBusy}>
                Συμπλήρωση από τα υπάρχοντα τουρνουά ({unlinkedOfficial.length})
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  /** Visitors and admin: progress line + collapsible schedule (Season page). */
  function renderSeasonSchedule(year) {
    const view = buildCalendarView(sysState, year, archive);
    if (view.length === 0) return null;
    const prog = calendarProgress(view);
    const comps = competitionsFrom(sysState);
    return (
      <div className="card" style={{ padding: "12px 18px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15 }}>
            {prog.total > 0 && <><strong>Αγωνιστική {prog.done} από {prog.total}</strong></>}
            {prog.next && (
              <span style={{ color: "var(--muted)" }}>
                {prog.total > 0 ? " · " : ""}
                {prog.next.status === "live" ? "Σε εξέλιξη: " : "Επόμενη: "}
                {formatYMD(prog.next.effectiveDate)}
              </span>
            )}
            {!prog.next && prog.total > 0 && <span style={{ color: "var(--muted)" }}> · Η σεζόν ολοκληρώθηκε</span>}
          </span>
          <button className="btn-ghost" onClick={() => setShowSchedule(!showSchedule)}>
            {showSchedule ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Πρόγραμμα σεζόν
          </button>
        </div>
        {showSchedule && (
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table className="cal-table">
              <tbody>
                {view.map((e) => (
                  <tr key={e.id} className={`cal-${e.status}`}>
                    <td>{e.day ? `Ημέρα ${e.day}` : competitionName(comps, e.competitionId)}</td>
                    <td>{formatYMD(e.effectiveDate)}</td>
                    <td>
                      {e.tournament && e.status === "done" ? (
                        <button className="history-link" onClick={() => openArchived(e.tournament.id)}>Αποτελέσματα</button>
                      ) : (
                        CAL_STATUS_LABEL[e.status]
                      )}
                      {e.note ? <span className="cal-note"> · {e.note}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  /** Admin card on the Season page: the rules of the season being viewed. */
  function renderSeasonRulesCard(year) {
    const rules = rulesForSeason(sysState, year);
    const editing = rulesDraft && rulesDraft.year === year;
    const d = editing ? rulesDraft : null;
    const valid =
      d &&
      Number.isInteger(Number(d.bestOf)) && Number(d.bestOf) >= 1 &&
      Number.isInteger(Number(d.cutoffR32)) && Number(d.cutoffR32) >= 1 &&
      Number.isInteger(Number(d.cutoffR48)) && Number(d.cutoffR48) >= Number(d.cutoffR32);
    return (
      <div className="control-sub-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong>Σεζόν {sn(year)} — κανόνες Βαθμολογίας</strong>
          {!editing && !seasonLocked(sysState, year) && (
            <button className="btn-ghost" onClick={() => setRulesDraft({ year, bestOf: rules.bestOf, cutoffR32: rules.cutoffR32, cutoffR48: rules.cutoffR48 })}>
              <Pencil size={13} /> Αλλαγή
            </button>
          )}
        </div>
        {!editing ? (
          <>
            <p style={{ margin: "6px 0 0 0", fontSize: 14 }}>
              Μετράνε τα <strong>{rules.bestOf}</strong> καλύτερα αποτελέσματα. 1η θέση: Παίκτης της Χρονιάς και πρόκριση στους 32 · θέσεις 2–{rules.cutoffR32}: πρόκριση στους 32 · θέσεις {rules.cutoffR32 + 1}–{rules.cutoffR48}: πρόκριση στους 48.
            </p>
            {rules.inherited && (
              <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "var(--muted)" }}>
                {rules.from ? `Δεν έχουν οριστεί ακόμα κανόνες για το ${sn(year)}· ισχύουν όσοι της σεζόν ${sn(rules.from)}.` : "Δεν έχουν οριστεί ακόμα κανόνες· ισχύουν οι αρχικοί."} Όρισέ τους όταν βγει η προκήρυξη.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="row" style={{ marginTop: 10 }}>
              <div style={{ width: 150 }}>
                <label>Καλύτερα αποτελέσματα</label>
                <input type="number" min={1} value={d.bestOf} onChange={(e) => setRulesDraft({ ...d, bestOf: e.target.value })} />
              </div>
              <div style={{ width: 170 }}>
                <label>Πρόκριση στους 32 έως θέση</label>
                <input type="number" min={1} value={d.cutoffR32} onChange={(e) => setRulesDraft({ ...d, cutoffR32: e.target.value })} />
              </div>
              <div style={{ width: 170 }}>
                <label>Πρόκριση στους 48 έως θέση</label>
                <input type="number" min={1} value={d.cutoffR48} onChange={(e) => setRulesDraft({ ...d, cutoffR48: e.target.value })} />
              </div>
            </div>
            {!valid && <p className="field-warning">Ακέραιοι ≥ 1, και η θέση για τους 48 όχι μικρότερη από τη θέση για τους 32.</p>}
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0 0 0" }}>
              Αφορά μόνο τη σεζόν {sn(year)}. Οι άλλες σεζόν δεν αλλάζουν. Δεν χρειάζεται Recompute: η Βαθμολογία υπολογίζεται αμέσως με τους νέους κανόνες.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn-secondary" onClick={() => setRulesDraft(null)}>Άκυρο</button>
              <button className="btn-primary" disabled={!valid} onClick={saveSeasonRules}>Αποθήκευση</button>
            </div>
          </>
        )}
      </div>
    );
  }

  async function saveSeasonRules() {
    if (!rulesDraft) return;
    const year = rulesDraft.year;
    const next = {
      bestOf: Number(rulesDraft.bestOf),
      cutoffR32: Number(rulesDraft.cutoffR32),
      cutoffR48: Number(rulesDraft.cutoffR48),
      setAt: new Date().toISOString(),
    };
    // Pin the rules of every earlier season that is still only inheriting,
    // so that rules set for this season can never change a past one.
    const all = { ...(sysState.seasonRules || {}) };
    let years = [];
    try {
      years = await listSeasonYearsStrict();
    } catch {
      reportSaveFailure("Κανόνες σεζόν — η λίστα σεζόν δεν διαβάστηκε· οι κανόνες δεν αποθηκεύτηκαν");
      return;
    }
    const ruleComp = seasonCompetitionId(sysState, year);
    years.filter((y) => y < year && !all[String(y)] && seasonCompetitionId(sysState, y) === ruleComp).forEach((y) => {
      const r = rulesForSeason({ ...sysState, seasonRules: all }, y);
      all[String(y)] = { bestOf: r.bestOf, cutoffR32: r.cutoffR32, cutoffR48: r.cutoffR48, setAt: next.setAt };
    });
    all[String(year)] = next;
    if (await saveSysState({ seasonRules: all })) {
      setSysState((st) => ({ ...st, seasonRules: all }));
      setRulesDraft(null);
      showToast(`Οι κανόνες της σεζόν ${sn(year)} αποθηκεύτηκαν.`);
    } else {
      reportSaveFailure(`Κανόνες σεζόν ${sn(year)} — δεν αποθηκεύτηκαν`);
    }
  }
  // #endregion Σεζόν & ημερολόγιο

  // #region Βοηθητικά οθονών: επιστροφή σε παίκτη, tab «Στοιχεία» τουρνουά
  /** Way back to the player card the tournament was opened from. */
  function renderBackToPlayer() {
    if (!tournamentReturnPlayer || !registry.players[tournamentReturnPlayer]) return null;
    return (
      <div style={{ marginBottom: 12 }}>
        <button className="btn-secondary" onClick={backToPlayer}>
          <ArrowLeft size={15} /> Πίσω στον παίκτη ({registry.players[tournamentReturnPlayer].name})
        </button>
      </div>
    );
  }

  /** The "Στοιχεία" tab: everything about the tournament in one place —
   * what it is, where it counts, and (admin) the actions on it. */
  function renderTournamentDetailsTab() {
    const comps = competitionsFrom(sysState);
    const comp = comps.find((c) => c.id === competitionId);
    const matchesPlayed = history.reduce((n, h) => n + h.pairs.filter((p) => p.result).length, 0);
    const counts = countsTowardRatings({ isOfficial, competitionId });
    const rows = [
      ["Όνομα", tournamentName || "—"],
      ["Ημερομηνία", createdAt ? formatDate(createdAt) : "—"],
      ["Σεζόν", sn(seasonYear)],
      ["Διοργάνωση", comp ? `${comp.name} — ${COMPETITION_LEVEL_LABEL[comp.level] || comp.level}` : competitionName(comps, competitionId)],
      ["Σύλλογος της διοργάνωσης", (() => { const c = competitionById(competitionId); return c && c.ownerClubId ? clubDisplay(sysState, c.ownerClubId, "—") : "—"; })()],
      ["Κατάσταση", phase === "finished" ? "Ολοκληρώθηκε" : `Σε εξέλιξη — γύρος ${round} από ${totalRounds}`],
      ["Γύροι", totalRounds],
      ["Μήκος αγώνα", `${matchLength} πόντοι`],
      ["Παίκτες", players.length],
      ["Αγώνες με αποτέλεσμα", matchesPlayed],
      ["Επίσημο", isOfficial ? "Ναι (Official League day)" : "Όχι (δοκιμαστικό)"],
      ["Μετράει σε ELO και Βαθμολογία", counts ? "Ναι" : isOfficial ? "Όχι — μετράει μόνο η Premier League προς το παρόν" : "Όχι — δεν είναι επίσημο"],
    ];
    return (
      <div className="details-tab">
        {isAdmin && seasonLocked(sysState, seasonYear) && (
          <div className="card details-card" style={{ borderLeft: "4px solid #9a5b00" }}>
            <strong>Η σεζόν {sn(seasonYear)} είναι κλειδωμένη 🔒</strong>
            {lockOverrideId === tournamentId ? (
              <p style={{ fontSize: 13, margin: "6px 0 0 0" }}>Επιτρέπονται αλλαγές σε αυτό το τουρνουά μέχρι να ανοίξεις άλλο. Μετά από αλλαγή, τρέξε Recompute.</p>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "var(--muted)", margin: "6px 0 8px 0" }}>Τα αποτελέσματα και τα στοιχεία του προστατεύονται. Για διόρθωση λάθους, ξεκλείδωσε τις αλλαγές μόνο για αυτό το τουρνουά.</p>
                {!lockAction && (
                  <button className="btn-secondary" onClick={() => { setLockAction({ kind: "tournament", year: seasonYear }); setLockTyped(""); }}>
                    Ξεκλείδωμα αλλαγών σε αυτό το τουρνουά…
                  </button>
                )}
                {renderLockPrompt("tournament", seasonYear, "Οι αλλαγές θα επιτρέπονται μόνο σε αυτό το τουρνουά και μόνο μέχρι να ανοίξεις άλλο.")}
              </>
            )}
          </div>
        )}
        {!metaEdit && (
          <div className="card details-card">
            <div className="details-head">
              <strong>Στοιχεία τουρνουά</strong>
              {isAdmin && (
                <button className="btn-secondary" onClick={() => tournamentEditable() && startMetaEdit()}>
                  <Pencil size={14} /> Αλλαγή στοιχείων
                </button>
              )}
            </div>
            <dl className="details-list">
              {rows.map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        )}

        {isAdmin && metaEdit && (
          <div className="card details-card">
            <strong>Αλλαγή στοιχείων</strong>
            <div className="row" style={{ marginTop: 10 }}>
              <div style={{ width: 160 }}>
                <label>Ημερομηνία</label>
                <input
                  type="date"
                  value={metaEdit.date}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setMetaEdit({ ...metaEdit, date: e.target.value });
                  }}
                />
              </div>
              <div style={{ width: 160 }}>
                <label>Σεζόν</label>
                {renderSeasonSelect(metaEdit.competitionId, metaEdit.seasonYear, (v) => setMetaEdit({ ...metaEdit, seasonYear: v }))}
              </div>
              <div style={{ width: 220 }}>
                <label>Διοργάνωση</label>
                <select
                  value={metaEdit.competitionId}
                  onChange={(e) => setMetaEdit({ ...metaEdit, competitionId: e.target.value, seasonYear: currentSeasonId(sysState, e.target.value, controlSeasons) })}
                  style={{ width: "100%", fontFamily: "'Source Sans 3', sans-serif", fontSize: 15, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 7, background: "#fff" }}
                >
                  {comps.map((c) => (
                    <option key={c.id} value={c.id}>{competitionLabel(sysState, c)}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Σύλλογος της διοργάνωσης</label>
                <div style={{ padding: "9px 0", fontSize: 15, color: "var(--muted)" }}>
                  {(() => {
                    const c = competitionById(metaEdit.competitionId);
                    return c && c.ownerClubId ? clubDisplay(sysState, c.ownerClubId, "—") : "—";
                  })()}
                </div>
              </div>
            </div>
            {isOfficial && (phase === "finished" || history.length > 0) && (
              <p style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0 0 0" }}>
                Το τουρνουά μετράει ήδη σε ELO/Βαθμολογία. Αν αλλάξεις ημερομηνία, σεζόν ή διοργάνωση, τρέξε μετά Recompute.
              </p>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn-secondary" onClick={() => setMetaEdit(null)}>Άκυρο</button>
              <button className="btn-primary" onClick={saveTournamentMeta}>Αποθήκευση</button>
            </div>
          </div>
        )}

        {isAdmin && (
          <div className="card details-card">
            <strong>Επίσημο τουρνουά</strong>
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "6px 0 10px 0" }}>
              Μόνο τα επίσημα τουρνουά μετράνε στο Recompute ELO και Βαθμολογίας. Η αλλαγή ζητά επιβεβαίωση.
            </p>
            <button className="btn-secondary" onClick={() => tournamentEditable() && setConfirmingOfficial(true)}>
              {isOfficial ? <Check size={14} color="var(--win)" /> : <X size={14} />} {isOfficial ? "Επίσημο — κάνε το δοκιμαστικό" : "Δοκιμαστικό — κάνε το επίσημο"}
            </button>
          </div>
        )}

        {isAdmin && (
          <div className="card details-card">
            <strong>Μετακίνηση στον κάδο</strong>
            <div style={{ marginTop: 10 }}>
              <MoveToTrashControl
                confirming={confirmingDelete}
                onStart={() => tournamentEditable() && setConfirmingDelete(true)}
                onCancel={() => setConfirmingDelete(false)}
                onConfirm={confirmDeleteTournament}
                isOfficial={isOfficial}
                name={tournamentName}
                playersCount={players.length}
                matchesCount={matchesPlayed}
                busy={trashBusy}
              />
            </div>
          </div>
        )}
      </div>
    );
  }
  // #endregion Βοηθητικά οθονών: επιστροφή σε παίκτη, tab «Στοιχεία» τουρνουά

  /* ---------------------------------------------------------------------- */
  /* Render                                                                 */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="app">
      {/* #region Στυλ (CSS) */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Source+Sans+3:wght@400;500;600;700&display=swap');

        :root {
          --bg: #F4ECDD;
          --surface: #FFFCF5;
          --ink: #1E140A;
          --muted: #6E5D48;
          --accent: #7C2D2D;
          --accent-soft: #F1DED2;
          --border: #D8C4A0;
          --win: #1F5C34;
          --loss: #7A3B3B;
        }
        * { box-sizing: border-box; }
        .app { background: var(--bg); color: var(--ink); font-family: 'Source Sans 3', system-ui, sans-serif; min-height: 100%; width: 100%; }

        .topbar { display: flex; justify-content: space-between; align-items: center; padding: 14px 28px; border-bottom: 1px solid var(--border); }
        .brand { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; letter-spacing: 0.02em; color: var(--accent); }
        .role-toggle { display: flex; gap: 2px; background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 3px; }

        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 200; }
        .modal-card { background: var(--surface); border-radius: 12px; padding: 24px; width: 320px; max-width: 90vw; box-shadow: 0 12px 32px rgba(0,0,0,0.25); }
        .role-btn { border: none; background: none; padding: 6px 12px; border-radius: 17px; font-size: 12px; font-weight: 600; color: var(--muted); }
        .role-btn.active { background: var(--accent); color: #fff; }

        .header { padding: 24px 28px 0 28px; }
        .eyebrow { font-size: 13px; color: var(--muted); margin: 0 0 4px 0; }
        h1 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 30px; margin: 0; line-height: 1.15; }
        .round-tag { font-family: 'Fraunces', serif; font-size: 16px; color: var(--accent); }
        .points-strip { display: flex; margin: 18px 0 0 0; height: 22px; overflow: hidden; }
        .point { width: 16px; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; margin-right: 1px; flex-shrink: 0; }
        .point.down.a { border-top: 22px solid var(--accent); }
        .point.down.b { border-top: 22px solid var(--ink); opacity: 0.5; }
        .point.up.a { border-bottom: 22px solid var(--accent); }
        .point.up.b { border-bottom: 22px solid var(--ink); opacity: 0.5; }

        .content { padding: 24px 28px 60px 28px; max-width: 1180px; margin: 0 auto; }
        .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-bottom: 16px; }

        label { font-size: 13px; color: var(--muted); display: block; margin-bottom: 6px; }
        input[type="text"], input[type="number"], input[type="date"] {
          font-family: 'Source Sans 3', sans-serif; font-size: 15px; padding: 9px 12px;
          border: 1px solid var(--border); border-radius: 7px; background: #fff; color: var(--ink); width: 100%;
        }
        textarea {
          font-family: 'Source Sans 3', sans-serif; font-size: 14px; padding: 9px 12px;
          border: 1px solid var(--border); border-radius: 7px; background: #fff; color: var(--ink); width: 100%; resize: vertical;
        }
        input:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }

        .row { display: flex; gap: 10px; align-items: flex-end; }
        .field { flex: 1; }

        button {
          font-family: 'Source Sans 3', sans-serif; font-weight: 600; font-size: 14px; border-radius: 7px;
          border: 1px solid transparent; padding: 10px 16px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
          transition: transform 0.08s ease, opacity 0.15s ease;
        }
        button:active { transform: scale(0.98); }
        button:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-primary { background: var(--accent); color: #fff; }
        .btn-primary:hover:not(:disabled) { opacity: 0.9; }
        .btn-secondary { background: var(--surface); color: var(--ink); border-color: var(--border); }
        .btn-secondary:hover:not(:disabled) { background: var(--accent-soft); }
        .btn-ghost { background: transparent; color: var(--muted); border: none; padding: 4px 6px; font-size: 13px; }
        .btn-ghost:hover { color: var(--accent); }

        .player-list { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
        .player-chip { display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; background: #fff; border: 1px solid var(--border); border-radius: 7px; font-size: 15px; }

        .tabs { display: flex; gap: 4px; margin-bottom: 18px; border-bottom: 1px solid var(--border); }
        .tab { background: none; border: none; padding: 10px 4px; margin-right: 18px; font-size: 15px; font-weight: 600; color: var(--muted); border-bottom: 2px solid transparent; border-radius: 0; }
        .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
        .tab:hover:not(.active) { color: var(--ink); }

        .bye-card { background: var(--accent-soft); border: 1px solid var(--border); border-radius: 10px; padding: 14px 18px; margin-bottom: 14px; font-size: 14px; display: flex; align-items: center; gap: 10px; }

        .round-pills { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
        .round-pill { background: var(--surface); border: 1px solid var(--border); color: var(--muted); padding: 6px 13px; border-radius: 20px; font-size: 13px; font-weight: 600; }
        .round-pill.active { background: var(--accent); color: #fff; border-color: var(--accent); }
        .round-pill:hover:not(.active) { background: var(--accent-soft); color: var(--ink); }
        .live-toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); margin-bottom: 14px; cursor: pointer; }
        .live-toggle input { width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer; }
        .membership-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 13px; }
        .membership-row select { font-family: 'Source Sans 3', sans-serif; font-size: 13px; padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; background: #fff; }
        .needs-info-badge { font-size: 11px; font-weight: 700; color: var(--accent); }

        .qual-legend { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; margin-bottom: 16px; }
        .qual-row { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; flex-wrap: nowrap; padding: 8px 14px; border-radius: 6px; color: #000; font-weight: 500; width: fit-content; max-width: 100%; box-sizing: border-box; }
        .qual-row.qual-tier1 { background: #00FFFF; }
        .qual-row.qual-tier2 { background: #FF00FF; }
        .qual-row.qual-tier3 { background: #00FF00; }
        tr.qual-tier1 td { background: #00FFFF; color: #000; }
        tr.qual-tier2 td { background: #FF00FF; color: #000; }
        tr.qual-tier3 td { background: #00FF00; color: #000; }
        .th-sub { font-weight: 400; font-size: 10px; color: var(--muted); text-transform: none; }
        .entry-breakdown { display: flex; gap: 10px; align-items: center; font-size: 12px; color: var(--muted); }
        .entry-breakdown strong { color: var(--ink); font-size: 13px; }

        .finance-summary { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
        .finance-stat { flex: 1; min-width: 120px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
        .finance-stat-label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
        .finance-stat-value { font-family: 'Fraunces', serif; font-size: 22px; color: var(--accent); }
        .finance-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
        .finance-row:last-child { border-bottom: none; }
        .prize-badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 20px; background: var(--accent-soft); color: var(--accent); margin-right: 8px; }
        .prize-badge.win { background: var(--win); color: #fff; }
        .prize-badge.side { background: var(--border); color: var(--ink); }
        .winners-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
        .winners-col-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0 0 8px 0; }
        @media (max-width: 600px) { .winners-columns { grid-template-columns: 1fr; } }

        .wins-highlight { display: inline-block; min-width: 26px; font-family: 'Fraunces', serif; font-weight: 700; font-size: 16px; color: var(--accent); background: var(--accent-soft); border-radius: 6px; padding: 2px 8px; }
        .buchholz-header { color: var(--muted); font-weight: 400; }
        .buchholz-cell { color: var(--muted); font-size: 13px; }

        .delete-control { display: flex; justify-content: flex-end; margin-bottom: 12px; }
        .recompute-panel { display: flex; justify-content: space-between; align-items: center; gap: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 18px; margin-bottom: 20px; flex-wrap: wrap; }
        .delete-confirm { display: flex; justify-content: space-between; align-items: center; gap: 12px; background: var(--accent-soft); border: 1px solid var(--accent); border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; font-size: 14px; flex-wrap: wrap; }

        .name-dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0; max-height: 220px; overflow-y: auto; background: #fff; border: 1px solid var(--border); border-radius: 7px; box-shadow: 0 6px 16px rgba(0,0,0,0.12); z-index: 20; }
        .name-dropdown-option { padding: 8px 12px; font-size: 14px; cursor: pointer; }
        .name-dropdown-option:hover { background: var(--accent-soft); }

        .match-card { padding: 18px 22px; }

        /* Compact pairings grid — dense, scan-friendly view for big-screen
           display during the live tournament day, and for the archive. */
        .pairings-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px; margin-top: 4px; }
        .match-compact { border: 1px solid var(--border); border-left: 5px solid var(--border); border-radius: 7px; background: var(--surface); padding: 8px 14px; }
        .match-compact.decided { border-left-color: var(--win); }
        .match-compact.clickable { cursor: pointer; }
        .match-compact.clickable:hover { background: var(--accent-soft); }
        .match-compact-num { font-size: 11px; font-weight: 700; color: var(--muted); letter-spacing: 0.03em; margin-bottom: 2px; }
        .match-row-name { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; font-size: 16px; font-weight: 700; color: var(--ink); }
        .match-row-score { font-family: 'Fraunces', serif; font-size: 15px; font-weight: 700; min-width: 18px; text-align: right; color: var(--muted); }
        .match-row-name.winner .match-row-score { color: var(--win); }
        .match-row-name.loser .match-row-score { color: var(--loss); }
        .match-row-name.winner { color: var(--win); background: rgba(31, 92, 52, 0.14); border-radius: 5px; padding: 4px 8px; margin: 2px -4px; }
        .match-row-name.loser { color: var(--loss); opacity: 0.8; }
        .match-row-tag { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }
        .match-expand { margin-top: 8px; border-top: 1px dashed var(--border); padding-top: 8px; }
        .match-names { display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 4px; }
        .match-name {
          font-family: 'Fraunces', serif; font-weight: 700; font-size: 20px; text-align: center; flex: 1;
          padding: 6px 10px; border-radius: 6px; background: rgba(255,255,255,0.5);
        }
        .match-name.winner { color: var(--accent); background: var(--accent-soft); }
        .match-name.loser { color: var(--muted); }
        .match-vs { color: var(--muted); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }

        .win-prob { margin: 6px 0 12px 0; }
        .win-prob-bar { height: 8px; border-radius: 4px; background: var(--accent-soft); overflow: hidden; }
        .win-prob-fill { height: 100%; background: var(--accent); border-radius: 4px 0 0 4px; transition: width 0.2s ease; }
        .win-prob-labels { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: 4px; font-weight: 600; }
        .win-prob-headline { font-size: 13px; margin: 0 0 6px 0; color: var(--ink); }
        .win-prob-pct { color: var(--accent); font-weight: 700; }

        .elo-snapshot { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
        .elo-snapshot-stat { flex: 1; min-width: 90px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
        .history-table { display: flex; flex-direction: column; gap: 2px; }
        .history-row { display: flex; justify-content: space-between; font-size: 13px; padding: 6px 4px; border-bottom: 1px solid var(--border); }
        .history-row:last-child { border-bottom: none; }

        .detail-tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
        .detail-tab { padding: 8px 16px; font-size: 13px; font-weight: 600; color: var(--muted); background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; }
        .detail-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
        .detail-tab:hover:not(.active) { color: var(--ink); }

        .trend-chart-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0 0 6px 0; }
        .trend-charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 10px; }
        .trend-chart-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
        .axis-chart-svg { width: 100%; height: 220px; display: block; }
        @media (max-width: 700px) { .trend-charts-grid { grid-template-columns: 1fr; } }

        .match-actions { display: flex; gap: 10px; margin-top: 14px; }
        .match-actions button { flex: 1; justify-content: center; }
        .retire-row { display: flex; justify-content: space-between; margin-top: 8px; }
        .result-line { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); font-size: 14px; }
        .result-line.pending { color: var(--muted); font-style: italic; border-top: 1px solid var(--border); justify-content: center; }
        .result-text { display: flex; align-items: center; gap: 6px; }

        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        th { text-align: left; color: var(--muted); font-weight: 600; font-size: 12px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
        td { padding: 9px 10px; border-bottom: 1px solid var(--border); }
        tr:last-child td { border-bottom: none; }
        .rank { color: var(--muted); width: 32px; }
        .withdrawn-tag { font-size: 12px; color: var(--muted); display: flex; align-items: center; }
        .active-toggle { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; }
        .active-toggle input { display: none; }
        .active-toggle-slider { position: relative; width: 30px; height: 16px; background: var(--border); border-radius: 10px; transition: background 0.15s ease; flex-shrink: 0; }
        .active-toggle-slider::before { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform 0.15s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.3); }
        .active-toggle input:checked + .active-toggle-slider { background: var(--win); }
        .active-toggle input:checked + .active-toggle-slider::before { transform: translateX(14px); }
        .active-toggle input:disabled + .active-toggle-slider { opacity: 0.45; cursor: not-allowed; }
        .active-toggle-label { font-size: 12px; font-weight: 700; color: var(--ink); }
        .round-cell { font-size: 15px; font-weight: 700; }
        .round-cell.win { color: var(--win); }
        .round-cell.loss { color: var(--loss); }
        .round-cell.bye { color: var(--muted); font-size: 11px; }
        .round-cell.muted { color: var(--border); }
        .standings-name { font-weight: 700; font-size: 15px; color: var(--ink); }

        .notice { display: flex; gap: 8px; align-items: flex-start; background: #fff; border: 1px solid var(--border); border-radius: 7px; padding: 10px 14px; font-size: 13px; color: var(--muted); margin-bottom: 16px; }
        .footer-actions { display: flex; gap: 10px; margin-top: 22px; flex-wrap: wrap; }

        .winner-banner { text-align: center; padding: 30px 20px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 20px; }
        .winner-banner .trophy { color: var(--accent); margin-bottom: 8px; }
        .winner-banner .name { font-family: 'Fraunces', serif; font-size: 30px; margin: 6px 0 2px 0; }
        .winner-banner .sub { color: var(--muted); font-size: 14px; }

        .archive-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 2px; border-bottom: 1px solid var(--border); cursor: pointer; }
        .archive-row:hover .archive-name { text-decoration: underline; }
        .archive-name { color: var(--accent); font-weight: 600; }
        .archive-meta { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--muted); }
        .status-chip { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 20px; }
        .status-chip.live { background: var(--accent-soft); color: var(--accent); }
        .status-chip.done { background: #E7EBE4; color: var(--win); }
        .status-chip.test { background: var(--border); color: var(--muted); }
        .filters { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
        .filters .field { min-width: 150px; }
        .empty-state { text-align: center; color: var(--muted); padding: 30px 0; font-size: 14px; }

        .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
        .dashboard-card { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 22px; text-align: left; color: var(--accent); cursor: pointer; transition: transform 0.12s ease, box-shadow 0.12s ease; }
        .dashboard-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.08); background: var(--accent-soft); }
        .dashboard-card-title { font-family: 'Fraunces', serif; font-size: 19px; font-weight: 600; color: var(--ink); }
        .dashboard-card-desc { font-size: 13px; color: var(--muted); font-weight: 400; }

        .toast { position: fixed; top: 24px; left: 50%; transform: translateX(-50%); background: var(--ink); color: #fff; padding: 12px 20px; border-radius: 30px; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.25); z-index: 100; animation: toast-in 0.2s ease; }
        .save-failure-banner { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 1001; display: flex; gap: 10px; align-items: flex-start; width: min(720px, calc(100% - 24px)); background: #fff4f2; color: #7a1d12; border: 2px solid #c0392b; border-radius: 10px; padding: 12px 14px; font-size: 14px; box-shadow: 0 6px 24px rgba(0,0,0,0.18); }
        .history-link { background: none; border: none; padding: 0; font: inherit; color: var(--accent); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; text-align: left; }
        .history-link:hover { color: var(--ink); }
        .control-section { padding: 16px 20px; margin-bottom: 16px; }
        .control-season { margin-top: 6px; }
        .control-tabs { flex-wrap: wrap; row-gap: 4px; }
        .lock-prompt { border: 1px solid #9a5b00; background: #fff8ec; border-radius: 8px; padding: 10px 12px; margin-top: 10px; }
        .close-steps { margin: 6px 0 0 0; padding-left: 20px; display: grid; gap: 8px; font-size: 14px; }
        .close-steps li.done { color: var(--win); }
        .ledger-table td.pos { color: var(--win); }
        .ledger-btn { padding: 4px 6px; }
        .status-chip.imported { background: #eef3fb; color: #2f5a8a; border: 1px solid #c9d8ec; }
        .layout-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin: 0 0 14px 0; }
        .layout-toggle button { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border: none; background: var(--surface, #fff); color: var(--ink); font: inherit; font-size: 14px; cursor: pointer; }
        .layout-toggle button + button { border-left: 1px solid var(--border); }
        .layout-toggle button.active { background: var(--accent); color: #fff; font-weight: 600; }
        .layout-toggle.mini { margin: 0; }
        .xs-wrap { overflow: auto; max-height: 78vh; border: 1px solid var(--border); border-radius: 8px; background: #fff; }
        .xs-table { border-collapse: collapse; font-size: 12px; font-family: Arial, sans-serif; }
        .xs-table th { position: sticky; top: 0; background: #f3f3f3; color: #666; font-weight: 500; border: 1px solid #ddd; padding: 2px 4px; z-index: 1; }
        .xs-table tbody th { position: sticky; left: 0; z-index: 1; text-align: right; min-width: 28px; }
        .xs-table .xs-corner { left: 0; z-index: 2; }
        .xs-table td { border: 1px solid #e6e6e6; padding: 2px 5px; white-space: nowrap; height: 20px; color: #222; }
        .xs-table td.b { font-weight: 700; }
        .xs-table td.mark { background: #ffe8a3; }
        .bt-wrap { overflow: auto; max-height: 78vh; border: 1px solid var(--border); border-radius: 10px; background: var(--surface, #fff); padding: 10px; }
        .bt-canvas { position: relative; }
        .bt-col-head { position: absolute; top: 0; font-size: 12px; font-weight: 700; color: var(--muted); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bt-lines { position: absolute; left: 0; top: 0; pointer-events: none; }
        .bt-lines path { fill: none; stroke: var(--border); stroke-width: 1.5; }
        .bt-lines path.on { stroke: var(--accent); stroke-width: 3; }
        .bt-box { position: absolute; border: 1px solid var(--border); border-radius: 7px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.05); display: flex; flex-direction: column; justify-content: center; padding: 0 6px; }
        .bt-box.hl { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
        .bt-line { display: flex; align-items: center; gap: 5px; font-size: 12.5px; line-height: 21px; cursor: pointer; color: var(--muted); }
        .bt-line.win { color: var(--ink); font-weight: 700; }
        .bt-line.me .bt-name { background: var(--accent-soft); border-radius: 4px; padding: 0 3px; }
        .bt-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bt-tag { font-size: 10px; font-weight: 600; color: #2f5a8a; background: #eef3fb; border-radius: 4px; padding: 0 4px; line-height: 16px; }
        .bt-score { font-variant-numeric: tabular-nums; min-width: 26px; text-align: right; }
        .bt-no { position: absolute; top: -9px; right: 6px; font-size: 10px; color: var(--muted); background: #fff; padding: 0 3px; }
        .layout-toggle.mini button { padding: 3px 9px; font-size: 12px; }
        .pairings-list td { padding: 7px 8px; font-size: 15px; }
        .pairings-list .pl-name { width: 40%; }
        .pairings-list .pl-win { font-weight: 700; }
        .pairings-list .pl-lose { color: var(--muted); }
        .pairings-list .pl-score { text-align: center; white-space: nowrap; width: 110px; }
        .pl-score-btn { border: 1px dashed var(--border); background: transparent; border-radius: 6px; padding: 3px 10px; font: inherit; font-variant-numeric: tabular-nums; cursor: pointer; color: var(--ink); }
        .pl-score-btn:hover, .pl-score-btn.active { border-style: solid; border-color: var(--accent); background: var(--accent-soft); }
        .pairings-list tr.pl-edit > td { background: var(--accent-soft); }
        .ledger-btn.active { background: var(--accent-soft); color: var(--accent); }
        .ledger-row > td { background: var(--accent-soft); padding: 12px 14px; }
        .ledger-table td.neg { color: var(--loss, #b03a2e); }
        .scope-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; font-size: 14px; color: var(--muted); }
        .cal-table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .cal-table th { text-align: left; font-size: 12px; color: var(--muted); font-weight: 600; padding: 4px 8px; border-bottom: 1px solid var(--border); }
        .cal-table td { padding: 5px 8px; border-bottom: 1px solid var(--border); }
        .cal-table tr.cal-done td { color: var(--muted); }
        .cal-table tr.cal-live td { font-weight: 700; }
        .cal-table tr.cal-missed td { color: #9a5b00; }
        .cal-note { color: var(--muted); font-size: 13px; }
        .control-h { font-size: 19px; margin: 0 0 8px 0; }
        .control-sub { font-size: 13px; color: var(--muted); margin: 0 0 10px 0; }
        .control-sub-card { border-top: 1px solid var(--border); padding-top: 12px; margin-top: 12px; }
        .control-sub-card:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
        .control-danger { border: 2px solid #c0392b; }
        .details-tab { display: grid; gap: 14px; max-width: 760px; }
        .details-card { padding: 16px 20px; margin: 0; }
        .details-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
        .details-list { display: grid; grid-template-columns: max-content 1fr; gap: 7px 22px; margin: 0; font-size: 15px; }
        .details-list dt { color: var(--muted); }
        .details-list dd { margin: 0; font-weight: 600; color: var(--ink); }
        @media (max-width: 520px) { .details-list { grid-template-columns: 1fr; gap: 2px; } .details-list dd { margin-bottom: 8px; } }
        .field-warning { font-size: 13px; color: #9a5b00; margin: 6px 0 0 0; }
        @keyframes toast-in { from { opacity: 0; transform: translate(-50%, -10px); } to { opacity: 1; transform: translate(-50%, 0); } }
      `}</style>
      {/* #endregion Στυλ (CSS) */}

      {/* #region Ειδοποιήσεις, πλαίσια σφαλμάτων, διάλογοι επιβεβαίωσης */}
      {toast && (
        <div className="toast">
          <Check size={16} color="var(--win)" />
          {toast}
        </div>
      )}

      {isAdmin && recomputeLockConflict && (
        <div className="save-failure-banner" role="alert" style={{ background: "#fff8ec", borderColor: "#9a5b00", color: "#5a3a00", bottom: saveFailures.length > 0 || startupReadFailed ? 140 : 16 }}>
          <Lock size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: "0 0 8px 0" }}>
              <strong>Το Recompute θα άλλαζε τη Βαθμολογία της κλειδωμένης σεζόν {recomputeLockConflict.years.map(sn).join(", ")}.</strong> Δεν γράφτηκε τίποτα ακόμα. Συνέχισε μόνο αν η αλλαγή οφείλεται σε διόρθωση που έκανες σκόπιμα.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-secondary" onClick={() => setRecomputeLockConflict(null)}>Ακύρωση</button>
              <button
                className="btn-primary"
                onClick={() => {
                  const c = recomputeLockConflict;
                  setRecomputeLockConflict(null);
                  recomputeEloAndSeasonFromScratch(c.indexOverride || undefined, { allowLocked: true });
                }}
              >
                Συνέχεια παρά το κλείδωμα
              </button>
            </div>
          </div>
        </div>
      )}

      {(startupReadFailed || saveFailures.length > 0) && (
        <div className="save-failure-banner" role="alert">
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            {startupReadFailed && (
              <p style={{ margin: 0 }}>
                <strong>Τα δεδομένα δεν φορτώθηκαν από τη βάση.</strong> Ανανέωσε τη σελίδα. Μέχρι τότε η εφαρμογή δεν αποθηκεύει μητρώο, ELO ή κατάλογο τουρνουά, ώστε να μην αντικατασταθούν τα πραγματικά δεδομένα με κενά.
              </p>
            )}
            {saveFailures.length > 0 && (
              <>
                <p style={{ margin: startupReadFailed ? "8px 0 4px 0" : "0 0 4px 0" }}><strong>Δεν αποθηκεύτηκαν:</strong></p>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {saveFailures.map((f) => (
                    <li key={f.what}>
                      {f.what} <span style={{ opacity: 0.75 }}>({new Date(f.at).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" })})</span>
                    </li>
                  ))}
                </ul>
                <p style={{ margin: "6px 0 0 0", fontSize: 13 }}>Έλεγξε τη σύνδεση και επανάλαβε την ενέργεια.</p>
              </>
            )}
          </div>
          {saveFailures.length > 0 && (
            <button className="btn-ghost" onClick={() => setSaveFailures([])} title="Απόκρυψη">
              <X size={15} />
            </button>
          )}
        </div>
      )}

      {identityPrompt && (
        <ConfirmDialog
          title="Είναι ο ίδιος παίκτης;"
          actions={
            <>
              <button className="btn-secondary" onClick={() => setIdentityPrompt(null)}>Άκυρο</button>
              <button className="btn-secondary" onClick={() => { setIdentityPrompt(null); addPlayerCore({ createNew: true }); }}>Όχι, νέο πρόσωπο</button>
            </>
          }
        >
          <p style={{ margin: "0 0 10px 0" }}>
            Το όνομα «<strong>{identityPrompt.typed}</strong>» μοιάζει με πρόσωπο που υπάρχει ήδη στο μητρώο. Αν είναι ο ίδιος παίκτης, το ιστορικό του μένει ενωμένο.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {identityPrompt.candidates.map((c) => (
              <button key={c.key} className="btn-primary" onClick={() => { setIdentityPrompt(null); addPlayerCore({ linkKey: c.key }); }}>
                Ναι, είναι ο/η {c.person.name}
              </button>
            ))}
          </div>
        </ConfirmDialog>
      )}

      {confirmingOfficial && (
        <ConfirmDialog
          title={isOfficial ? "Αλλαγή σε δοκιμαστικό τουρνουά" : "Αλλαγή σε επίσημο τουρνουά"}
          actions={
            <>
              <button className="btn-secondary" onClick={() => setConfirmingOfficial(false)}>Άκυρο</button>
              <button className="btn-primary" onClick={() => confirmOfficialToggle(officialRecompute)}>
                {isOfficial ? "Αλλαγή σε δοκιμαστικό" : "Αλλαγή σε επίσημο"}
              </button>
            </>
          }
        >
          {isOfficial ? (
            <>
              <p style={{ margin: "0 0 8px 0" }}>
                Το τουρνουά <strong>παύει να μετράει</strong> στα Στατιστικά αμέσως. Αν έχει ήδη περαστεί στο ELO ή στη Βαθμολογία, μένει εκεί μέχρι το Recompute.
              </p>
              <p style={{ margin: "0 0 8px 0" }}>
                Αυτή η αλλαγή <strong>επηρεάζει τα δεδομένα της Ομοσπονδίας</strong> (Βαθμολογία, ELO, Στατιστικά). Μην την κάνεις σε τουρνουά που έχει παιχτεί κανονικά.
              </p>
            </>
          ) : (
            <>
              <p style={{ margin: "0 0 8px 0" }}>
                Το τουρνουά <strong>αρχίζει να μετράει</strong> στα Στατιστικά, και σε κάθε Recompute στο ELO και στη Βαθμολογία.
              </p>
              <p style={{ margin: "0 0 8px 0" }}>
                Αυτή η αλλαγή <strong>επηρεάζει τα δεδομένα της Ομοσπονδίας</strong>. Βεβαιώσου ότι είναι πραγματικό τουρνουά και όχι τεστ.
              </p>
            </>
          )}
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={officialRecompute} onChange={(e) => setOfficialRecompute(e.target.checked)} />
            Μετά, Recompute του ELO και της Βαθμολογίας
          </label>
        </ConfirmDialog>
      )}
      {/* #endregion Ειδοποιήσεις, πλαίσια σφαλμάτων, διάλογοι επιβεβαίωσης */}

      {/* #region Πάνω μπάρα */}
      {/* TOP BAR */}
      <div className="topbar">
        <div className="brand">
          {phase !== "dashboard" && (
            <button
              className="btn-ghost"
              onClick={() => (phase === "playerDetail" ? setPhase(playerDetailReturnPhase) : goHome())}
              style={{ marginRight: 4 }}
            >
              <ArrowLeft size={15} />
            </button>
          )}
          HELLENIC BACKGAMMON FEDERATION
          <span style={{ fontFamily: "'Source Sans 3', sans-serif", fontWeight: 400, fontSize: 11, color: "var(--muted)", marginLeft: 10, letterSpacing: 0 }}>
            build {APP_BUILD_VERSION}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button className="btn-ghost" onClick={() => { setPhase("about"); dismissWhatsNew(); }} style={{ position: "relative" }}>
            <Info size={14} /> {L.navAbout}
            {hasUnseenUpdate && (
              <span
                style={{
                  position: "absolute", top: -2, right: -6, width: 8, height: 8,
                  borderRadius: "50%", background: "#c0392b", border: "1.5px solid var(--card-bg, #fff)",
                }}
              />
            )}
          </button>
          <button className="btn-ghost" onClick={() => setPhase("archive")}>
            <Trophy size={14} /> {L.navTournaments}
          </button>
          <button className="btn-ghost" onClick={() => setPhase("season")}>
            <TrendingUp size={14} /> {L.navSeason}
          </button>
          <button className="btn-ghost" onClick={() => { setEloPool("club"); setEloLedgerOpen(null); setPhase("elo"); }}>
            <Award size={14} /> {L.navElo}
          </button>
          <button className="btn-ghost" onClick={() => { setEloPool("national"); setEloLedgerOpen(null); setPhase("elo"); }}>
            <Award size={14} /> {L.navEloNational}
          </button>
          <button className="btn-ghost" onClick={() => setPhase("h2h")}>
            <Users size={14} /> {L.navStats}
          </button>
          {isAdmin && (
            <button className="btn-ghost" onClick={() => setPhase("players")}>
              <Users size={14} /> {L.navPlayers}
            </button>
          )}
          {isAdmin && (
            <button className="btn-ghost" onClick={() => { setControlTab("overview"); setPhase("control"); }}>
              <Lock size={14} /> {L.navControl}
            </button>
          )}
          <button className="btn-ghost" onClick={toggleLang} title="Switch language" style={{ fontWeight: 700, fontSize: 12, padding: "4px 10px", border: "1px solid var(--border)", borderRadius: 20 }}>
            {lang === "el" ? "EN" : "ΕΛ"}
          </button>
          {!inIframe && !authUser && (
            <button className="btn-ghost" onClick={() => setShowLogin(true)} style={{ border: "1px solid var(--border)", borderRadius: 20 }}>
              <Lock size={14} /> Σύνδεση
            </button>
          )}
          {!inIframe && authUser && <AccountMenu email={authUser.email || authUser.uid} onSignOut={logoutAdmin} />}
        </div>
      </div>
      {/* #endregion Πάνω μπάρα */}

      {/* #region Σύνδεση: διάλογος και μηνύματα λογαριασμού */}
      {!inIframe && showLogin && !authUser && <LoginDialog onClose={() => setShowLogin(false)} />}
      {!inIframe && authUser && (
        <AccountNotice
          state={authRights}
          uid={authUser.uid}
          onResend={resendVerification}
          onRefresh={refreshVerification}
        />
      )}
      {/* #endregion Σύνδεση: διάλογος και μηνύματα λογαριασμού */}

      {/* #region Οθόνη: Σχετικά (phase "about") */}
      {phase === "about" && (
        <>
          <div className="header">
            <p className="eyebrow">{L.aboutEyebrow}</p>
            <h1>{L.aboutTitle}</h1>
            <div className="tabs" style={{ marginTop: 14 }}>
              <button className={`tab ${aboutTab === "features" ? "active" : ""}`} onClick={() => setAboutTab("features")}>Λειτουργικότητες</button>
              <button className={`tab ${aboutTab === "technical" ? "active" : ""}`} onClick={() => setAboutTab("technical")}>Τεχνικά στοιχεία</button>
              <button className={`tab ${aboutTab === "changelog" ? "active" : ""}`} onClick={() => setAboutTab("changelog")}>Changelog</button>
            </div>
          </div>
          <div className="content" style={{ maxWidth: 640 }}>
            {aboutTab === "features" && (
              <>
                <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 14px 0" }}>build {APP_BUILD_VERSION}</p>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 15, lineHeight: 1.7 }}>
                  {FEATURES_SUMMARY.map((it, idx) => (
                    <li key={idx} style={{ marginBottom: 6 }}>{it}</li>
                  ))}
                </ul>
              </>
            )}
            {aboutTab === "technical" && (
              <div style={{ fontSize: 15, lineHeight: 1.8 }}>
                {TECHNICAL_SUMMARY.map((section, idx) => (
                  <div key={idx} style={{ marginBottom: 20 }}>
                    <p style={{ fontWeight: 700, margin: "0 0 4px 0" }}>{section.title}</p>
                    <p style={{ margin: 0, color: "var(--muted)" }}>{section.body}</p>
                  </div>
                ))}
              </div>
            )}
            {aboutTab === "changelog" && (
              <>
                {changelogFor(isAdmin).map((entry) => (
                  <div key={changelogKey(entry)} style={{ marginBottom: 22 }}>
                    <p style={{ fontWeight: 700, fontSize: 15, margin: "0 0 8px 0" }}>{formatChangelogDate(entry.date)}</p>
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 15, lineHeight: 1.7 }}>
                      {entry.items.map((it, idx) => (
                        <li key={idx} style={{ marginBottom: 6 }}>{it.text}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}
      {/* #endregion Οθόνη: Σχετικά (phase "about") */}

      {/* #region Οθόνη: Στατιστικά (phase "h2h") */}
      {phase === "h2h" && (
        <>
          <div className="header">
            <p className="eyebrow">{L.statsEyebrow}</p>
            <h1>{L.statsTitle}</h1>
            <div className="tabs" style={{ marginTop: 14 }}>
              <button className={`tab ${statsTab === "h2h" ? "active" : ""}`} onClick={() => setStatsTab("h2h")}>Στατιστικά Παίκτη</button>
              <button className={`tab ${statsTab === "streaks" ? "active" : ""}`} onClick={() => setStatsTab("streaks")}>Σερί &amp; Πρωτοπορία</button>
              <button className={`tab ${statsTab === "titles" ? "active" : ""}`} onClick={() => setStatsTab("titles")}>Κατακτήσεις</button>
              <button className={`tab ${statsTab === "season" ? "active" : ""}`} onClick={() => setStatsTab("season")}>Στατιστικά Σεζόν</button>
            </div>
          </div>
          <div className="content" style={{ maxWidth: 780 }}>
            <div className="scope-bar">
              <span>Διοργάνωση:</span>
              {["all", ...competitionsFrom(sysState).map((c) => c.id)].map((c) => (
                <button
                  key={c}
                  className={`round-pill ${statsCompetition === c ? "active" : ""}`}
                  onClick={() => {
                    if (statsCompetition === c) return;
                    setStatsCompetition(c);
                    setStatsResult(null);
                    if (h2hResult && h2hSelectedPlayer) computeOpponentBreakdown(h2hSelectedPlayer, statsScope, c);
                    else setH2hResult(null);
                  }}
                >
                  {c === "all" ? "Όλες" : competitionName(competitionsFrom(sysState), c)}
                </button>
              ))}
            </div>
            <div className="scope-bar">
              <span>Περίοδος:</span>
              {["all", ...[...new Set([...seasonYearsAvailable, ...Object.values(importDocs).map(importSeason).filter(Boolean)])].sort((a, b) => b - a)].map((y) => (
                <button
                  key={y}
                  className={`round-pill ${statsScope === y ? "active" : ""}`}
                  onClick={() => {
                    if (statsScope === y) return;
                    setStatsScope(y);
                    setStatsResult(null);
                    setSeasonStatsResult(null);
                    if (h2hResult && h2hSelectedPlayer) computeOpponentBreakdown(h2hSelectedPlayer, y, statsCompetition);
                    else setH2hResult(null);
                  }}
                >
                  {y === "all" ? "Όλα" : `Σεζόν ${sn(y)}`}
                </button>
              ))}
            </div>
            {statsTab === "h2h" && (
              <>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
                  <select
                    value={h2hSelectedPlayer}
                    onChange={(e) => { setH2hSelectedPlayer(e.target.value); setH2hResult(null); setH2hExpandedOpponent(null); }}
                    style={{ fontSize: 15, border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", background: "var(--surface)", flex: "1 1 240px" }}
                  >
                    <option value="">Επιλέξτε παίκτη</option>
                    {Object.values(registry.players || {}).map((p) => p.name).sort((a, b) => a.localeCompare(b, "el")).map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  <button
                    className="btn-primary"
                    disabled={!h2hSelectedPlayer || h2hLoading}
                    onClick={() => computeOpponentBreakdown(h2hSelectedPlayer)}
                  >
                    {h2hLoading ? "Υπολογισμός…" : "Ανάλυση"}
                  </button>
                </div>

                {h2hResult && (() => {
                  const totalGames = h2hResult.rows.reduce((s, r) => s + r.total, 0);
                  const totalWins = h2hResult.rows.reduce((s, r) => s + r.wins, 0);
                  const overallPct = totalGames > 0 ? Math.round((totalWins / totalGames) * 1000) / 10 : 0;
                  const filteredRows = h2hResult.rows.filter((r) => r.name.toLowerCase().includes(h2hSearch.toLowerCase()));
                  const sortedRows = [...filteredRows].sort((a, b) => {
                    const cmp = h2hSortKey === "name" ? a.name.localeCompare(b.name, "el") : a[h2hSortKey] - b[h2hSortKey];
                    return h2hSortDir === "asc" ? cmp : -cmp;
                  });
                  function toggleSort(key) {
                    if (h2hSortKey === key) setH2hSortDir(h2hSortDir === "asc" ? "desc" : "asc");
                    else { setH2hSortKey(key); setH2hSortDir("desc"); }
                  }
                  const sortArrow = (key) => (h2hSortKey === key ? (h2hSortDir === "asc" ? " ▲" : " ▼") : "");

                  return (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", textAlign: "center", marginBottom: 20, padding: "14px 0", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
                        <div>
                          <p style={{ fontWeight: 800, fontSize: 24, margin: 0 }}>{totalGames}</p>
                          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>συνολικά ματς</p>
                        </div>
                        <div>
                          <p style={{ fontWeight: 800, fontSize: 24, margin: 0, color: "var(--win)" }}>{totalWins}-{totalGames - totalWins}</p>
                          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>νίκες-ήττες</p>
                        </div>
                        <div>
                          <p style={{ fontWeight: 800, fontSize: 24, margin: 0 }}>{overallPct}%</p>
                          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>ποσοστό</p>
                        </div>
                        <div>
                          <p style={{ fontWeight: 800, fontSize: 24, margin: 0 }}>{h2hResult.rows.length}</p>
                          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>αντίπαλοι</p>
                        </div>
                      </div>

                      <input
                        type="text"
                        placeholder="Αναζήτηση αντιπάλου…"
                        value={h2hSearch}
                        onChange={(e) => setH2hSearch(e.target.value)}
                        style={{ width: "100%", maxWidth: 300, fontSize: 14, border: "1px solid var(--border)", borderRadius: 7, padding: "6px 10px", marginBottom: 12 }}
                      />

                      {sortedRows.length === 0 ? (
                        <p style={{ color: "var(--muted)" }}>Δεν βρέθηκαν αντίπαλοι.</p>
                      ) : (
                        <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
                              <th style={{ padding: "4px 6px", cursor: "pointer" }} onClick={() => toggleSort("name")}>Αντίπαλος{sortArrow("name")}</th>
                              <th style={{ padding: "4px 6px", cursor: "pointer", textAlign: "center" }} onClick={() => toggleSort("total")}>Αγώνες{sortArrow("total")}</th>
                              <th style={{ padding: "4px 6px", cursor: "pointer", textAlign: "center" }} onClick={() => toggleSort("wins")}>Ν-Η{sortArrow("wins")}</th>
                              <th style={{ padding: "4px 6px", cursor: "pointer", textAlign: "center" }} onClick={() => toggleSort("pct")}>%{sortArrow("pct")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedRows.map((r) => (
                              <React.Fragment key={r.name}>
                                <tr
                                  style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                                  onClick={() => setH2hExpandedOpponent(h2hExpandedOpponent === r.name ? null : r.name)}
                                >
                                  <td style={{ padding: "6px", fontWeight: 700 }}>{r.name}</td>
                                  <td style={{ padding: "6px", textAlign: "center" }}>{r.total}</td>
                                  <td style={{ padding: "6px", textAlign: "center" }}>{r.wins}-{r.losses}</td>
                                  <td style={{ padding: "6px", textAlign: "center", fontWeight: 700, color: r.pct >= 50 ? "var(--win)" : "var(--loss)" }}>{r.pct}%</td>
                                </tr>
                                {h2hExpandedOpponent === r.name && (
                                  <tr>
                                    <td colSpan={4} style={{ padding: "6px 6px 14px 20px", background: "var(--surface)" }}>
                                      <table style={{ width: "100%", fontSize: 13 }}>
                                        <tbody>
                                          {r.meetings.map((m, j) => (
                                            <tr key={j}>
                                              <td style={{ padding: "3px 6px", color: "var(--muted)" }}>{new Date(m.date).toLocaleDateString("el-GR")}</td>
                                              <td style={{ padding: "3px 6px", color: "var(--muted)" }}>{m.tournamentName}</td>
                                              <td style={{ padding: "3px 6px", fontWeight: 700 }}>
                                                {m.method === "double_retirement"
                                                  ? "Διπλό Α.Α. — χωρίς νικητή"
                                                  : `${m.winner} νίκη${m.method === "retirement" ? " (Α.Α.)" : ""}`}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  );
                })()}
              </>
            )}

            {(statsTab === "streaks" || statsTab === "titles") && !statsResult && (
              <button className="btn-secondary" disabled={statsLoading} onClick={() => computeStatistics()}>
                <TrendingUp size={15} /> {statsLoading ? "Υπολογισμός…" : "Υπολόγισε στατιστικά"}
              </button>
            )}

            {statsTab === "streaks" && statsResult && (
              <div style={{ display: "grid", gap: 24 }}>
                <div>
                  <p style={{ fontWeight: 700, fontSize: 15, margin: "0 0 8px 0" }}>🔥 Μεγαλύτερα σερί νικών</p>
                  {statsResult.topWinStreaks.length === 0 ? <p style={{ color: "var(--muted)" }}>—</p> : (
                    <ol style={{ margin: 0, paddingLeft: 20 }}>
                      {statsResult.topWinStreaks.map((s, i) => (
                        <li key={i} style={{ marginBottom: 4 }}>
                          <strong>{s.name}</strong> — {s.length} νίκες στη σειρά
                          <span style={{ color: "var(--muted)", fontSize: 13 }}> ({new Date(s.startDate).toLocaleDateString("el-GR")} – {new Date(s.endDate).toLocaleDateString("el-GR")})</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <div>
                  <p style={{ fontWeight: 700, fontSize: 15, margin: "0 0 8px 0" }}>🎯 Μεγαλύτερα σερί συμμετοχών</p>
                  {statsResult.topParticipationStreaks.length === 0 ? <p style={{ color: "var(--muted)" }}>—</p> : (
                    <ol style={{ margin: 0, paddingLeft: 20 }}>
                      {statsResult.topParticipationStreaks.map((s, i) => (
                        <li key={i} style={{ marginBottom: 4 }}>
                          <strong>{s.name}</strong> — {s.length} συνεχόμενες αγωνιστικές
                          <span style={{ color: "var(--muted)", fontSize: 13 }}> ({new Date(s.startDate).toLocaleDateString("el-GR")} – {new Date(s.endDate).toLocaleDateString("el-GR")})</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 260px" }}>
                    <p style={{ fontWeight: 700, fontSize: 15, margin: "0 0 8px 0" }}>📈 Πρωτοπορία Season Standings</p>
                    <ol style={{ margin: 0, paddingLeft: 20 }}>
                      {statsResult.standingsLeaders.map((s, i) => (
                        <li key={i} style={{ marginBottom: 4 }}><strong>{s.name}</strong> — {s.days} {s.days === 1 ? "αγωνιστική" : "αγωνιστικές"} #1</li>
                      ))}
                    </ol>
                  </div>
                  <div style={{ flex: "1 1 260px" }}>
                    <p style={{ fontWeight: 700, fontSize: 15, margin: "0 0 8px 0" }}>⭐ Πρωτοπορία ELO</p>
                    <ol style={{ margin: 0, paddingLeft: 20 }}>
                      {statsResult.eloLeaders.map((s, i) => (
                        <li key={i} style={{ marginBottom: 4 }}><strong>{s.name}</strong> — {s.days} {s.days === 1 ? "αγωνιστική" : "αγωνιστικές"} #1</li>
                      ))}
                    </ol>
                  </div>
                </div>
                <button className="btn-ghost" style={{ justifySelf: "start" }} disabled={statsLoading} onClick={() => computeStatistics()}>
                  <RotateCcw size={13} /> Ξαναϋπολόγισε
                </button>
              </div>
            )}

            {statsTab === "titles" && statsResult && (
              <div>
                <p style={{ fontWeight: 700, fontSize: 15, margin: "0 0 8px 0" }}>🏆 Κατακτήσεις τουρνουά</p>
                <ol style={{ margin: 0, paddingLeft: 20 }}>
                  {statsResult.titles.map((tt, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      <strong>{tt.name}</strong> — {tt.count} {tt.count === 1 ? "τίτλος" : "τίτλοι"}
                      <span style={{ color: "var(--muted)", fontSize: 13 }}> ({tt.tournaments.map((x) => x.name).join(", ")})</span>
                    </li>
                  ))}
                </ol>
                <button className="btn-ghost" style={{ marginTop: 16 }} disabled={statsLoading} onClick={() => computeStatistics()}>
                  <RotateCcw size={13} /> Ξαναϋπολόγισε
                </button>
              </div>
            )}

            {statsTab === "season" && (
              <div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
                  <button className="btn-primary" disabled={seasonStatsLoading} onClick={() => computeSeasonOverview(statsScope)}>
                    {seasonStatsLoading ? "Υπολογισμός…" : "Υπολόγισε"}
                  </button>
                  {seasonStatsResult && <span className="cal-note">{seasonStatsResult.scope === "all" ? scopeLabel("all") : `Σεζόν ${sn(seasonStatsResult.scope)}`}</span>}
                </div>

                {seasonStatsResult && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, marginBottom: 28 }}>
                      {[
                        { icon: "🏆", label: "Τουρνουά", value: seasonStatsResult.tournamentCount },
                        { icon: "👥", label: "Παίκτες", value: seasonStatsResult.playerCount },
                        { icon: "🆕", label: "Νέοι παίκτες", value: seasonStatsResult.newPlayers ?? "—" },
                        { icon: "📊", label: "Μ.Ο. συμμετοχών/τουρνουά", value: seasonStatsResult.avgParticipants },
                        { icon: "🎲", label: "Σύνολο αγώνων (προσέγγιση)", value: seasonStatsResult.totalMatches },
                        { icon: "😲", label: "Ποσοστό εκπλήξεων", value: `${seasonStatsResult.upsetRate}%` },
                      ].map((box) => (
                        <div key={box.label} style={{ border: "1px solid var(--border)", borderTop: "3px solid var(--accent)", borderRadius: 8, padding: "16px 16px 14px 16px", textAlign: "center", background: "var(--surface)" }}>
                          <div style={{ fontSize: 22, marginBottom: 4 }}>{box.icon}</div>
                          <p style={{ fontWeight: 800, fontSize: 28, margin: 0, color: "var(--ink)" }}>{box.value}</p>
                          <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0 0" }}>{box.label}</p>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 320px", border: "1px solid var(--border)", borderRadius: 10, padding: "20px 22px", background: "var(--accent-soft)" }}>
                        <p style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--accent)", margin: "0 0 10px 0" }}>😲 Μεγαλύτερη ανατροπή</p>
                        {seasonStatsResult.biggestUpset ? (
                          <>
                            <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22, margin: "0 0 6px 0" }}>
                              {seasonStatsResult.biggestUpset.winner} <span style={{ fontSize: 15, color: "var(--muted)" }}>({seasonStatsResult.biggestUpset.winnerRatingBefore})</span>
                            </p>
                            <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 10px 0" }}>
                              νίκησε τον <strong style={{ color: "var(--ink)" }}>{seasonStatsResult.biggestUpset.loser}</strong> ({seasonStatsResult.biggestUpset.loserRatingBefore})
                            </p>
                            <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
                              διαφορά <strong>{seasonStatsResult.biggestUpset.margin}</strong> πόντοι ELO — {seasonStatsResult.biggestUpset.tournamentName}
                            </p>
                          </>
                        ) : <p style={{ color: "var(--muted)" }}>—</p>}
                      </div>
                      <div style={{ flex: "1 1 320px", border: "1px solid var(--border)", borderRadius: 10, padding: "20px 22px", background: "var(--accent-soft)" }}>
                        <p style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--accent)", margin: "0 0 10px 0" }}>📈 Μεγαλύτερη άνοδος ELO</p>
                        {seasonStatsResult.mostImproved ? (
                          <>
                            <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22, margin: "0 0 6px 0" }}>{seasonStatsResult.mostImproved.name}</p>
                            <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 10px 0" }}>
                              {seasonStatsResult.mostImproved.startRating} → <strong style={{ color: "var(--win)" }}>{seasonStatsResult.mostImproved.endRating}</strong>
                            </p>
                            <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
                              <strong style={{ color: "var(--win)" }}>+{seasonStatsResult.mostImproved.delta}</strong> πόντοι μέσα στη σεζόν
                            </p>
                          </>
                        ) : <p style={{ color: "var(--muted)" }}>—</p>}
                      </div>
                      <div style={{ flex: "1 1 320px", border: "1px solid var(--border)", borderRadius: 10, padding: "20px 22px", background: "var(--accent-soft)" }}>
                        <p style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--accent)", margin: "0 0 10px 0" }}>🎪 Τουρνουά με τις περισσότερες εκπλήξεις</p>
                        {seasonStatsResult.mostSurprisingTournament ? (
                          <>
                            <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22, margin: "0 0 6px 0" }}>{seasonStatsResult.mostSurprisingTournament.name}</p>
                            <p style={{ fontSize: 14, color: "var(--muted)", margin: 0 }}>
                              <strong style={{ color: "var(--ink)" }}>{seasonStatsResult.mostSurprisingTournament.rate}%</strong> των αγώνων ({seasonStatsResult.mostSurprisingTournament.upsets} από {seasonStatsResult.mostSurprisingTournament.matches})
                            </p>
                          </>
                        ) : <p style={{ color: "var(--muted)" }}>—</p>}
                      </div>
                    </div>

                    <button className="btn-ghost" style={{ marginTop: 20 }} disabled={seasonStatsLoading} onClick={() => computeSeasonOverview(statsScope)}>
                      <RotateCcw size={13} /> Ξαναϋπολόγισε
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
      {/* #endregion Οθόνη: Στατιστικά (phase "h2h") */}

      {/* #region Διάλογοι: σύνοψη ανακοίνωσης, ολοκλήρωση γύρου */}
      {recapText !== null && (
        <div className="modal-overlay" onClick={() => setRecapText(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680, width: "92vw", maxHeight: "85vh", overflowY: "auto", padding: "28px 32px" }}>
            <p style={{ margin: "0 0 4px 0", fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 700, color: "var(--accent)" }}>Σύνοψη ανακοίνωσης</p>
            <p style={{ margin: "0 0 16px 0", fontSize: 13, color: "var(--muted)" }}>Έτοιμο κείμενο copy/paste — για bgfed.gr, Facebook, ή όπου αλλού.</p>
            <textarea
              readOnly
              value={recapText}
              rows={20}
              style={{ width: "100%", fontFamily: "'Source Sans 3', sans-serif", fontSize: 15, lineHeight: 1.6, padding: 16, border: "1px solid var(--border)", borderRadius: 9, background: "var(--surface)", resize: "vertical" }}
              onFocus={(e) => e.target.select()}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="btn-secondary" onClick={() => setRecapText(null)}>Κλείσιμο</button>
              <button
                className="btn-secondary"
                disabled={addingToFeed}
                onClick={addRecapToFeed}
                title="Προσθέτει στο RSS feed — το WordPress (μέσω plugin) το τραβάει μόνο του, χωρίς εμάς να στέλνουμε τίποτα προς το bgfed.gr"
              >
                {addingToFeed ? "Προσθήκη…" : "Προσθήκη στο RSS feed"}
              </button>
              <button
                className="btn-primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(recapText);
                    showToast("Αντιγράφηκε!");
                  } catch {
                    showToast("Δεν ήταν δυνατή η αντιγραφή — επίλεξε και κάνε Ctrl+C.");
                  }
                }}
              >
                Αντιγραφή
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmingFinish && (
        <div className="modal-overlay" onClick={() => setConfirmingFinish(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: "0 0 12px 0", fontWeight: 600 }}>Ολοκλήρωση τουρνουά</p>
            <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 16px 0" }}>
              {competitionId !== DEFAULT_COMPETITION_ID
                ? "Το τουρνουά δεν είναι Premier League, οπότε δεν θα μετρήσει σε ELO και Βαθμολογία, ό,τι κι αν απαντήσεις."
                : liveStandingsEnabled
                ? "Ενημέρωση της Βαθμολογίας με το τελικό αποτέλεσμα; (Η ELO έχει ήδη ενημερωθεί σε κάθε γύρο, λόγω live ενημέρωσης.)"
                : "Ενημέρωση ELO και Βαθμολογίας με τα αποτελέσματα αυτού του τουρνουά;"}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                className="btn-secondary"
                onClick={() => {
                  setConfirmingFinish(false);
                  finalizeRoundAndAdvance(false);
                }}
              >
                Όχι, μόνο ολοκλήρωση
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setConfirmingFinish(false);
                  finalizeRoundAndAdvance(true);
                }}
              >
                Ναι, ενημέρωση
              </button>
            </div>
          </div>
        </div>
      )}
      {/* #endregion Διάλογοι: σύνοψη ανακοίνωσης, ολοκλήρωση γύρου */}

      {/* #region Οθόνη: Βαθμολογία (phase "season") */}
      {/* SEASON STANDINGS */}
      {phase === "season" && (
        <>
          <div className="header">
            <p className="eyebrow">{L.seasonEyebrow}</p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <h1>{L.seasonTitle}</h1>
              <select
                value={seasonBrowseYear}
                onChange={(e) => setSeasonBrowseYear(Number(e.target.value))}
                style={{ fontFamily: "'Fraunces', serif", fontSize: 16, color: "var(--accent)", border: "1px solid var(--border)", borderRadius: 7, padding: "4px 10px", background: "var(--surface)" }}
              >
                {seasonYearsAvailable.map((y) => (
                  <option key={y} value={y}>{sn(y)}</option>
                ))}
              </select>
            </div>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content">
            <div className="notice">
              <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                Σεζόν {sn(seasonBrowseYear)}. Μετράνε τα {rulesForSeason(sysState, seasonBrowseYear).bestOf} καλύτερα αποτελέσματα κάθε παίκτη στη σεζόν.
              </span>
            </div>

            {renderSeasonSchedule(seasonBrowseYear)}

            {staleNotice}

            {(() => {
              const rules = rulesForSeason(sysState, seasonBrowseYear);
              const qual = { roundA: 32, cutoffA: rules.cutoffR32, roundB: 48, cutoffB: rules.cutoffR48 };

              function rowClassForRank(rank) {
                if (rank === 1) return "qual-tier1";
                if (rank <= qual.cutoffA) return "qual-tier2";
                if (rank <= qual.cutoffB) return "qual-tier3";
                return "";
              }

              const seasonStandings = computeSeasonStandings(seasonData, rules.bestOf);

              return (
                <>
                  <div className="qual-legend">
                    <div className="qual-row qual-tier1">
                      <span>Player of the Year + qualifies for Round of {qual.roundA}</span>
                    </div>
                    <div className="qual-row qual-tier2">
                      <span>Qualifies for Round of {qual.roundA} — positions 2 to {qual.cutoffA}</span>
                    </div>
                    <div className="qual-row qual-tier3">
                      <span>Qualifies for Round of {qual.roundB} — positions {qual.cutoffA + 1} to {qual.cutoffB}</span>
                    </div>
                  </div>

              {seasonStandings.length === 0 ? (
                <div className="empty-state">
                  <TrendingUp size={20} style={{ marginBottom: 6 }} />
                  <p>No season data yet for {seasonBrowseYear}. It fills in as tournaments finish.</p>
                </div>
              ) : (
                <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th className="rank">Rank</th>
                        <th>Player</th>
                        <th>Events</th>
                        <th>Points<br /><span className="th-sub">(best {rules.bestOf})</span></th>
                        <th>Total<br /><span className="th-sub">(all events)</span></th>
                        <th>Wins<br /><span className="th-sub">(regular only)</span></th>
                        <th>Matches</th>
                        <th>%</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {seasonStandings.map((p, i) => {
                        const rank = i + 1;
                        return (
                        <React.Fragment key={p.name}>
                          <tr
                            className={rowClassForRank(rank)}
                            style={{ cursor: "pointer" }}
                            onClick={() => setExpandedPlayer(expandedPlayer === p.name ? null : p.name)}
                          >
                            <td className="rank">{rank}</td>
                            <td className="standings-name" style={{ cursor: "pointer" }} onClick={() => openPlayerDetail(normalizeName(p.name))}>{p.name}</td>
                            <td>{p.eventsPlayed}</td>
                            <td><strong>{p.total}</strong></td>
                            <td>{p.sumAll}</td>
                            <td>{p.totalWins}</td>
                            <td>{p.totalMatches}</td>
                            <td style={{ fontWeight: 700 }}>{p.pct !== null ? `${p.pct}%` : "—"}</td>
                            <td style={{ textAlign: "right", color: "var(--muted)" }}>
                              {expandedPlayer === p.name ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                            </td>
                          </tr>
                          {expandedPlayer === p.name && (
                            <tr>
                              <td colSpan={9} style={{ background: "var(--bg)", padding: "10px 14px" }}>
                                {p.entries.map((e) => (
                                  <div
                                    key={e.tournamentId}
                                    style={{
                                      display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "6px 0",
                                      borderBottom: "1px solid var(--border)",
                                      color: p.countedIds.has(e.tournamentId) ? "var(--ink)" : "var(--muted)",
                                      fontWeight: p.countedIds.has(e.tournamentId) ? 600 : 400,
                                    }}
                                  >
                                    <span>
                                      {p.countedIds.has(e.tournamentId) ? <Check size={12} style={{ marginRight: 6 }} color="var(--win)" /> : null}
                                      {e.tournamentName} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({formatDate(e.date)})</span>
                                    </span>
                                    <span className="entry-breakdown">
                                      {e.wins !== undefined && (
                                        <>
                                          <span>W {e.wins}</span>
                                          <span>Bye {e.bye}</span>
                                          <span>A.A. {e.aa}</span>
                                          <span>M {e.matches}</span>
                                        </>
                                      )}
                                      <strong>{e.points} pts</strong>
                                    </span>
                                  </div>
                                ))}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );})}
                    </tbody>
                  </table>
                </div>
              )}
                </>
              );
            })()}
          </div>
        </>
      )}
      {/* #endregion Οθόνη: Βαθμολογία (phase "season") */}

      {/* #region Οθόνη: Κατάταξη ELO (phase "elo") */}
      {/* ELO RATINGS */}
      {phase === "elo" && (
        <>
          <div className="header">
            <p className="eyebrow">{L.eloEyebrow} · {eloPool === "national" ? "Τελικές Φάσεις Κυπέλλου και Πρωταθλήματος" : sysState.competitionsVersion === 2 ? clubDisplay(sysState, sysState.homeClubId, ELO_POOLS.club.label) : ELO_POOLS.club.label}</p>
            <h1>{eloPool === "national" ? L.eloNationalTitle : L.eloTitle}</h1>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content">
            <div className="notice" style={{ alignItems: "flex-start" }}>
              <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ margin: "0 0 6px 0" }}>
                  <strong>How this is calculated</strong> — a backgammon-specific, match-length-aware Elo, distinct from plain chess Elo:
                </p>
                <p style={{ margin: "0 0 6px 0" }}>
                  Win probability: <code>P = 1 / (1 + 10^(−(Rᴀ−Rʙ)·√N / 2000))</code>, where N = match length (points to win). This shape is well-attested across independent sources tracing to FIBS (the first online backgammon server, 1990s) — longer matches rely more on skill, so a given rating gap implies a bigger edge.
                </p>
                <p style={{ margin: "0 0 6px 0" }}>
                  Points at stake per match: <code>S = 4 × √N</code>. Winner gains (1−P)×S, loser loses the same amount.
                </p>
                <p style={{ margin: 0 }}>
                  Fixed K for every player (no experience-based acceleration). Walkover wins (opponent retired) are excluded entirely — no real backgammon was played. <strong>Caveat:</strong> the win-probability shape is cross-confirmed by multiple sources; the exact constant (4) matches one documented implementation of this family but hasn't been verified against FIBS's original source — treat it as a reasonable, sourced default.
                </p>
              </div>
            </div>

            {eloPool === "national" && (
              <p className="cal-note" style={{ marginBottom: 12 }}>
                Από {nationalElo.tournaments} {nationalElo.tournaments === 1 ? "τουρνουά" : "τουρνουά"} πανελλήνιων διοργανώσεων. Όλοι ξεκινούν από 1500· οι φιλοξενούμενοι παίζουν πάντα με 1500 και δεν εμφανίζονται στην κατάταξη· οι αποχωρήσεις δεν μετράνε.
              </p>
            )}

            {eloPool === "club" && staleNotice}

            {(() => {
              const source = eloPool === "national" ? nationalElo.elo.players : eloData.players;
              const standings = Object.values(source || {}).sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name, "en"));
              if (standings.length === 0) {
                return (
                  <div className="empty-state">
                    <Award size={20} style={{ marginBottom: 6 }} />
                    <p>No ELO data yet. It fills in as tournaments are played.</p>
                  </div>
                );
              }
              return (
                <div className="card" style={{ padding: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th className="rank">Rank</th>
                        <th>Player</th>
                        <th>Rating</th>
                        <th>Matches</th>
                        <th>Win %<br /><span className="th-sub">(all-time)</span></th>
                        <th>Experience<br /><span className="th-sub">(points played)</span></th>
                        <th style={{ width: 44 }} title="Πώς προέκυψε η ELO"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((p, i) => {
                        const pk = normalizeName(p.name);
                        const open = eloLedgerOpen === pk;
                        return (
                        <React.Fragment key={p.name}>
                        <tr>
                          <td className="rank">{i + 1}</td>
                          <td style={{ cursor: "pointer", fontWeight: 700 }} onClick={() => openPlayerDetail(normalizeName(p.name))}>{formatNameForDisplay(p.name, nameDisplayMode)}</td>
                          <td><strong>{Math.round(p.rating)}</strong></td>
                          <td>{p.matches ?? p.games}</td>
                          <td style={{ fontWeight: 700 }}>{p.matches > 0 ? `${Math.round(((p.wins ?? 0) / p.matches) * 1000) / 10}%` : "—"}</td>
                          <td>{p.experience ?? p.games * 7}</td>
                          <td>
                            <button
                              className={`btn-ghost ledger-btn ${open ? "active" : ""}`}
                              title="Πώς προέκυψε η ELO"
                              onClick={() => {
                                if (open) {
                                  setEloLedgerOpen(null);
                                  return;
                                }
                                setEloLedgerOpen(pk);
                                if (eloPool === "club" && eloTimeline === null && !eloTimelineLoading) computeEloTimeline();
                              }}
                            >
                              <TrendingUp size={15} />
                            </button>
                          </td>
                        </tr>
                        {open && (
                          <tr className="ledger-row">
                            <td colSpan={7}>
                              <strong>Πώς προέκυψε η ELO — {formatNameForDisplay(p.name, nameDisplayMode)}</strong>
                              {renderEloLedger(pk, eloPool)}
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </>
      )}
      {/* #endregion Οθόνη: Κατάταξη ELO (phase "elo") */}

      {/* #region Οθόνη: Παίκτες / μητρώο (phase "players") */}
      {/* PLAYER REGISTRY */}
      {phase === "players" && !isAdmin && (
        <div className="content">
          <div className="empty-state">The player registry is only available in Admin mode.</div>
        </div>
      )}
      {phase === "players" && isAdmin && (
        <>
          <div className="header">
            <p className="eyebrow">{L.playersEyebrow}</p>
            <h1>{L.playersTitle}</h1>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content">
            <div className="notice">
              <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Admin-only: contact info and membership status never appear to visitors.</span>
            </div>

            <div className="footer-actions" style={{ marginTop: 0, marginBottom: 20 }}>
              <button className="btn-secondary" onClick={addRegistryPlayer}>
                <Plus size={16} /> Add Player
              </button>
            </div>

            <div className="filters">
              <div className="field">
                <label>Search by name</label>
                <input type="text" value={registrySearch} onChange={(e) => setRegistrySearch(e.target.value)} placeholder="e.g. Zoidis" />
              </div>
              <div style={{ width: 170 }}>
                <label>Display names as</label>
                <select
                  value={nameDisplayMode}
                  onChange={(e) => setNameDisplayMode(e.target.value)}
                  style={{ width: "100%", fontFamily: "'Source Sans 3', sans-serif", fontSize: 15, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 7, background: "#fff", color: "var(--ink)" }}
                >
                  <option value="normal">As entered</option>
                  <option value="upper">ΚΕΦΑΛΑΙΑ</option>
                  <option value="greeklish">Greeklish</option>
                </select>
              </div>
              {clubsActive(sysState) && (
                <div style={{ width: 200 }}>
                  <label>Σύλλογος</label>
                  <select
                    value={registryClubFilter}
                    onChange={(e) => setRegistryClubFilter(e.target.value)}
                    style={{ width: "100%", fontFamily: "'Source Sans 3', sans-serif", fontSize: 15, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 7, background: "#fff" }}
                  >
                    <option value="">Όλοι</option>
                    {[...clubsFrom(sysState)].filter((c) => !c.organiserOnly).sort((a, b) => a.name.localeCompare(b.name, "el")).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    <option value="none">Χωρίς σύλλογο</option>
                  </select>
                </div>
              )}
              <label style={{ display: "flex", gap: 6, alignItems: "center", alignSelf: "flex-end", paddingBottom: 10, fontSize: 14 }}>
                <input type="checkbox" checked={showGuests} onChange={(e) => setShowGuests(e.target.checked)} /> Εμφάνιση φιλοξενούμενων
              </label>
            </div>

            {(() => {
              const allPlayers = Object.entries(registry.players || {})
                .filter(([, p]) => showGuests || !p.guest)
                .filter(([, p]) => !registryClubFilter || (registryClubFilter === "none" ? !p.clubId : p.clubId === registryClubFilter))
                .filter(([, p]) => {
                      if (!registrySearch) return true;
                      const num = registrySearch.trim().replace(/^#/, "");
                      if (/^\d+$/.test(num)) return p.regNo === Number(num);
                      return p.name.toLowerCase().includes(registrySearch.toLowerCase());
                    })
                .sort((a, b) => a[1].name.localeCompare(b[1].name, "en"));
              const currentYear = new Date().getFullYear();

              if (allPlayers.length === 0) {
                return (
                  <div className="empty-state">
                    <Users size={20} style={{ marginBottom: 6 }} />
                    <p>No players found.</p>
                  </div>
                );
              }

              return (
                <div className="card" style={{ padding: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 70 }}>Α.Μ.</th>
                        <th>Player</th>
                        <th>Σύλλογος</th>
                        <th>{currentYear} status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {allPlayers.map(([key, p]) => {
                        const thisYear = p.membership.find((m) => m.year === currentYear);
                        return (
                          <tr key={key} style={{ cursor: "pointer" }} onClick={() => openPlayerDetail(key)}>
                            <td style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{formatRegNo(p.regNo) || "—"}</td>
                            <td>
                              {formatNameForDisplay(p.name, nameDisplayMode)}
                              {p.guest && <span className="cal-note"> · φιλοξενούμενος</span>}
                              {p.needsInfo && <span className="needs-info-badge"> ⚠ Needs info</span>}
                            </td>
                            <td>{clubDisplay(sysState, p.clubId, p.club) || "—"}</td>
                            <td>
                              {thisYear
                                ? `${thisYear.member ? "Member" : "Not a member"} · ${thisYear.dues ? "Dues paid" : "Dues unpaid"}`
                                : "—"}
                            </td>
                            <td style={{ textAlign: "right", color: "var(--muted)" }}>
                              <ChevronDown size={15} style={{ transform: "rotate(-90deg)" }} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </>
      )}
      {/* #endregion Οθόνη: Παίκτες / μητρώο (phase "players") */}

      {/* #region Οθόνη: Καρτέλα παίκτη (phase "playerDetail") */}
      {/* PLAYER DETAIL */}
      {phase === "playerDetail" && (() => {
        const key = expandedRegistryPlayer;
        const p = key ? registry.players[key] : null;
        if (!p || !contactDraft) {
          return (
            <div className="content">
              <div className="empty-state">Player not found.</div>
            </div>
          );
        }
        const currentYear = new Date().getFullYear();
        const eloEntry = eloData.players?.[key];
        const ranked = Object.values(eloData.players || {}).sort((a, b) => b.rating - a.rating);
        const rank = eloEntry ? ranked.findIndex((r) => normalizeName(r.name) === key) + 1 : null;
        const stats = playerMatchStatsCache[key];
        const pct = (w, l) => (w + l > 0 ? Math.round((w / (w + l)) * 100) : null);
        const strongPct = stats ? pct(stats.vsStrongerW, stats.vsStrongerL) : null;
        const weakPct = stats ? pct(stats.vsWeakerW, stats.vsWeakerL) : null;
        return (
          <>
            <div className="header">
              <p className="eyebrow">
                Player Registry{p.regNo ? ` · Αριθμός Μητρώου ${formatRegNo(p.regNo)}` : ""}
                {isAdmin && registry.identityVersion === 2 ? <span style={{ opacity: 0.6 }}> · ID {key}</span> : null}
              </p>
              <h1>{formatNameForDisplay(p.name, nameDisplayMode)}</h1>
              <div className="points-strip">
                {Array.from({ length: 24 }).map((_, i) => (
                  <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
                ))}
              </div>
            </div>
            <div className="content">
              <div className="detail-tabs">
                {isAdmin && (
                  <button className={`detail-tab ${playerDetailTab === "contact" ? "active" : ""}`} onClick={() => setPlayerDetailTab("contact")}>
                    Contact &amp; Membership
                  </button>
                )}
                <button className={`detail-tab ${playerDetailTab === "stats" ? "active" : ""}`} onClick={() => setPlayerDetailTab("stats")}>
                  Playing Stats
                </button>
              </div>

              {playerDetailTab === "contact" && isAdmin && (
                <div className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
                  <div>
                    <label>Name</label>
                    <input
                      type="text"
                      value={contactDraft.name}
                      onChange={(e) => setContactDraft({ ...contactDraft, name: e.target.value })}
                      style={{ marginBottom: 10 }}
                    />
                    <label>Σύλλογος</label>
                    {clubsActive(sysState) ? (
                      <select
                        value={contactDraft.clubId || ""}
                        onChange={(e) => setContactDraft({ ...contactDraft, clubId: e.target.value || null, club: clubDisplay(sysState, e.target.value, "") })}
                        style={{ width: "100%", marginBottom: 10, fontFamily: "'Source Sans 3', sans-serif", fontSize: 15, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 7, background: "#fff" }}
                      >
                        <option value="">—</option>
                        {[...clubsFrom(sysState)].filter((c) => !c.organiserOnly).sort((a, b) => a.name.localeCompare(b.name, "el")).map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={contactDraft.club}
                        onChange={(e) => setContactDraft({ ...contactDraft, club: e.target.value })}
                        style={{ marginBottom: 10 }}
                      />
                    )}
                    <label>Email</label>
                    <input
                      type="text"
                      value={contactDraft.email}
                      onChange={(e) => setContactDraft({ ...contactDraft, email: e.target.value })}
                      style={{ marginBottom: 10 }}
                    />
                    <label>Phone</label>
                    <input
                      type="text"
                      value={contactDraft.phone}
                      onChange={(e) => setContactDraft({ ...contactDraft, phone: e.target.value })}
                      style={{ marginBottom: 10 }}
                    />
                    <label className="live-toggle" style={{ marginBottom: 8 }} title="Παίκτης εκτός ελληνικού μητρώου (π.χ. ξένος σε ανοιχτό τουρνουά): χωρίς Αριθμό Μητρώου, κρυφός από τη λίστα εξ ορισμού">
                      <input type="checkbox" checked={!!contactDraft.guest} onChange={(e) => setContactDraft({ ...contactDraft, guest: e.target.checked })} />
                      Φιλοξενούμενος (εκτός ελληνικού μητρώου)
                    </label>
                    <label className="live-toggle" style={{ marginBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={!!contactDraft.hasDiscount}
                        onChange={(e) => setContactDraft({ ...contactDraft, hasDiscount: e.target.checked })}
                      />
                      Discount
                    </label>
                    {contactDraft.hasDiscount && (
                      <div className="row" style={{ alignItems: "center", marginBottom: 10 }}>
                        <label style={{ margin: 0 }}>Discounted buy-in (€)</label>
                        <input
                          type="number"
                          style={{ width: 70 }}
                          value={contactDraft.discountAmount}
                          onChange={(e) => setContactDraft({ ...contactDraft, discountAmount: Number(e.target.value) || 0 })}
                        />
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <button className="btn-primary" onClick={() => saveContactDraft(key)}>
                        <Save size={15} /> Save
                      </button>
                      {playerHasHistory(key) ? (
                        <span style={{ fontSize: 13, color: "var(--muted)" }}>Έχει ιστορικό αγώνων: δεν διαγράφεται από το μητρώο.</span>
                      ) : confirmingDeletePlayer !== key ? (
                        <button className="btn-ghost" onClick={() => setConfirmingDeletePlayer(key)}>
                          <X size={14} /> Delete player
                        </button>
                      ) : (
                        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
                          Remove from registry? Existing tournaments, standings, and ELO history are unaffected.
                          <button className="btn-secondary" onClick={() => setConfirmingDeletePlayer(null)}>Cancel</button>
                          <button
                            className="btn-primary"
                            style={{ background: "var(--accent)" }}
                            onClick={() => {
                              deleteRegistryPlayer(key);
                              setPhase("players");
                            }}
                          >
                            Yes, delete
                          </button>
                        </span>
                      )}
                    </div>
                    {registry.identityVersion === 2 && (
                      <div style={{ marginTop: 10 }}>
                        {mergeFor !== key ? (
                          <button className="btn-ghost" onClick={() => { setMergeFor(key); setMergeTarget(""); }}>
                            Ένωση με άλλο πρόσωπο…
                          </button>
                        ) : (
                          <div className="delete-confirm" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                            <span>
                              Επίλεξε το πρόσωπο που είναι <strong>ο ίδιος παίκτης</strong>. Το ιστορικό και οι γραφές του περνούν στο «{p.name}» και η άλλη εγγραφή αφαιρείται.
                            </span>
                            <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
                              <option value="">— διάλεξε —</option>
                              {Object.entries(registry.players)
                                .filter(([k]) => k !== key)
                                .sort((a, b) => a[1].name.localeCompare(b[1].name, "el"))
                                .map(([k, q]) => (
                                  <option key={k} value={k}>{q.name}</option>
                                ))}
                            </select>
                            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                              <input type="checkbox" checked={mergeRecompute} onChange={(e) => setMergeRecompute(e.target.checked)} />
                              Μετά, Recompute του ELO και της Βαθμολογίας
                            </label>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button className="btn-secondary" onClick={() => setMergeFor(null)}>Άκυρο</button>
                              <button className="btn-primary" disabled={!mergeTarget} onClick={() => mergePersons(key, mergeTarget, mergeRecompute)}>Ένωση</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <label>Membership history</label>
                    {p.membership.length === 0 && (
                      <p style={{ fontSize: 13, color: "var(--muted)" }}>No membership years recorded yet.</p>
                    )}
                    {p.membership.map((m) => (
                      <div key={m.year} className="membership-row">
                        <strong>{m.year}</strong>
                        <select value={m.member ? "yes" : "no"} onChange={(e) => updateMembershipRow(key, m.year, "member", e.target.value === "yes")}>
                          <option value="yes">Member</option>
                          <option value="no">Not a member</option>
                        </select>
                        <select value={m.dues ? "yes" : "no"} onChange={(e) => updateMembershipRow(key, m.year, "dues", e.target.value === "yes")}>
                          <option value="yes">Dues paid</option>
                          <option value="no">Dues unpaid</option>
                        </select>
                        <button className="btn-ghost" onClick={() => removeMembershipRow(key, m.year)}>
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    <div className="row" style={{ marginTop: 8 }}>
                      <div style={{ width: 100 }}>
                        <input
                          type="number"
                          value={newMembershipYear}
                          onChange={(e) => setNewMembershipYear(Number(e.target.value) || currentYear)}
                        />
                      </div>
                      <button className="btn-ghost" onClick={() => addMembershipRow(key, newMembershipYear)}>
                        <Plus size={13} /> Add year
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {playerDetailTab === "stats" && (
                <div className="card">
                  {eloEntry && (
                    <div className="elo-snapshot">
                      <div className="elo-snapshot-stat">
                        <span className="finance-stat-label">ELO Rating</span>
                        <span className="finance-stat-value">{Math.round(eloEntry.rating)}</span>
                      </div>
                      <div className="elo-snapshot-stat">
                        <span className="finance-stat-label">Rank</span>
                        <span className="finance-stat-value">#{rank}</span>
                      </div>
                      <div className="elo-snapshot-stat">
                        <span className="finance-stat-label">Experience</span>
                        <span className="finance-stat-value">{eloEntry.experience ?? eloEntry.games * 7}</span>
                      </div>
                      {stats && (
                        <>
                          <div className="elo-snapshot-stat">
                            <span className="finance-stat-label">vs higher-rated</span>
                            <span className="finance-stat-value" style={{ fontSize: 16 }}>
                              {stats.vsStrongerW}W–{stats.vsStrongerL}L{strongPct !== null && <span style={{ color: "var(--muted)", fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, fontWeight: 600 }}> ({strongPct}%)</span>}
                            </span>
                          </div>
                          <div className="elo-snapshot-stat">
                            <span className="finance-stat-label">vs lower-rated</span>
                            <span className="finance-stat-value" style={{ fontSize: 16 }}>
                              {stats.vsWeakerW}W–{stats.vsWeakerL}L{weakPct !== null && <span style={{ color: "var(--muted)", fontFamily: "'Source Sans 3', sans-serif", fontSize: 12, fontWeight: 600 }}> ({weakPct}%)</span>}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <p className="trend-chart-title" style={{ marginTop: 4 }}>Performance trend</p>
                  {(() => {
                    const clubRows = eloTimeline ? eloTimeline[key] || [] : null;
                    const natRows = nationalElo.timeline[key] || [];
                    const hasClub = !!(clubRows && clubRows.length) || !!eloData.players?.[key];
                    const hasNat = natRows.length > 0;
                    const pool = cardEloPool && ((cardEloPool === "club" && hasClub) || (cardEloPool === "national" && hasNat)) ? cardEloPool : hasClub || !hasNat ? "club" : "national";
                    // win rate over every match the player played (all competitions)
                    let winRows = null;
                    if (eloTimeline && eloTimeline.__ledger) {
                      const all = [...(eloTimeline.__ledger[key] || []), ...(nationalElo.ledger[key] || [])]
                        .filter((r) => !r.ret)
                        .sort((x, y) => new Date(x.date) - new Date(y.date));
                      winRows = [];
                      let w = 0;
                      let g = 0;
                      all.forEach((r, i) => {
                        g += 1;
                        if (r.result === "win") w += 1;
                        const next = all[i + 1];
                        if (!next || next.tournamentId !== r.tournamentId) winRows.push({ date: r.date, winRate: (w / g) * 100, wins: w, games: g });
                      });
                    }
                    return (
                      <>
                        <PlayerTrendCharts
                          eloRows={pool === "national" ? natRows : clubRows}
                          winRows={winRows}
                          eloSwitch={
                            hasClub && hasNat ? (
                              <span className="layout-toggle mini" role="group">
                                <button className={pool === "club" ? "active" : ""} onClick={() => setCardEloPool("club")}>Ομοσπονδίας</button>
                                <button className={pool === "national" ? "active" : ""} onClick={() => setCardEloPool("national")}>Πανελλήνια</button>
                              </span>
                            ) : (
                              <span className="cal-note">{pool === "national" ? "Πανελλήνια" : "Ομοσπονδίας"}</span>
                            )
                          }
                        />
                        {pool === "national" && (nationalElo.ledger[key] || []).length > 0 && (
                          <details className="ledger" style={{ marginTop: 14 }}>
                            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Πώς προέκυψε η Πανελλήνια ELO ({(nationalElo.ledger[key] || []).filter((r) => !r.ret).length} αγώνες)</summary>
                            {renderEloLedger(key, "national")}
                          </details>
                        )}
                      </>
                    );
                  })()}

                  {eloTimeline && eloTimeline.__ledger && (eloTimeline.__ledger[key] || []).length > 0 && (cardEloPool !== "national" || (nationalElo.timeline[key] || []).length === 0) && (
                    <details className="ledger" style={{ marginTop: 14 }}>
                      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                        Πώς προέκυψε η ELO ({(eloTimeline.__ledger[key] || []).filter((r) => !r.ret).length} αγώνες)
                      </summary>
                      {renderEloLedger(key)}
                    </details>
                  )}

                  <label style={{ marginTop: 18, display: "block" }}>Tournament history</label>
                  {!playerHistoryCache[key] && <p style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</p>}
                  {playerHistoryCache[key] && playerHistoryCache[key].length === 0 && (
                    <p style={{ fontSize: 13, color: "var(--muted)" }}>No tournaments recorded yet.</p>
                  )}
                  {playerHistoryCache[key] && new Set(playerHistoryCache[key].map((h) => h.competitionId)).size > 1 && (
                    <div className="round-pills" style={{ margin: "6px 0 8px 0" }}>
                      {["", ...new Set(playerHistoryCache[key].map((h) => h.competitionId))].map((c) => (
                        <button key={c || "all"} className={`round-pill ${historyCompetition === c ? "active" : ""}`} onClick={() => setHistoryCompetition(c)}>
                          {c ? competitionName(competitionsFrom(sysState), c) : "Όλες"}
                        </button>
                      ))}
                    </div>
                  )}
                  {playerHistoryCache[key] && playerHistoryCache[key].length > 0 && (
                    <div className="history-table">
                      {playerHistoryCache[key].filter((h) => !historyCompetition || h.competitionId === historyCompetition).map((h, i) => (
                        <div key={i} className="history-row">
                          <span>
                            {h.imported ? (
                              <button className="history-link" onClick={() => openImportPublic(h.tournamentId, { kind: "player", key })} title="Άνοιγμα του τουρνουά">
                                {h.tournamentName}
                              </button>
                            ) : h.tournamentId && archive.some((t) => t.id === h.tournamentId) ? (
                              <button className="history-link" onClick={() => openTournamentFromPlayer(h.tournamentId, key)} title="Άνοιγμα του τουρνουά">
                                {h.tournamentName}
                              </button>
                            ) : (
                              h.tournamentName
                            )}{" "}
                            <span style={{ color: "var(--muted)" }}>({formatDate(h.date)})</span>
                          </span>
                          <strong>{h.imported ? (h.positionLabel && h.positionLabel.includes("–") ? `θέσεις ${h.positionLabel}` : h.position ? `${h.position}η θέση` : "—") : `${h.points} pts`}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        );
      })()}
      {/* #endregion Οθόνη: Καρτέλα παίκτη (phase "playerDetail") */}

      {/* #region Οθόνη: Πίνακας Ελέγχου (phase "dashboard") */}
      {/* DASHBOARD */}
      {phase === "dashboard" && (
        <>
          <div className="header">
            <p className="eyebrow">{L.dashboardEyebrow}</p>
            <h1>{L.dashboardTitle}</h1>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content">
            {isAdmin && (() => {
              const lastExport = sysState.lastExportAt ? new Date(sysState.lastExportAt) : null;
              const daysSince = lastExport ? Math.floor((Date.now() - lastExport.getTime()) / 86400000) : null;
              const newerFinished = lastExport
                ? archive.filter((t) => t.status === "Completed" && new Date(t.date) > lastExport)
                : [];
              let exportMsg = "";
              if (!lastExport) exportMsg = "Δεν έχει καταγραφεί ποτέ Export All Data. Κάνε ένα αντίγραφο ασφαλείας.";
              else if (daysSince > 30) exportMsg = `Το τελευταίο Export All Data έγινε πριν ${daysSince} ημέρες.`;
              else if (newerFinished.length > 0) exportMsg = `Υπάρχουν ${newerFinished.length} τουρνουά μετά το τελευταίο Export All Data (${formatDate(sysState.lastExportAt)}).`;
              return (
                <>
                  {exportMsg && (
                    <div className="notice" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--ink)", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <AlertTriangle size={16} style={{ flexShrink: 0 }} /> {exportMsg}
                      </span>
                      <button className="btn-secondary" onClick={exportAllData}>
                        <Download size={15} /> Export τώρα
                      </button>
                    </div>
                  )}
                  {health && health.needsRecompute && staleReasons.length > 0 && (
                    <div className="notice" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--ink)", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <AlertTriangle size={16} style={{ flexShrink: 0 }} /> Το ELO / η Βαθμολογία ίσως δεν ταιριάζουν με τα τουρνουά ({staleReasons.length} {staleReasons.length === 1 ? "λόγος" : "λόγοι"}).
                      </span>
                      <button className="btn-secondary" onClick={() => { setControlTab("data"); setPhase("control"); }}>Άνοιγμα Διαχείρισης</button>
                    </div>
                  )}
                </>
              );
            })()}
            <div className="dashboard-grid">
              <button className="dashboard-card" onClick={() => setPhase("archive")}>
                <Trophy size={26} />
                <span className="dashboard-card-title">{L.navTournaments}</span>
                <span className="dashboard-card-desc">Browse past tournaments or start a new one</span>
              </button>
              <button className="dashboard-card" onClick={() => setPhase("season")}>
                <TrendingUp size={26} />
                <span className="dashboard-card-title">{L.navSeason}</span>
                <span className="dashboard-card-desc">Annual ranking across all tournaments</span>
              </button>
              <button className="dashboard-card" onClick={() => { setEloPool("club"); setEloLedgerOpen(null); setPhase("elo"); }}>
                <Award size={26} />
                <span className="dashboard-card-title">{L.navElo}</span>
                <span className="dashboard-card-desc">Lifetime skill rating for every player</span>
              </button>
              <button className="dashboard-card" onClick={() => { setEloPool("national"); setEloLedgerOpen(null); setPhase("elo"); }}>
                <Award size={26} />
                <span className="dashboard-card-title">{L.navEloNational}</span>
                <span className="dashboard-card-desc">Τελικές Φάσεις Κυπέλλου και Πρωταθλήματος</span>
              </button>
              <button className="dashboard-card" onClick={() => setPhase("h2h")}>
                <Users size={26} />
                <span className="dashboard-card-title">{L.navStats}</span>
                <span className="dashboard-card-desc">Στατιστικά παίκτη, σερί, τίτλοι, πρωτοπορία</span>
              </button>
              {isAdmin && (
                <button className="dashboard-card" onClick={() => setPhase("players")}>
                  <Users size={26} />
                  <span className="dashboard-card-title">{L.navPlayers}</span>
                  <span className="dashboard-card-desc">Registry, contact info, membership</span>
                </button>
              )}
              {isAdmin && (
                <button className="dashboard-card" onClick={() => { setControlTab("overview"); setPhase("control"); }}>
                  <Lock size={26} />
                  <span className="dashboard-card-title">{L.navControl}</span>
                  <span className="dashboard-card-desc">Σεζόν, κανόνες, δεδομένα, backup, ρυθμίσεις</span>
                </button>
              )}
              <button className="dashboard-card" onClick={() => { setPhase("about"); dismissWhatsNew(); }}>
                <Info size={26} />
                <span className="dashboard-card-title">{L.navAbout}</span>
                <span className="dashboard-card-desc">Λειτουργικότητες, τεχνικά στοιχεία, changelog</span>
              </button>
            </div>
          </div>
        </>
      )}
      {/* #endregion Οθόνη: Πίνακας Ελέγχου (phase "dashboard") */}

      {/* #region Οθόνη: Διαχείριση (phase "control") */}
      {/* ADMIN PAGE (Build 3B1): every admin tool for running the app, in one place */}
      {phase === "control" && isAdmin && (
        <>
          <div className="header">
            <p className="eyebrow">{L.controlEyebrow}</p>
            <h1>{L.controlTitle}</h1>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content">
            {notice && (
              <div className="notice">
                <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{notice}</span>
              </div>
            )}

            <div className="tabs control-tabs">
              <button className={`tab ${controlTab === "overview" ? "active" : ""}`} onClick={() => setControlTab("overview")}>Επισκόπηση</button>
              <button className={`tab ${controlTab === "competitions" ? "active" : ""}`} onClick={() => setControlTab("competitions")}>Διοργανώσεις, σεζόν & σύλλογοι</button>
              <button className={`tab ${controlTab === "players" ? "active" : ""}`} onClick={() => setControlTab("players")}>Παίκτες</button>
              <button className={`tab ${controlTab === "data" ? "active" : ""}`} onClick={() => setControlTab("data")}>Δεδομένα</button>
              <button className={`tab ${controlTab === "backup" ? "active" : ""}`} onClick={() => setControlTab("backup")}>Backup</button>
              <button className={`tab ${controlTab === "settings" ? "active" : ""}`} onClick={() => setControlTab("settings")}>Ρυθμίσεις</button>
              <button className={`tab ${controlTab === "imports" ? "active" : ""}`} onClick={() => { setControlTab("imports"); if (importsList === null) loadImportsList(); }}>Εισαγωγές</button>
            </div>

            {controlTab === "overview" && (
              <>
            {/* 1. Status */}
            {(() => {
              const current = currentSeasonId(sysState, DEFAULT_COMPETITION_ID);
              const lastExport = sysState.lastExportAt ? new Date(sysState.lastExportAt) : null;
              const daysSince = lastExport ? Math.floor((Date.now() - lastExport.getTime()) / 86400000) : null;
              const healthOk = health && !(health.needsRecompute && staleReasons.length > 0);
              return (
                <div className="card control-section">
                  <h2 className="control-h">Κατάσταση εφαρμογής</h2>
                  <dl className="details-list">
                    {controlSeasons
                      .filter((y) => y < current && !seasonLocked(sysState, y))
                      .map((y) => (
                        <React.Fragment key={y}>
                          <dt>Σεζόν {sn(y)}</dt>
                          <dd style={{ color: "#9a5b00" }}>
                            Έχει τελειώσει αλλά δεν έχει κλείσει —{" "}
                            <button className="history-link" onClick={() => { setControlCompId(seasonCompetitionId(sysState, y)); setControlSeasonYear(y); setControlTab("competitions"); }}>κλείσιμο σεζόν</button>
                          </dd>
                        </React.Fragment>
                      ))}
                    <dt>Τρέχουσα σεζόν</dt>
                    <dd>{sn(current)}{seasonLocked(sysState, current) ? " 🔒" : ""}</dd>
                    {(() => {
                      const prog = calendarProgress(buildCalendarView(sysState, current, archive));
                      return (
                        <>
                          <dt>Πρόοδος σεζόν</dt>
                          <dd>
                            {prog.total > 0 ? `Αγωνιστική ${prog.done} από ${prog.total}` : "Χωρίς ημερολόγιο ακόμα"}
                            {prog.next ? ` · ${prog.next.status === "live" ? "σε εξέλιξη" : "επόμενη"}: ${formatYMD(prog.next.effectiveDate)}` : ""}
                          </dd>
                        </>
                      );
                    })()}
                    <dt>Τελευταίο Export All Data</dt>
                    <dd style={{ color: !lastExport || daysSince > 30 ? "#9a5b00" : undefined }}>
                      {lastExport ? `${formatDate(sysState.lastExportAt)} (πριν ${daysSince} ${daysSince === 1 ? "ημέρα" : "ημέρες"})` : "Ποτέ"}
                    </dd>
                    <dt>Τελευταίο Recompute</dt>
                    <dd>{builtFrom ? `${formatDate(builtFrom.at)} — ${builtFrom.tournaments} τουρνουά, ${builtFrom.matches} αγώνες` : "—"}</dd>
                    <dt>Συνέπεια δεδομένων</dt>
                    <dd style={{ color: health ? (healthOk ? "var(--win)" : "#9a5b00") : undefined }}>
                      {!health ? "Έλεγχος…" : healthOk ? "✓ ELO και Βαθμολογία ταιριάζουν με τα τουρνουά" : `⚠ ${staleReasons.length} ${staleReasons.length === 1 ? "εύρημα" : "ευρήματα"} — δες το tab «Δεδομένα»`}
                    </dd>
                    <dt>Build</dt>
                    <dd>{APP_BUILD_VERSION}</dd>
                  </dl>
                </div>
              );
            })()}

              <div className="dashboard-grid" style={{ marginTop: 4 }}>
                <button className="dashboard-card" onClick={() => setControlTab("competitions")}>
                  <span className="dashboard-card-title">Σεζόν & ημερολόγιο</span>
                  <span className="dashboard-card-desc">Νέα σεζόν, κανόνες Βαθμολογίας, αγωνιστικές</span>
                </button>
                <button className="dashboard-card" onClick={() => setControlTab("competitions")}>
                  <span className="dashboard-card-title">Διοργανώσεις & σύλλογοι</span>
                  <span className="dashboard-card-desc">Διοργανώσεις, λίστα συλλόγων, ο σύλλογός σου</span>
                </button>
                <button className="dashboard-card" onClick={() => setControlTab("players")}>
                  <span className="dashboard-card-title">Παίκτες</span>
                  <span className="dashboard-card-desc">Μόνιμα ID, Αριθμός Μητρώου</span>
                </button>
                <button className="dashboard-card" onClick={() => setControlTab("data")}>
                  <span className="dashboard-card-title">Δεδομένα</span>
                  <span className="dashboard-card-desc">Recompute, έλεγχος συνέπειας, Excel, Κάδος</span>
                </button>
                <button className="dashboard-card" onClick={() => setControlTab("backup")}>
                  <span className="dashboard-card-title">Backup</span>
                  <span className="dashboard-card-desc">Export All Data, επαναφορά</span>
                </button>
                <button className="dashboard-card" onClick={() => setControlTab("settings")}>
                  <span className="dashboard-card-title">Ρυθμίσεις</span>
                  <span className="dashboard-card-desc">RSS feed, λογαριασμός</span>
                </button>
              </div>
              </>
            )}

            {controlTab === "competitions" && (() => {
              // 5B.2β: seasons live inside their competition.
              const compSeasons = seasonsOfCompetition(sysState, controlCompId, controlSeasons).slice().reverse();
              const resetDrafts = () => { setCalDraft(null); setRulesDraft(null); setLockAction(null); };
              return (
            <div className="card control-section">
              <h2 className="control-h">Σεζόν διοργάνωσης</h2>
              <p className="control-sub">Διάλεξε διοργάνωση και σεζόν για τους κανόνες Βαθμολογίας, το ημερολόγιο και το κλείσιμό της. Η σεζόν δεν δένεται με ημερομηνίες: κάθε τουρνουά δηλώνει τη σεζόν του.</p>
              <div className="round-pills" style={{ marginBottom: 10 }}>
                {competitionsFrom(sysState).map((c) => (
                  <button key={c.id} className={`round-pill ${controlCompId === c.id ? "active" : ""}`} onClick={() => { setControlCompId(c.id); setControlSeasonYear(currentSeasonId(sysState, c.id, controlSeasons)); setNewSeasonYear(null); resetDrafts(); }}>
                    {c.name}
                  </button>
                ))}
              </div>
              {newSeasonYear === null ? (
                <button className="btn-secondary" onClick={() => setNewSeasonYear("")}>
                  <Plus size={14} /> Νέα σεζόν
                </button>
              ) : (
                <div className="row" style={{ alignItems: "flex-end" }}>
                  <div style={{ width: 180 }}>
                    <label>Όνομα σεζόν</label>
                    <input type="text" value={newSeasonYear} placeholder="π.χ. 2027 ή 2026–27" onChange={(e) => setNewSeasonYear(e.target.value)} />
                  </div>
                  <span style={{ fontSize: 13, color: "var(--muted)", paddingBottom: 10 }}>Οι κανόνες αντιγράφονται από την προηγούμενη σεζόν της διοργάνωσης.</span>
                  <button className="btn-secondary" onClick={() => setNewSeasonYear(null)}>Άκυρο</button>
                  <button className="btn-primary" onClick={createSeason} disabled={!String(newSeasonYear).trim()}>Δημιουργία</button>
                </div>
              )}
              {compSeasons.length > 0 ? (
                <div className="round-pills" style={{ marginTop: 12 }}>
                  {compSeasons.map((s) => (
                    <button key={s.id} className={`round-pill ${controlSeasonYear === s.id ? "active" : ""}`} onClick={() => { setControlSeasonYear(s.id); resetDrafts(); }}>
                      Σεζόν {s.name}{seasonLocked(sysState, s.id) ? " 🔒" : ""}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="control-sub" style={{ marginTop: 10 }}>Η διοργάνωση δεν έχει ακόμα σεζόν.</p>
              )}
              {compSeasons.some((s) => s.id === controlSeasonYear) && (
                <div className="control-season">
                  {renderSeasonRulesCard(controlSeasonYear)}
                  {renderCalendarCard(controlSeasonYear)}
                  {renderSeasonCloseCard(controlSeasonYear)}
                </div>
              )}
            </div>
              );
            })()}

            {controlTab === "competitions" && (
              <>
            <div className="card control-section">
              <h2 className="control-h">Διοργανώσεις & σύλλογοι</h2>
              {renderCompetitionsCard()}
              {isAdmin && (() => {
                const exportFresh = !!sysState.lastExportAt && Date.now() - new Date(sysState.lastExportAt).getTime() < 24 * 3600 * 1000;
                const comps = competitionsFrom(sysState);
                const migrated = sysState.tournamentMetaVersion === 1;
                const rows = metaPlan ? metaPlan.rows : [];
                const toFill = rows.filter((r) => r.needsCompetition || r.needsOrganisation || r.needsSeason);
                const mismatches = rows.filter((r) => r.seasonMismatch);
                const noDate = rows.filter((r) => r.noDate);
                return (
                  <div className="control-sub-card">
                    <strong>Διοργανώσεις</strong>

                    {!clubsActive(sysState) && (
                    <div className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
                      <div className="field">
                        <label>Ο σύλλογός σου (προεπιλογή σε κάθε νέο τουρνουά)</label>
                        <input
                          type="text"
                          value={homeClubDraft ?? (sysState.homeClub || "")}
                          onChange={(e) => setHomeClubDraft(e.target.value)}
                          placeholder="Όνομα συλλόγου"
                        />
                      </div>
                      <button className="btn-secondary" onClick={saveHomeClub} disabled={homeClubDraft === null || homeClubDraft.trim() === (sysState.homeClub || "")}>
                        <Save size={15} /> Αποθήκευση
                      </button>
                    </div>
                    )}

                    <p style={{ margin: "10px 0 0 0", fontSize: 13, color: "var(--muted)" }}>
                      Διοργανώσεις: {comps.map((c) => `${c.name} (${COMPETITION_LEVEL_LABEL[c.level] || c.level}, ${ELO_POOLS[eloPoolOf(c.id)]?.active ? "μετράει στην " + ELO_POOLS[eloPoolOf(c.id)].label : "δεξαμενή ELO: " + (ELO_POOLS[eloPoolOf(c.id)]?.label || "—") + ", ανενεργή ακόμα"})`).join("; ")}. Μέχρι το Build 3, σε ELO και Βαθμολογία μετράνε μόνο τα επίσημα τουρνουά Premier League.
                    </p>

                    <div style={{ marginTop: 12 }}>
                      {migrated && !metaPlan ? (
                        <p style={{ margin: 0, fontSize: 13, color: "var(--win)" }}>
                          ✓ Όλα τα τουρνουά έχουν διοργάνωση και σύλλογο{sysState.tournamentMetaMigratedAt ? ` (μετάπτωση ${formatDate(sysState.tournamentMetaMigratedAt)})` : ""}.{" "}
                          <button className="btn-ghost" onClick={runMetaPlan} disabled={metaBusy} style={{ padding: "2px 8px" }}>
                            {metaBusy ? "Έλεγχος…" : "Έλεγχος ξανά"}
                          </button>
                        </p>
                      ) : !metaPlan ? (
                        <>
                          <p style={{ margin: "0 0 8px 0", fontSize: 13 }}>
                            Τα υπάρχοντα τουρνουά δεν έχουν ακόμα διοργάνωση και σύλλογο. Η μετάπτωση τους δίνει Premier League και τον σύλλογό σου· σεζόν και ημερομηνία που ήδη υπάρχουν δεν αλλάζουν. Πρώτα βλέπεις αναφορά.
                          </p>
                          <button className="btn-secondary" onClick={runMetaPlan} disabled={metaBusy}>
                            {metaBusy ? "Έλεγχος…" : "Αναφορά μετάπτωσης (δεν αλλάζει τίποτα)"}
                          </button>
                        </>
                      ) : (
                        <>
                          <p style={{ margin: "0 0 6px 0", fontSize: 13 }}>
                            Ελέγχθηκαν <strong>{rows.length}</strong> τουρνουά ({rows.filter((r) => r.inTrash).length} στον κάδο).{" "}
                            {toFill.length === 0 ? "Κανένα δεν χρειάζεται συμπλήρωση." : <>Θα συμπληρωθούν <strong>{toFill.length}</strong>: διοργάνωση Premier League, σύλλογος «{sysState.homeClub || "—"}».</>}
                          </p>
                          {metaPlan.unreadable.length > 0 && (
                            <p className="field-warning">⚠ Δεν διαβάστηκαν: {metaPlan.unreadable.join(", ")}. Ξανατρέξε την αναφορά πριν την εφαρμογή.</p>
                          )}
                          {mismatches.length > 0 && (
                            <div className="field-warning">
                              ⚠ Σεζόν που δεν ταιριάζει με την ημερομηνία (δεν αλλάζει αυτόματα· διόρθωσέ τη μέσα στο τουρνουά αν χρειάζεται):
                              <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
                                {mismatches.map((r) => (
                                  <li key={r.id}>{r.name} — {formatDate(r.date)}, σεζόν {r.seasonYear} (η ημερομηνία ανήκει στη {r.expectedSeason})</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {noDate.length > 0 && (
                            <p className="field-warning">⚠ Χωρίς έγκυρη ημερομηνία ή πριν από τις 27/9/2025: {noDate.map((r) => r.name).join(", ")}.</p>
                          )}
                          {mismatches.length === 0 && noDate.length === 0 && metaPlan.unreadable.length === 0 && (
                            <p style={{ fontSize: 13, color: "var(--win)", margin: "0 0 6px 0" }}>✓ Όλες οι σεζόν ταιριάζουν με τις ημερομηνίες.</p>
                          )}
                          {!sysState.homeClub && (
                            <p className="field-warning">Συμπλήρωσε και αποθήκευσε πρώτα τον σύλλογό σου.</p>
                          )}
                          {!exportFresh && (
                            <div className="notice" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--ink)", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                              <span>Για να εφαρμόσεις τη μετάπτωση χρειάζεται <strong>Export All Data των τελευταίων 24 ωρών</strong>.</span>
                              <button className="btn-secondary" onClick={exportAllData}><Download size={15} /> Export τώρα</button>
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                            <button className="btn-secondary" onClick={() => setMetaPlan(null)} disabled={metaBusy}>Άκυρο</button>
                            <button
                              className="btn-primary"
                              onClick={applyMetaMigration}
                              disabled={metaBusy || !exportFresh || !sysState.homeClub || metaPlan.unreadable.length > 0}
                            >
                              {metaBusy ? "Μετάπτωση… (περίμενε)" : "Εφαρμογή μετάπτωσης"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div className="control-sub-card">
                <strong>Σύλλογοι</strong>
                {!clubsActive(sysState) ? (
                  <>
                    <p className="control-sub" style={{ marginTop: 6 }}>
                      Σήμερα ο σύλλογος γράφεται ελεύθερα, σε παίκτες και τουρνουά. Η μετάπτωση φτιάχνει μία λίστα συλλόγων από ό,τι υπάρχει και αντιστοιχίζει παίκτες και τουρνουά. Πρώτα βλέπεις αναφορά· εσύ αποφασίζεις ποιες γραφές είναι ο ίδιος σύλλογος.
                    </p>
                    {!clubPlan ? (
                      <button className="btn-secondary" onClick={runClubPlan} disabled={clubBusy}>
                        {clubBusy ? "Έλεγχος…" : "Αναφορά μετάπτωσης συλλόγων (δεν αλλάζει τίποτα)"}
                      </button>
                    ) : (
                      (() => {
                        const exportFresh = !!sysState.lastExportAt && Date.now() - new Date(sysState.lastExportAt).getTime() < 24 * 3600 * 1000;
                        const roots = clubPlan.list.filter((g) => resolveClubKey(g.key, clubDecisions) === g.key);
                        return (
                          <>
                            <p style={{ fontSize: 13, margin: "6px 0 8px 0" }}>
                              Βρέθηκαν <strong>{clubPlan.list.length}</strong> διαφορετικές γραφές συλλόγων (ελέγχθηκαν {clubPlan.scanned} τουρνουά). Θα δημιουργηθούν <strong>{roots.length}</strong> σύλλογοι.
                            </p>
                            {clubPlan.list.length === 0 && <p className="control-sub">Δεν υπάρχει κανένας σύλλογος γραμμένος· η λίστα θα ξεκινήσει κενή.</p>}
                            {clubPlan.list.length > 0 && (
                              <div style={{ overflowX: "auto" }}>
                                <table className="cal-table">
                                  <thead>
                                    <tr><th>Γραφή/ές</th><th>Παίκτες</th><th>Τουρνουά</th><th>Τι είναι</th><th>Όνομα συλλόγου</th></tr>
                                  </thead>
                                  <tbody>
                                    {clubPlan.list.map((g) => {
                                      const decision = clubDecisions[g.key] || "new";
                                      const sug = g.suggestion ? clubPlan.list.find((o) => o.key === g.suggestion) : null;
                                      return (
                                        <tr key={g.key}>
                                          <td>
                                            {g.variants.join(" / ")}
                                            {g.home && <span className="cal-note"> · ο σύλλογός σου</span>}
                                            {sug && decision === "new" && <div className="field-warning" style={{ margin: "2px 0 0 0" }}>Μήπως είναι ο «{sug.name}»;</div>}
                                          </td>
                                          <td>{g.players}</td>
                                          <td>{g.tournaments}</td>
                                          <td>
                                            <select value={decision} onChange={(e) => setClubDecisions({ ...clubDecisions, [g.key]: e.target.value })}>
                                              <option value="new">Νέος σύλλογος</option>
                                              {clubPlan.list
                                                .filter((o) => o.key !== g.key && resolveClubKey(o.key, clubDecisions) === o.key)
                                                .map((o) => (
                                                  <option key={o.key} value={o.key}>Ίδιος με «{clubNames[o.key] || o.name}»</option>
                                                ))}
                                            </select>
                                          </td>
                                          <td>
                                            {decision === "new" ? (
                                              <input type="text" value={clubNames[g.key] ?? g.name} onChange={(e) => setClubNames({ ...clubNames, [g.key]: e.target.value })} />
                                            ) : (
                                              <span className="cal-note">→ {clubNames[resolveClubKey(g.key, clubDecisions)] || ""}</span>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {clubPlan.unreadable.length > 0 && <p className="field-warning">⚠ Δεν διαβάστηκαν {clubPlan.unreadable.length} τουρνουά· ξανατρέξε την αναφορά.</p>}
                            {!exportFresh && (
                              <div className="notice" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--ink)", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                                <span>Για να εφαρμόσεις τη μετάπτωση χρειάζεται <strong>Export All Data των τελευταίων 24 ωρών</strong>.</span>
                                <button className="btn-secondary" onClick={exportAllData}><Download size={15} /> Export τώρα</button>
                              </div>
                            )}
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                              <button className="btn-secondary" onClick={() => setClubPlan(null)} disabled={clubBusy}>Άκυρο</button>
                              <button className="btn-primary" onClick={applyClubMigration} disabled={clubBusy || !exportFresh || clubPlan.unreadable.length > 0}>
                                {clubBusy ? "Μετάπτωση… (περίμενε)" : "Εφαρμογή μετάπτωσης"}
                              </button>
                            </div>
                          </>
                        );
                      })()
                    )}
                  </>
                ) : (
                  <>
                    <p className="control-sub" style={{ marginTop: 6 }}>
                      Η λίστα συλλόγων που χρησιμοποιούν παίκτες και τουρνουά. Ο σύλλογός σου είναι η προεπιλογή σε κάθε νέο τουρνουά.
                    </p>
                    <table className="cal-table">
                      <thead>
                        <tr><th>Σύλλογος</th><th>Παίκτες</th><th>Ο σύλλογός μου</th><th title="Φορέας διοργανώσεων — δεν εμφανίζεται στους παίκτες">Φορέας</th><th></th></tr>
                      </thead>
                      <tbody>
                        {[...clubsFrom(sysState)]
                          .sort((a, b) => a.name.localeCompare(b.name, "el"))
                          .map((c) => (
                            <tr key={c.id}>
                              <td>
                                {clubDraft && clubDraft.id === c.id ? (
                                  <input type="text" value={clubDraft.name} onChange={(e) => setClubDraft({ ...clubDraft, name: e.target.value })} />
                                ) : (
                                  c.name
                                )}
                              </td>
                              <td>{Object.values(registry.players).filter((p) => p.clubId === c.id).length}</td>
                              <td>
                                {!c.organiserOnly && <input type="radio" name="home-club" checked={sysState.homeClubId === c.id} onChange={() => setHomeClubId(c.id)} />}
                              </td>
                              <td>
                                <input type="checkbox" checked={!!c.organiserOnly} onChange={() => toggleClubOrganiserOnly(c)} disabled={sysState.homeClubId === c.id} />
                              </td>
                              <td style={{ whiteSpace: "nowrap" }}>
                                {clubDraft && clubDraft.id === c.id ? (
                                  <>
                                    <button className="btn-ghost" onClick={() => setClubDraft(null)}>Άκυρο</button>
                                    <button className="btn-secondary" onClick={saveClubDraft}>Αποθήκευση</button>
                                  </>
                                ) : (
                                  <button className="btn-ghost" style={{ padding: "2px 6px" }} onClick={() => setClubDraft({ id: c.id, name: c.name })} title="Μετονομασία">
                                    <Pencil size={13} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {clubDraft && !clubDraft.id ? (
                      <div className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
                        <div className="field">
                          <label>Νέος σύλλογος</label>
                          <input type="text" value={clubDraft.name} onChange={(e) => setClubDraft({ ...clubDraft, name: e.target.value })} />
                        </div>
                        <button className="btn-secondary" onClick={() => setClubDraft(null)}>Άκυρο</button>
                        <button className="btn-primary" onClick={saveClubDraft} disabled={!clubDraft.name.trim()}>Προσθήκη</button>
                      </div>
                    ) : (
                      <button className="btn-secondary" style={{ marginTop: 10 }} onClick={() => setClubDraft({ name: "" })}>
                        <Plus size={14} /> Νέος σύλλογος
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
              </>
            )}

            {controlTab === "players" && (
              <>
            <div className="card control-section">
              <h2 className="control-h">Παίκτες</h2>
              <ContactsMigrationCard
                moved={registry.contactsVersion === 1}
                preview={contactsPreview}
                busy={contactsBusy}
                exportFresh={!!sysState.lastExportAt && Date.now() - new Date(sysState.lastExportAt).getTime() < 24 * 3600 * 1000}
                onPreview={() => setContactsPreview(contactsSummary(registry))}
                onApply={applyContactsMigration}
                onCancel={() => setContactsPreview(null)}
              />
              {(() => {
                const exportFresh = !!sysState.lastExportAt && Date.now() - new Date(sysState.lastExportAt).getTime() < 24 * 3600 * 1000;
                const sortedPersons = Object.entries(registry.players).sort((a, b) => a[1].name.localeCompare(b[1].name, "el"));
                return (
                  <div className="control-sub-card">
                    <strong>Μόνιμα ID παικτών</strong>
                    {registry.identityVersion === 2 ? (
                      <p style={{ margin: "6px 0 0 0", fontSize: 13, color: "var(--muted)" }}>
                        ✓ Ενεργά{registry.migratedAt ? ` (μετάβαση ${formatDate(registry.migratedAt)})` : ""}. Κάθε παίκτης έχει μόνιμο ID και όλες οι γραφές του ονόματός του οδηγούν στο ίδιο πρόσωπο.
                      </p>
                    ) : (
                      <>
                        <p style={{ margin: "6px 0 10px 0", fontSize: 13, color: "var(--muted)" }}>
                          Σήμερα ο παίκτης αναγνωρίζεται από το όνομά του. Η μετάβαση δίνει σε κάθε παίκτη μόνιμο ID, ώστε μια μετονομασία ή διόρθωση γραφής να μη χάνει ιστορικό. Πρώτα βλέπεις αναφορά, χωρίς καμία αλλαγή.
                        </p>
                        {!identityPlan ? (
                          <button className="btn-secondary" onClick={runIdentityPlan} disabled={identityBusy}>
                            {identityBusy ? "Έλεγχος…" : "Αναφορά μετάβασης (δεν αλλάζει τίποτα)"}
                          </button>
                        ) : (
                          <>
                            <p style={{ margin: "0 0 8px 0", fontSize: 13 }}>
                              Ελέγχθηκαν {identityPlan.scanned} τουρνουά. Θα δημιουργηθούν <strong>{identityPlan.persons}</strong> μόνιμα ID από το μητρώο.
                            </p>
                            {identityPlan.unmatched.length === 0 ? (
                              <p style={{ fontSize: 13, color: "var(--win)", margin: "0 0 8px 0" }}>✓ Όλα τα ονόματα των τουρνουά υπάρχουν στο μητρώο.</p>
                            ) : (
                              <div style={{ margin: "0 0 10px 0" }}>
                                <p style={{ fontSize: 13, margin: "0 0 6px 0" }}>
                                  <strong>{identityPlan.unmatched.length}</strong> {identityPlan.unmatched.length === 1 ? "όνομα" : "ονόματα"} στα τουρνουά δεν υπάρχουν στο μητρώο. Για καθένα, διάλεξε αν είναι ήδη κάποιος παίκτης ή νέο πρόσωπο:
                                </p>
                                {identityPlan.unmatched.map((u) => (
                                  <div key={u.base} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6, fontSize: 13 }}>
                                    <span style={{ minWidth: 190 }}><strong>{u.name}</strong> ({u.tournaments} τουρνουά)</span>
                                    <select value={identityDecisions[u.base] ?? u.defaultChoice} onChange={(e) => setIdentityDecisions({ ...identityDecisions, [u.base]: e.target.value })}>
                                      <option value="new">Νέο πρόσωπο</option>
                                      {u.candidates.map((c) => (
                                        <option key={c.key} value={c.key}>Είναι ο/η {c.name}</option>
                                      ))}
                                      <optgroup label="Άλλος παίκτης του μητρώου">
                                        {sortedPersons.filter(([k]) => !u.candidates.some((c) => c.key === k)).map(([k, q]) => (
                                          <option key={k} value={k}>{q.name}</option>
                                        ))}
                                      </optgroup>
                                    </select>
                                    {u.reason && <span style={{ color: "var(--muted)" }}>{u.reason}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                            {identityPlan.duplicates.length > 0 && (
                              <p style={{ fontSize: 13, margin: "0 0 10px 0" }}>
                                Πιθανά διπλά πρόσωπα στο μητρώο (θα μπορείς να τα ενώσεις μετά): {identityPlan.duplicates.map((g) => g.join(" ↔ ")).join(" · ")}
                              </p>
                            )}
                            {!exportFresh && (
                              <div className="notice" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--ink)", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                                <span>Για να εφαρμόσεις τη μετάβαση χρειάζεται <strong>Export All Data των τελευταίων 24 ωρών</strong>.</span>
                                <button className="btn-secondary" onClick={exportAllData}><Download size={15} /> Export τώρα</button>
                              </div>
                            )}
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button className="btn-secondary" onClick={() => setIdentityPlan(null)} disabled={identityBusy}>Άκυρο</button>
                              <button className="btn-primary" onClick={applyIdentityMigration} disabled={identityBusy || !exportFresh}>
                                {identityBusy ? "Μετάβαση… (περίμενε)" : "Εφαρμογή μετάβασης"}
                              </button>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}

              <div className="control-sub-card">
                <strong>Αριθμός Μητρώου</strong>
                {registry.regNoVersion === 1 ? (
                  <p style={{ margin: "6px 0 0 0", fontSize: 13, color: "var(--muted)" }}>
                    ✓ Ενεργός. Κάθε παίκτης έχει αριθμό (#001, #002…) με σειρά πρώτης συμμετοχής· οι νέοι παίρνουν τον επόμενο ({formatRegNo(nextRegNo(registry))}). Αριθμός δεν ξαναδίνεται, ούτε μετά από διαγραφή ή ένωση.
                  </p>
                ) : !regNoPlan ? (
                  <>
                    <p className="control-sub" style={{ marginTop: 6 }}>
                      Δίνει σε κάθε παίκτη έναν ευανάγνωστο αριθμό, με σειρά πρώτης συμμετοχής σε τουρνουά· όσοι δεν έχουν παίξει ακόμα παίρνουν τους επόμενους, αλφαβητικά. Το εσωτερικό ID δεν αλλάζει.
                    </p>
                    <button className="btn-secondary" onClick={runRegNoPlan} disabled={clubBusy}>
                      {clubBusy ? "Υπολογισμός…" : "Προεπισκόπηση αριθμών (δεν αλλάζει τίποτα)"}
                    </button>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: 13, margin: "6px 0" }}>
                      <strong>{regNoPlan.order.length}</strong> παίκτες ({regNoPlan.played} με συμμετοχή). Πρώτοι:{" "}
                      {regNoPlan.order.slice(0, 5).map((k, i) => `${formatRegNo(i + 1)} ${registry.players[k]?.name}`).join(" · ")}
                    </p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn-secondary" onClick={() => setRegNoPlan(null)}>Άκυρο</button>
                      <button className="btn-primary" onClick={applyRegNos}>Απόδοση αριθμών</button>
                    </div>
                  </>
                )}
              </div>
            </div>
              </>
            )}

            {controlTab === "data" && (
              <>
            {/* 4. Data */}
            <div className="card control-section">
              <h2 className="control-h">Δεδομένα</h2>
              {recomputePanel}
              <div className="footer-actions" style={{ marginTop: 12 }}>
                <button className="btn-secondary" onClick={() => setPhase("trash")}>
                  <Trash2 size={15} /> Κάδος ({trash.length})
                </button>
              </div>
            </div>
              </>
            )}

            {controlTab === "backup" && (
              <>
            {/* 5. Backup */}
            <div className="card control-section">
              <h2 className="control-h">Backup</h2>
              <p className="control-sub">
                Πλήρες αντίγραφο όλων των δεδομένων σε αρχείο. Τελευταίο: {sysState.lastExportAt ? formatDate(sysState.lastExportAt) : "ποτέ"}.
              </p>
              <button className="btn-secondary" onClick={exportAllData}>
                <Download size={15} /> Export All Data (full backup)
              </button>
            </div>

            {/* 8. Danger zone */}
            <div className="card control-section control-danger">
              <h2 className="control-h">Επικίνδυνες ενέργειες</h2>
              <p className="control-sub">
                Η επαναφορά από backup <strong>αντικαθιστά όλα τα τρέχοντα δεδομένα</strong> (μητρώο, ELO, κατάλογο, σεζόν, τουρνουά) με εκείνα του αρχείου. Κάνε πρώτα Export All Data.
              </p>
              {!confirmingRestore ? (
                <button className="btn-secondary" onClick={() => setConfirmingRestore(true)}>
                  <Upload size={15} /> Επαναφορά από backup…
                </button>
              ) : (
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 14 }}>Σίγουρα; Τα τρέχοντα δεδομένα θα αντικατασταθούν.</strong>
                  <button className="btn-ghost" onClick={() => setConfirmingRestore(false)}>Άκυρο</button>
                  <button
                    className="btn-primary"
                    style={{ background: "#c0392b" }}
                    onClick={() => {
                      setConfirmingRestore(false);
                      fullBackupInputRef.current?.click();
                    }}
                  >
                    Επιλογή αρχείου backup
                  </button>
                </span>
              )}
              <input type="file" accept="application/json" ref={fullBackupInputRef} onChange={importAllData} style={{ display: "none" }} />
            </div>
              </>
            )}

            {controlTab === "imports" && renderImportsTab()}

            {controlTab === "settings" && (
              <>
            {/* 6. Publishing */}
            <div className="card control-section">
              <h2 className="control-h">Δημοσίευση (RSS feed για το bgfed.gr)</h2>
              {!confirmingClearFeed ? (
                <button className="btn-secondary" onClick={() => setConfirmingClearFeed(true)}>
                  <X size={15} /> Άδειασμα RSS feed
                </button>
              ) : (
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)", flexWrap: "wrap" }}>
                  Σίγουρα; Δεν επηρεάζει άρθρα που έχουν ήδη μπει στο bgfed.gr.
                  <button className="btn-ghost" onClick={() => setConfirmingClearFeed(false)}>Άκυρο</button>
                  <button className="btn-secondary" onClick={() => { clearFeed(); setConfirmingClearFeed(false); }}>Ναι, άδειασμα</button>
                </span>
              )}
            </div>

            {/* 7. Security */}
            {!inIframe && (
              <div className="card control-section">
                <h2 className="control-h">Ασφάλεια</h2>
                <p className="control-sub" style={{ margin: 0 }}>
                  Συνδεδεμένος ως <strong>{authUser ? authUser.email || authUser.uid : "—"}</strong>. Κάθε διαχειριστής μπαίνει με τον δικό του λογαριασμό (Google ή email).
                  Η λίστα διαχειριστών αλλάζει μόνο από το Firebase console (συλλογή <code>users</code>).
                </p>
              </div>
            )}
              </>
            )}

          </div>
        </>
      )}
      {/* #endregion Οθόνη: Διαχείριση (phase "control") */}

      {/* #region Οθόνη: Αρχείο τουρνουά (phase "archive") */}
      {/* TOURNAMENT ARCHIVE */}
      {phase === "archive" && (
        <>
          <div className="header">
            <p className="eyebrow">{L.archiveEyebrow}</p>
            <h1>{L.archiveTitle}</h1>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content">
            {notice && (
              <div className="notice">
                <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{notice}</span>
              </div>
            )}

            {isAdmin && (
              <div className="footer-actions" style={{ marginTop: 0, marginBottom: 20 }}>
                <button className="btn-primary" onClick={goToNewTournament}>
                  <Plus size={16} /> New Tournament
                </button>
              </div>
            )}

            <div className="filters">
              <div className="field">
                <label>Search by name</label>
                <input type="text" value={searchName} onChange={(e) => setSearchName(e.target.value)} placeholder="e.g. Championship" />
              </div>
              <div className="field">
                <label>From date</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="field">
                <label>To date</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              <div style={{ width: 140 }}>
                <label>Σεζόν</label>
                <select value={archiveSeason} onChange={(e) => setArchiveSeason(e.target.value)} style={{ width: "100%", fontFamily: "'Source Sans 3', sans-serif", fontSize: 15, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 7, background: "#fff" }}>
                  <option value="">Όλες</option>
                  {archiveSeasonOptions.map((y) => <option key={y} value={y}>{sn(y)}</option>)}
                </select>
              </div>
              <div style={{ width: 180 }}>
                <label>Διοργάνωση</label>
                <select value={archiveCompetition} onChange={(e) => setArchiveCompetition(e.target.value)} style={{ width: "100%", fontFamily: "'Source Sans 3', sans-serif", fontSize: 15, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 7, background: "#fff" }}>
                  <option value="">Όλες</option>
                  {competitionsFrom(sysState).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>

            {visibleArchive.length === 0 && (
              <div className="empty-state">
                <Search size={20} style={{ marginBottom: 6 }} />
                <p>No tournaments found{archiveHasFilter ? " matching these filters." : "."}</p>
              </div>
            )}

            {visibleArchive.map((t) => (
              <div className="archive-row" key={t.id} onClick={() => (t.imported ? openImportPublic(t.id, { kind: "archive" }) : openArchived(t.id))}>
                <span className="archive-name">
                  {t.name}
                  {!t.isOfficial && <span className="status-chip test" style={{ marginLeft: 8 }}>Test</span>}
                  {t.imported && <span className="status-chip imported" style={{ marginLeft: 8 }}>Εισαγόμενο</span>}
                </span>
                <span className="archive-meta">
                  <span className="cal-note">
                    Σεζόν {(Number(t.seasonYear) || seasonForDate(t.date)) ? sn(Number(t.seasonYear) || seasonForDate(t.date)) : "—"} · {competitionName(competitionsFrom(sysState), t.competitionId || DEFAULT_COMPETITION_ID)}
                  </span>
                  {formatDate(t.date)}
                  <span className={`status-chip ${t.status === "Completed" ? "done" : "live"}`}>{t.status}</span>
                </span>
              </div>
            ))}

            {!archiveHasFilter && filteredArchive.length > 10 && !showAllArchive && (
              <button className="btn-ghost" onClick={() => setShowAllArchive(true)}>
                Show all ({filteredArchive.length})
              </button>
            )}
          </div>
        </>
      )}
      {/* #endregion Οθόνη: Αρχείο τουρνουά (phase "archive") */}

      {/* #region Οθόνη: Εισαγόμενο τουρνουά (phase "imported") */}
      {/* IMPORTED TOURNAMENT (public, read-only) */}
      {phase === "imported" && importView && (
        <>
          <div className="header">
            <p className="eyebrow">{competitionName(competitionsFrom(sysState), importCompetitionId(importView.doc))} · {importDateLabel(importView.doc)}</p>
            <h1>{importView.doc.name}</h1>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content">
            <button className="btn-secondary" onClick={backFromImport} style={{ marginBottom: 12 }}>
              <ArrowLeft size={15} /> {importReturn?.kind === "player" ? `Πίσω στον παίκτη (${registry.players[importReturn.key]?.name || ""})` : "Πίσω στα τουρνουά"}
            </button>
            <p className="cal-note" style={{ marginBottom: 12 }}>
              Τουρνουά που διεξήχθη εκτός εφαρμογής ({importView.doc.sourceName || "εξωτερική πηγή"}) — δεν μετράει στην ELO και στη Βαθμολογία της {clubDisplay(sysState, sysState.homeClubId, "Ομοσπονδίας")}.
            </p>
            {renderImportBody(false)}
          </div>
        </>
      )}
      {/* #endregion Οθόνη: Εισαγόμενο τουρνουά (phase "imported") */}

      {/* #region Οθόνη: Κάδος (phase "trash") */}
      {/* TRASH */}
      {phase === "trash" && (
        <>
          <div className="header">
            <p className="eyebrow">Διαχείριση</p>
            <h1>Κάδος τουρνουά</h1>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content">
            {!isAdmin ? (
              <div className="empty-state">Ο κάδος είναι διαθέσιμος μόνο σε Admin.</div>
            ) : (
              <>
                <div className="footer-actions" style={{ marginTop: 0, marginBottom: 16 }}>
                  <button className="btn-secondary" onClick={() => { setControlTab("data"); setPhase("control"); }}>
                    <ArrowLeft size={15} /> Πίσω στη Διαχείριση
                  </button>
                </div>
                <div className="notice">
                  <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    Τα τουρνουά στον κάδο δεν μετράνε σε Βαθμολογία, ELO και Στατιστικά, αλλά μένουν αποθηκευμένα και μπορούν να επανέλθουν. Ένα επίσημο τουρνουά δεν διαγράφεται οριστικά: πρέπει πρώτα να σημειωθεί ως ανεπίσημο.
                  </span>
                </div>
                {trash.length === 0 ? (
                  <div className="empty-state"><p>Ο κάδος είναι άδειος.</p></div>
                ) : (
                  [...trash]
                    .sort((a, b) => String(b.deletedAt || "").localeCompare(String(a.deletedAt || "")))
                    .map((entry) => (
                      <TrashRow
                        key={entry.id}
                        entry={entry}
                        busy={trashBusy}
                        action={trashAction && trashAction.id === entry.id ? trashAction.type : null}
                        onAction={(type) => setTrashAction(type ? { type, id: entry.id } : null)}
                        onRestore={(rec) => restoreFromTrash(entry.id, rec)}
                        onPurge={() => purgeFromTrash(entry.id)}
                        onUnofficial={() => markTrashedUnofficial(entry.id)}
                      />
                    ))
                )}
              </>
            )}
          </div>
        </>
      )}
      {/* #endregion Οθόνη: Κάδος (phase "trash") */}

      {/* #region Οθόνη: Νέο τουρνουά (phase "setup") */}
      {/* SETUP */}
      {phase === "setup" && !isAdmin && (
        <div className="content">
          <div className="empty-state">Creating a tournament is only available in Admin mode.</div>
        </div>
      )}
      {phase === "setup" && isAdmin && (
        <>
          <div className="header">
            <p className="eyebrow">New Tournament</p>
            <h1>Setup</h1>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content">
            {notice && (
              <div className="notice">
                <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{notice}</span>
              </div>
            )}
            <div className="card">
              {(() => {
                const view = buildCalendarView(sysState, seasonYear, archive);
                const options = view.filter((e) => !e.tournament || e.id === calendarEntryId);
                if (view.length === 0) return null;
                return (
                  <div style={{ marginBottom: 14 }}>
                    <label>Αγωνιστική ημερολογίου (σεζόν {sn(seasonYear)})</label>
                    <select
                      value={calendarEntryId || ""}
                      onChange={(e) => applyCalendarEntry(view.find((x) => x.id === e.target.value) || null, seasonYear)}
                      style={{ width: "100%", maxWidth: 520, fontFamily: "'Source Sans 3', sans-serif", fontSize: 15, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 7, background: "#fff" }}
                    >
                      <option value="">Χωρίς αγωνιστική (έκτακτο ή δοκιμαστικό τουρνουά)</option>
                      {options.map((e) => (
                        <option key={e.id} value={e.id}>
                          {(e.day ? `Ημέρα ${e.day}` : competitionName(competitionsFrom(sysState), e.competitionId))} — {formatYMD(e.effectiveDate)}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })()}
              <div className="row" style={{ marginBottom: 14 }}>
                <div className="field">
                  <label>Tournament name (optional)</label>
                  <input type="text" value={tournamentName} onChange={(e) => setTournamentName(e.target.value)} placeholder="e.g. 14th National Championship" />
                </div>
                <div style={{ width: 110 }}>
                  <label>Rounds</label>
                  <input type="number" min={3} max={9} value={totalRounds} onChange={(e) => setTotalRounds(Math.max(3, Math.min(9, Number(e.target.value) || 5)))} />
                </div>
                <div style={{ width: 130 }}>
                  <label>Match length</label>
                  <input type="number" min={1} max={25} value={matchLength} onChange={(e) => setMatchLength(Math.max(1, Math.min(25, Number(e.target.value) || 7)))} />
                </div>
                <div style={{ width: 160 }}>
                  <label>Ημερομηνία</label>
                  <input
                    type="date"
                    required
                    value={isoToLocalYMD(createdAt)}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      const nextIso = withLocalDate(createdAt, e.target.value);
                      setCreatedAt(nextIso);
                    }}
                  />
                </div>
                <div style={{ width: 160 }}>
                  <label>Σεζόν</label>
                  {renderSeasonSelect(competitionId, seasonYear, setSeasonYear)}
                </div>
              </div>
              <div className="row" style={{ marginBottom: 14 }}>
                <div style={{ width: 220 }}>
                  <label>Διοργάνωση</label>
                  <select
                    value={competitionId}
                    onChange={(e) => { setCompetitionId(e.target.value); setSeasonYear(currentSeasonId(sysState, e.target.value, controlSeasons)); }}
                    style={{ width: "100%", fontFamily: "'Source Sans 3', sans-serif", fontSize: 15, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 7, background: "#fff" }}
                  >
                    {competitionsFrom(sysState).map((c) => (
                      <option key={c.id} value={c.id}>{competitionLabel(sysState, c)}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Σύλλογος της διοργάνωσης</label>
                  <div style={{ padding: "9px 0", fontSize: 15, color: "var(--muted)" }}>
                    {(() => {
                      const c = competitionById(competitionId);
                      return c && c.ownerClubId ? clubDisplay(sysState, c.ownerClubId, "—") : "—";
                    })()}
                  </div>
                </div>
              </div>
              {!countsTowardRatings({ isOfficial: true, competitionId }) && (
                <p className="field-warning" style={{ marginTop: -6, marginBottom: 12 }}>
                  Αυτή η διοργάνωση δεν μετράει στην ELO και στη Βαθμολογία της {clubDisplay(sysState, sysState.homeClubId, "Ομοσπονδίας")}· το τουρνουά καταγράφεται κανονικά.
                </p>
              )}

              <label className="live-toggle" style={{ marginBottom: 14 }} title="Only Official days are included when you use 'Recompute ELO & Season Standings from scratch' on the ELO page">
                <input type="checkbox" checked={isOfficial} onChange={(e) => setIsOfficial(e.target.checked)} />
                Official League day (counts toward ELO &amp; Season Standings on recompute — leave unchecked for a test)
              </label>

              <label>Players</label>
              <div className="row" style={{ position: "relative", alignItems: "center" }}>
                <div className="field" style={{ position: "relative" }}>
                  <input
                    type="text"
                    value={newPlayerName}
                    onChange={(e) => {
                      setNewPlayerName(e.target.value);
                      setNameDropdownOpen(true);
                    }}
                    onFocus={() => setNameDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setNameDropdownOpen(false), 150)}
                    onKeyDown={(e) => e.key === "Enter" && addPlayer()}
                    placeholder="Player name — type to search, or enter a new one"
                    autoComplete="off"
                  />
                  {nameDropdownOpen && (() => {
                    const options = Object.values(registry.players || {})
                      .map((p) => p.name)
                      .filter((name) => name.toLowerCase().includes(newPlayerName.toLowerCase()))
                      .sort((a, b) => a.localeCompare(b, "en"));
                    if (options.length === 0) return null;
                    return (
                      <div className="name-dropdown">
                        {options.map((name) => (
                          <div
                            key={name}
                            className="name-dropdown-option"
                            onMouseDown={() => {
                              setNewPlayerName(name);
                              setNameDropdownOpen(false);
                            }}
                          >
                            {name}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                <label className="live-toggle" style={{ margin: 0, whiteSpace: "nowrap" }} title="Include this player in the side bet, collected alongside the buy-in">
                  <input type="checkbox" checked={addToSideBet} onChange={(e) => setAddToSideBet(e.target.checked)} />
                  Side bet
                </label>
                <button className="btn-secondary" onClick={addPlayer}>
                  <Plus size={16} /> Add
                </button>
              </div>

              <div style={{ marginTop: 14 }}>
                <label>Bulk add (paste from Excel — one name per line)</label>
                <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={"John Smith\nMaria Papas\nAlex Nikolaou"} rows={4} />
                <div style={{ marginTop: 8 }}>
                  <button className="btn-secondary" onClick={addPlayersBulk} disabled={!bulkText.trim()}>
                    <Plus size={16} /> Add All
                  </button>
                </div>
              </div>

              <p style={{ fontSize: 13, color: "var(--muted)", margin: "14px 0 6px 0" }}>
                <strong style={{ color: "var(--ink)" }}>{players.length}</strong> player{players.length === 1 ? "" : "s"} registered
                {" · "}
                <strong style={{ color: "var(--ink)" }}>{sideBets.find((b) => b.id === "default-sidebet")?.participantIds.length || 0}</strong> in the side bet
              </p>
              <div className="player-list">
                {players.map((p) => {
                  const inSideBet = sideBets.find((b) => b.id === "default-sidebet")?.participantIds.includes(p.id) || false;
                  return (
                    <div className="player-chip" key={p.id}>
                      <span>{p.name}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <label className="live-toggle" style={{ margin: 0 }}>
                          <input type="checkbox" checked={inSideBet} onChange={() => toggleDefaultSideBetForPlayer(p.id)} />
                          Side bet
                        </label>
                        <button className="btn-ghost" onClick={() => removePlayer(p.id)}>
                          <X size={15} />
                        </button>
                      </span>
                    </div>
                  );
                })}
                {players.length === 0 && <p style={{ color: "var(--muted)", fontSize: 14, margin: "8px 0 0 0" }}>No players added yet.</p>}
              </div>

              <div className="footer-actions">
                <button className="btn-primary" disabled={players.length < 3} onClick={startTournament}>
                  Start Tournament <ArrowRight size={16} />
                </button>
                {players.length > 0 && players.length < 3 && (
                  <span style={{ fontSize: 13, color: "var(--muted)", alignSelf: "center" }}>At least 3 players are needed.</span>
                )}
              </div>
            </div>
          </div>
        </>
      )}
      {/* #endregion Οθόνη: Νέο τουρνουά (phase "setup") */}

      {/* #region Οθόνη: Τουρνουά σε εξέλιξη (phase "tournament") */}
      {/* TOURNAMENT */}
      {phase === "tournament" && (
        <>
          <div className="header">
            <p className="eyebrow">Swiss System</p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <h1>{tournamentName || "Backgammon Tournament"}</h1>
              <span className="round-tag">Round {round} of {totalRounds}</span>
            </div>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content" style={{ maxWidth: 1600 }}>
            {notice && (
              <div className="notice">
                <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{notice}</span>
              </div>
            )}

            {renderBackToPlayer()}

            <div className="tabs">
              <button className={`tab ${view === "pairings" ? "active" : ""}`} onClick={() => setView("pairings")}>Pairings</button>
              <button className={`tab ${view === "standings" ? "active" : ""}`} onClick={() => setView("standings")}>Standings</button>
              <button className={`tab ${view === "details" ? "active" : ""}`} onClick={() => setView("details")}>Στοιχεία</button>
              {isAdmin && (
                <>
                  <button className={`tab ${view === "finance" ? "active" : ""}`} onClick={() => setView("finance")}>Prizes</button>
                  <button className={`tab ${view === "calcutta" ? "active" : ""}`} onClick={() => setView("calcutta")}>Calcutta</button>
                </>
              )}
            </div>

            {view === "details" && renderTournamentDetailsTab()}

            {view === "pairings" && (
              <>
                <label className="live-toggle">
                  <input
                    type="checkbox"
                    checked={liveStandingsEnabled}
                    onChange={(e) => setLiveStandingsEnabled(e.target.checked)}
                  />
                  Update ELO &amp; season standings live, after every round (not just at the end)
                </label>

                <div className="round-pills">
                  {availableRounds.map((r) => (
                    <button
                      key={r}
                      className={`round-pill ${selectedRound === r ? "active" : ""}`}
                      onClick={() => { setSelectedRound(r); setConfirmingRedraw(false); }}
                    >
                      Round {r}
                    </button>
                  ))}
                </div>

                <div className="layout-toggle" role="group" aria-label="Εμφάνιση αγώνων">
                  <button className={pairingsLayout === "cards" ? "active" : ""} onClick={() => choosePairingsLayout("cards")}>
                    <LayoutGrid size={14} /> Κάρτες
                  </button>
                  <button className={pairingsLayout === "list" ? "active" : ""} onClick={() => choosePairingsLayout("list")}>
                    <List size={14} /> Λίστα
                  </button>
                </div>

                {pairingsLayout === "list" ? (
                  renderPairingsList(true)
                ) : (
                <div className="pairings-grid">
                {roundData && roundData.bye && (
                  <div className="match-compact decided">
                    <div className="match-compact-num">BYE</div>
                    <div className="match-row-name winner">
                      <span>{byId[roundData.bye]?.name}</span>
                      <Check size={14} />
                    </div>
                    <div className="match-row-name" style={{ color: "var(--muted)", fontStyle: "italic" }}>
                      <span>— κανένας αντίπαλος —</span>
                    </div>
                    <div className="match-row-tag">Αυτόματο ρεπό</div>
                  </div>
                )}
                {roundData && roundData.pairs.map((pr, i) => {
                  const p1 = byId[pr.p1];
                  const p2 = byId[pr.p2];
                  if (!p1 || !p2) return null;
                  const result = pr.result;
                  const canEdit = isAdmin;
                  const doSetResult = (winnerId, loserId, method) =>
                    roundData.editable ? setResult(i, winnerId, loserId, method) : setHistoricalResult(selectedRound, i, winnerId, loserId, method);
                  const doClearResult = () => (roundData.editable ? clearResult(i) : clearHistoricalResult(selectedRound, i));
                  const isExpanded = expandedMatch === i;
                  const isDoubleRet = result && result.method === "double_retirement";
                  const p1Score = !result || isDoubleRet ? 0 : result.winnerId === p1.id ? matchLength : 0;
                  const p2Score = !result || isDoubleRet ? 0 : result.winnerId === p2.id ? matchLength : 0;
                  const r1 = eloData.players?.[normalizeName(p1.name)]?.rating ?? ELO_INITIAL;
                  const r2 = eloData.players?.[normalizeName(p2.name)]?.rating ?? ELO_INITIAL;
                  const p1Prob = Math.round(eloWinProbability(r1, r2, matchLength || 7) * 100);
                  const p2Prob = 100 - p1Prob;
                  return (
                    <div
                      className={`match-compact ${result ? "decided" : ""} ${canEdit ? "clickable" : ""}`}
                      key={i}
                      onClick={canEdit ? () => setExpandedMatch(isExpanded ? null : i) : undefined}
                    >
                      <div className="match-compact-num" style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>M{i + 1}-{selectedRound}</span>
                        {!result && <span>Πρόβλεψη ELO {p1Prob}%-{p2Prob}%</span>}
                      </div>
                      <div className={`match-row-name ${result ? (isDoubleRet ? "loser" : result.winnerId === p1.id ? "winner" : "loser") : ""}`}>
                        <span>{p1.name}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span className="match-row-score">{p1Score}</span>
                          {result && !isDoubleRet && result.winnerId === p1.id && <Check size={14} />}
                        </span>
                      </div>
                      <div className={`match-row-name ${result ? (isDoubleRet ? "loser" : result.winnerId === p2.id ? "winner" : "loser") : ""}`}>
                        <span>{p2.name}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span className="match-row-score">{p2Score}</span>
                          {result && !isDoubleRet && result.winnerId === p2.id && <Check size={14} />}
                        </span>
                      </div>
                      {isDoubleRet && <div className="match-row-tag">Και οι δύο Α.Α. — χωρίς νικητή</div>}
                      {result && !isDoubleRet && result.method === "retirement" && (
                        <div className="match-row-tag">{byId[result.loserId]?.name} αποχώρησε (Α.Α.)</div>
                      )}
                      {!result && !canEdit && <div className="match-row-tag">Εκκρεμεί</div>}

                      {canEdit && isExpanded && (
                        <div className="match-expand" onClick={(e) => e.stopPropagation()}>
                          {!result && (
                            <>
                              <div className="match-actions">
                                <button className="btn-secondary" onClick={() => doSetResult(p1.id, p2.id, "normal")}>Win {p1.name}</button>
                                <button className="btn-secondary" onClick={() => doSetResult(p2.id, p1.id, "normal")}>Win {p2.name}</button>
                              </div>
                              <div className="retire-row">
                                <button className="btn-ghost" onClick={() => doSetResult(p2.id, p1.id, "retirement")}><UserX size={13} /> {p1.name} retired</button>
                                <button className="btn-ghost" onClick={() => doSetResult(p1.id, p2.id, "retirement")}><UserX size={13} /> {p2.name} retired</button>
                              </div>
                              <div className="retire-row">
                                <button className="btn-ghost" style={{ color: "var(--muted)" }} onClick={() => doSetResult(null, null, "double_retirement")}><UserX size={13} /> Both retired (no winner)</button>
                              </div>
                            </>
                          )}
                          {result && <button className="btn-ghost" onClick={doClearResult}>Undo</button>}
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
                )}


                {isAdmin && roundData && roundData.editable && (
                  <div className="footer-actions">
                    <button
                      className="btn-primary"
                      disabled={!roundComplete}
                      onClick={() => (round >= totalRounds ? setConfirmingFinish(true) : finalizeRoundAndAdvance(true))}
                    >
                      {round >= totalRounds ? "Finish Tournament" : "Draw Next Round"} <ArrowRight size={16} />
                    </button>
                    {!confirmingRedraw ? (
                      <button className="btn-ghost" onClick={() => setConfirmingRedraw(true)}>
                        <RotateCcw size={14} /> Redraw this round
                      </button>
                    ) : (
                      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
                        {round === 1 ? "Delete round 1 and go back to the player list?" : "Discard this round and reopen round " + (round - 1) + "?"}
                        <button className="btn-secondary" onClick={() => setConfirmingRedraw(false)}>Cancel</button>
                        <button
                          className="btn-primary"
                          onClick={() => {
                            redrawCurrentRound();
                            setConfirmingRedraw(false);
                          }}
                        >
                          Yes, redraw
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </>
            )}

            {view === "standings" && <StandingsTable standings={standings} buchholz={null} totalRounds={totalRounds} sideBets={sideBets} isAdmin={isAdmin} onToggleExclusion={toggleExclusion} onOpenPlayer={(k) => registry.players[k] && openPlayerDetail(k)} />}
            {view === "finance" && isAdmin && (
              <FinanceTab
              players={players} totalRounds={totalRounds} isAdmin={isAdmin}
              onToggleDiscount={toggleDiscount} onChangeDiscountAmount={updatePlayerDiscountAmount} onToggleCup={toggleWantsCup}
              sideBets={sideBets} onAddSideBet={addSideBet} onRemoveSideBet={removeSideBet}
              onToggleSideBetParticipant={toggleSideBetParticipant} onChangeSideBetAmount={updateSideBetAmount}
            />
            )}
            {view === "calcutta" && isAdmin && (
              <CalcuttaTab players={players} totalRounds={totalRounds} entries={calcuttaEntries} onAdd={addCalcuttaEntry} onRemove={removeCalcuttaEntry} />
            )}
          </div>
        </>
      )}
      {/* #endregion Οθόνη: Τουρνουά σε εξέλιξη (phase "tournament") */}

      {/* #region Οθόνη: Ολοκληρωμένο τουρνουά (phase "finished") */}
      {/* FINISHED */}
      {phase === "finished" && (
        <>
          <div className="header">
            <p className="eyebrow">Swiss System</p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <h1>{tournamentName || "Backgammon Tournament"}</h1>
              <span className="round-tag">Completed</span>
            </div>
            <div className="points-strip">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className={`point ${i % 2 === 0 ? "down" : "up"} ${i % 4 < 2 ? "a" : "b"}`} />
              ))}
            </div>
          </div>
          <div className="content" style={{ maxWidth: 1600 }}>
            {notice && (
              <div className="notice">
                <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{notice}</span>
              </div>
            )}
            <div className="winner-banner">
              <Trophy size={34} className="trophy" />
              <p className="sub">Tournament Winner</p>
              <p className="name">{standings[0]?.name}</p>
              {standings.length > 1 && buchholz && standings[0].wins === standings[1].wins && (
                <p className="sub">Decided by Buchholz (tie on wins)</p>
              )}
            </div>

            {isAdmin && (
              <div className="footer-actions" style={{ marginTop: 0, marginBottom: 20 }}>
                <button className="btn-secondary" disabled={recapLoading} onClick={generateRecap}>
                  <Info size={15} /> {recapLoading ? "Δημιουργία…" : "Δημιούργησε σύνοψη ανακοίνωσης"}
                </button>
                <button
                  className="btn-secondary"
                  onClick={async () => {
                    const link = `https://bgfed-tournament.vercel.app/#tournament=${tournamentId}`;
                    try {
                      await navigator.clipboard.writeText(link);
                      showToast("Το link αντιγράφηκε!");
                    } catch {
                      showToast("Δεν ήταν δυνατή η αντιγραφή — επίλεξε και κάνε Ctrl+C.");
                    }
                  }}
                  title="Μόνιμο link κατευθείαν σε αυτό το τουρνουά — για ΒΜΑΒ, YouTube κλπ."
                >
                  <LinkIcon size={15} /> Αντιγραφή link τουρνουά
                </button>
              </div>
            )}

            {renderBackToPlayer()}

            <div className="tabs">
              <button className={`tab ${view === "pairings" ? "active" : ""}`} onClick={() => setView("pairings")}>Pairings</button>
              <button className={`tab ${view === "standings" ? "active" : ""}`} onClick={() => setView("standings")}>Standings</button>
              <button className={`tab ${view === "details" ? "active" : ""}`} onClick={() => setView("details")}>Στοιχεία</button>
              {isAdmin && (
                <>
                  <button className={`tab ${view === "finance" ? "active" : ""}`} onClick={() => setView("finance")}>Prizes</button>
                  <button className={`tab ${view === "calcutta" ? "active" : ""}`} onClick={() => setView("calcutta")}>Calcutta</button>
                </>
              )}
            </div>

            {view === "details" && renderTournamentDetailsTab()}

            {view === "pairings" && (
              <>
                <div className="round-pills">
                  {availableRounds.map((r) => (
                    <button
                      key={r}
                      className={`round-pill ${selectedRound === r ? "active" : ""}`}
                      onClick={() => setSelectedRound(r)}
                    >
                      Round {r}
                    </button>
                  ))}
                </div>

                <div className="layout-toggle" role="group" aria-label="Εμφάνιση αγώνων">
                  <button className={pairingsLayout === "cards" ? "active" : ""} onClick={() => choosePairingsLayout("cards")}>
                    <LayoutGrid size={14} /> Κάρτες
                  </button>
                  <button className={pairingsLayout === "list" ? "active" : ""} onClick={() => choosePairingsLayout("list")}>
                    <List size={14} /> Λίστα
                  </button>
                </div>

                {pairingsLayout === "list" ? (
                  renderPairingsList(false)
                ) : (
                <div className="pairings-grid">
                {roundData && roundData.bye && (
                  <div className="match-compact decided">
                    <div className="match-compact-num">BYE</div>
                    <div className="match-row-name winner">
                      <span>{byId[roundData.bye]?.name}</span>
                      <Check size={14} />
                    </div>
                    <div className="match-row-name" style={{ color: "var(--muted)", fontStyle: "italic" }}>
                      <span>— κανένας αντίπαλος —</span>
                    </div>
                    <div className="match-row-tag">Αυτόματο ρεπό</div>
                  </div>
                )}
                {roundData && roundData.pairs.map((pr, i) => {
                  const p1 = byId[pr.p1];
                  const p2 = byId[pr.p2];
                  if (!p1 || !p2) return null;
                  const result = pr.result;
                  const canEdit = isAdmin;
                  const doSetResult = (winnerId, loserId, method) => setHistoricalResult(selectedRound, i, winnerId, loserId, method);
                  const doClearResult = () => clearHistoricalResult(selectedRound, i);
                  const isExpanded = expandedMatch === i;
                  const isDoubleRet = result && result.method === "double_retirement";
                  const p1Score = !result || isDoubleRet ? 0 : result.winnerId === p1.id ? matchLength : 0;
                  const p2Score = !result || isDoubleRet ? 0 : result.winnerId === p2.id ? matchLength : 0;
                  return (
                    <div
                      className={`match-compact ${result ? "decided" : ""} ${canEdit ? "clickable" : ""}`}
                      key={i}
                      onClick={canEdit ? () => setExpandedMatch(isExpanded ? null : i) : undefined}
                    >
                      <div className="match-compact-num">M{i + 1}-{selectedRound}</div>
                      <div className={`match-row-name ${result ? (isDoubleRet ? "loser" : result.winnerId === p1.id ? "winner" : "loser") : ""}`}>
                        <span>{p1.name}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span className="match-row-score">{p1Score}</span>
                          {result && !isDoubleRet && result.winnerId === p1.id && <Check size={14} />}
                        </span>
                      </div>
                      <div className={`match-row-name ${result ? (isDoubleRet ? "loser" : result.winnerId === p2.id ? "winner" : "loser") : ""}`}>
                        <span>{p2.name}</span>
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span className="match-row-score">{p2Score}</span>
                          {result && !isDoubleRet && result.winnerId === p2.id && <Check size={14} />}
                        </span>
                      </div>
                      {isDoubleRet && <div className="match-row-tag">Και οι δύο Α.Α. — χωρίς νικητή</div>}
                      {result && !isDoubleRet && result.method === "retirement" && (
                        <div className="match-row-tag">{byId[result.loserId]?.name} αποχώρησε (Α.Α.)</div>
                      )}

                      {canEdit && isExpanded && (
                        <div className="match-expand" onClick={(e) => e.stopPropagation()}>
                          {!result && (
                            <>
                              <div className="match-actions">
                                <button className="btn-secondary" onClick={() => doSetResult(p1.id, p2.id, "normal")}>Win {p1.name}</button>
                                <button className="btn-secondary" onClick={() => doSetResult(p2.id, p1.id, "normal")}>Win {p2.name}</button>
                              </div>
                              <div className="retire-row">
                                <button className="btn-ghost" onClick={() => doSetResult(p2.id, p1.id, "retirement")}><UserX size={13} /> {p1.name} retired</button>
                                <button className="btn-ghost" onClick={() => doSetResult(p1.id, p2.id, "retirement")}><UserX size={13} /> {p2.name} retired</button>
                              </div>
                              <div className="retire-row">
                                <button className="btn-ghost" style={{ color: "var(--muted)" }} onClick={() => doSetResult(null, null, "double_retirement")}><UserX size={13} /> Both retired (no winner)</button>
                              </div>
                            </>
                          )}
                          {result && <button className="btn-ghost" onClick={doClearResult}>Undo</button>}
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
                )}
              </>
            )}

            {view === "standings" && <StandingsTable standings={standings} buchholz={buchholz} totalRounds={totalRounds} sideBets={sideBets} isAdmin={isAdmin} onToggleExclusion={toggleExclusion} onOpenPlayer={(k) => registry.players[k] && openPlayerDetail(k)} />}
            {view === "finance" && isAdmin && (
              <FinanceTab
              players={players} totalRounds={totalRounds} isAdmin={isAdmin}
              onToggleDiscount={toggleDiscount} onChangeDiscountAmount={updatePlayerDiscountAmount} onToggleCup={toggleWantsCup}
              sideBets={sideBets} onAddSideBet={addSideBet} onRemoveSideBet={removeSideBet}
              onToggleSideBetParticipant={toggleSideBetParticipant} onChangeSideBetAmount={updateSideBetAmount}
            />
            )}
            {view === "calcutta" && isAdmin && (
              <CalcuttaTab players={players} totalRounds={totalRounds} entries={calcuttaEntries} onAdd={addCalcuttaEntry} onRemove={removeCalcuttaEntry} />
            )}

            {isAdmin && (
              <div className="footer-actions">
                <button className="btn-secondary" onClick={goHome}><RotateCcw size={15} /> Home</button>
              </div>
            )}
          </div>
        </>
      )}
      {/* #endregion Οθόνη: Ολοκληρωμένο τουρνουά (phase "finished") */}

      {/* #region Φόρτωση αρχείου τουρνουά (admin, τουρνουά) */}
      {isAdmin && (phase === "tournament" || phase === "finished") && (
        <div className="content" style={{ paddingTop: 0, marginTop: -20 }}>
          <button className="btn-ghost" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} /> Load tournament file (.json)
          </button>
          <input type="file" accept="application/json" ref={fileInputRef} onChange={importJSON} style={{ display: "none" }} />
        </div>
      )}
      {/* #endregion Φόρτωση αρχείου τουρνουά (admin, τουρνουά) */}
    </div>
  );
}
