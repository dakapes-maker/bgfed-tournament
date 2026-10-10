// Central permission check (5A). Every database write asks can(); the UI
// keeps using isAdmin. Today one role exists — every administrator may do
// everything — but target (tournament, competition, club, or a database
// document) is passed from now on, so club administrators or a super
// administrator can be added later without touching every button.

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
