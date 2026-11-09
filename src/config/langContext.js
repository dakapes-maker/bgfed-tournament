import { createContext, useContext } from "react";
import { TRANSLATIONS } from "./i18n.js";
import { UI } from "./i18nUi.js";

/** Το λεξικό της τρέχουσας γλώσσας για τα components (build 2026-11-09.06).
 * Το App δίνει την τιμή· `L.lang` = "el" | "en". */
export const LangContext = createContext({ ...TRANSLATIONS.el, ...UI.el, lang: "el" });
export const useL = () => useContext(LangContext);

/** «Γλώσσα του browser»: αγγλικά μόνο αν ο browser είναι στα αγγλικά. */
export function browserLang() {
  try {
    const l = String((navigator.languages && navigator.languages[0]) || navigator.language || "").toLowerCase();
    return l.startsWith("en") ? "en" : "el";
  } catch {
    return "el";
  }
}
export const dateLocale = (L) => (L.lang === "en" ? "en-GB" : "el-GR");
