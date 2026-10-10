// Bumped by hand on every code change sent in chat — compare this to what
// Claude states in its reply to confirm a "Publish" actually picked up the
// latest version, independent of claude.ai's own artifact-version UI.
export const APP_BUILD_VERSION = "2026-10-10.03";

// Shown to everyone (admins and visitors) as a "What's New" popup the first
// time their browser sees a given build. Newest entry first. Keep entries
// short and feature-level — this is for testers, not a technical log.
// Standing overview of the app's main capabilities — always shown at the top
// of the "What's New" popup, above the build-by-build history, so a first-
// time visitor understands the whole tool at a glance. Update this whenever
// a major capability is added; keep it feature-level, not a build log.
export const FEATURES_SUMMARY = [
  "Διοργάνωση τουρνουά Swiss-system, με αυτόματο ζευγάρωμα και πρόβλεψη νικητή βάσει ELO.",
  "Ενιαίο μητρώο παικτών με Αριθμό Μητρώου και πλήρες ιστορικό συμμετοχών.",
  "Κατάταξη ELO της Ομοσπονδίας και Πανελλήνια Κατάταξη ELO, με γράφημα εξέλιξης και «Πώς προέκυψε η ELO» για κάθε παίκτη.",
  "Βαθμολογία σεζόν με κανόνες ανά σεζόν (καλύτερα αποτελέσματα, προκρίσεις) και ημερολόγιο αγωνιστικών.",
  "Διοργανώσεις και σύλλογοι, και τουρνουά που έγιναν εκτός εφαρμογής (Τελικές Φάσεις Κυπέλλου και Πρωταθλήματος) σε προβολή Λίστα, Δέντρο και Excel.",
  "Στατιστικά: παίκτης έναντι κάθε αντιπάλου, σερί, κατακτήσεις, πρωτοπορία, στατιστικά σεζόν, με φίλτρα περιόδου και διοργάνωσης.",
  "Ανακοινώσεις αποτελεσμάτων στο bgfed.gr μέσω RSS.",
  "Ελληνικά (προεπιλογή), με εναλλαγή σε Αγγλικά.",
  "Ρόλοι Διαχειριστή και Επισκέπτη.",
];

// Plain-language description of how the app is built, for the "Τεχνικά
// στοιχεία" tab — written for a board member, not a developer.
export const TECHNICAL_SUMMARY = [
  {
    title: "Πώς είναι φτιαγμένη η εφαρμογή",
    body: "Η εφαρμογή είναι γραμμένη σε React (JavaScript) — μια πολύ διαδεδομένη τεχνολογία για διαδικτυακές εφαρμογές. Το \"χτίσιμο\" της γίνεται με το εργαλείο Vite, που μετατρέπει τον κώδικα σε ένα γρήγορο, ελαφρύ πακέτο για τον browser.",
  },
  {
    title: "Πού αποθηκεύονται τα δεδομένα",
    body: "Όλα τα δεδομένα (παίκτες, τουρνουά, ELO, Season Standings) αποθηκεύονται στο Firebase / Firestore, μια υπηρεσία της Google. Οι αλλαγές αποθηκεύονται αμέσως, live, και είναι κοινές για όλους — δεν εξαρτώνται από τη συσκευή που χρησιμοποιεί κανείς.",
  },
  {
    title: "Πού \"ζει\" online",
    body: "Η εφαρμογή φιλοξενείται (hosting) στο Vercel, το οποίο την κάνει διαθέσιμη στο μόνιμο link https://bgfed-tournament.vercel.app, ενημερώνοντάς την αυτόματα κάθε φορά που ανεβαίνει νέος κώδικας.",
  },
  {
    title: "Πού είναι ο κώδικας",
    body: "Ο πηγαίος κώδικας φυλάσσεται στο GitHub (github.com/dakapes-maker/bgfed-tournament). Κάθε νέα έκδοση ανεβαίνει εκεί, και το Vercel την παραλαμβάνει αυτόματα και την δημοσιεύει.",
  },
];
