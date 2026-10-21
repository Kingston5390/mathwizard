// ===== Richards Unblocked Games: settings =====
// The only file you normally need to edit.
window.RUG_CONFIG = {
  // Your GitHub username (the account that owns the rug-games-N repos)
  githubUser: "Kingston5390",

  // Branch the games live on. jsDelivr caches branches for up to 12h;
  // use a tag like "v1" here if you want instant, permanent URLs.
  branch: "main",

  // Where the panic button sends you
  panicUrl: "https://classroom.google.com/",

  // Keys that trigger panic (KeyboardEvent.key values)
  panicKeys: ["`", "]"],

  // For local testing only: load games from a folder on a local server
  // instead of jsDelivr, e.g. "/repos". Leave null when published.
  localBase: null,
};
