// Central permission check (5A). Every database write asks can(); the UI
// keeps using isAdmin. Since 5C there are two roles: the super administrator
// (role "admin") and the club administrator (role "clubAdmin", clubIds). The
// per-club limits are enforced by the screens (context-aware isAdmin,
// canEditCompetition in App.jsx); the database rules and can() only require
// an administrator of either kind — the agreed «golden mean».

let CURRENT_USER = null; // { uid, email, isAdmin } of the signed-in user, or null

/** Called by the app whenever the signed-in user or their rights change. */
export function setPermissionUser(user) {
  CURRENT_USER = user || null;
}

export function currentPermissionUser() {
  return CURRENT_USER;
}

/** May this user perform this action on this target? */
export function can(user, action, target) {
  return !!(user && user.isAdmin);
}
