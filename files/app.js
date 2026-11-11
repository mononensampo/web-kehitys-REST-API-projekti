/* ============================================================
   Crate – artist & album browser powered by the Last.fm API
   1. Create a free API key: https://www.last.fm/api/account/create
   2. Paste it below.
   ============================================================ */
const API_KEY = "dd47ce879f3214b76aa08ba7f58e10bc";

const API_URL = "https://ws.audioscrobbler.com/2.0/";

// Artists shown in the list on start-up. Edit freely.
const DEFAULT_ARTISTS = [
  "Radiohead", "Daft Punk", "Björk", "Kendrick Lamar", "Taylor Swift",
  "Nightwish", "Queen", "Massive Attack", "Billie Eilish",
  "Arctic Monkeys", "Miles Davis", "Rammstein",
];

// Last.fm returns this grey star image when an item has no real picture.
const PLACEHOLDER_HASH = "2a96cbd8b46e442fc41c2b86b821562f";

const $ = (selector) => document.querySelector(selector);
const main = $("#main");
const dialog = $("#album-dialog");
const dialogBody = $("#album-body");

const state = { artists: [...DEFAULT_ARTISTS], current: null };
const cache = new Map();
let artistRequest = 0;
let albumRequest = 0;

/* ---------- Helpers ---------- */
const esc = (value = "") =>
  String(value).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

// Last.fm gives a single object instead of an array when there is one item.
const toArray = (x) => (Array.isArray(x) ? x : x ? [x] : []);

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const formatCount = (n) => compact.format(Number(n) || 0);

function formatDuration(seconds) {
  const s = Number(seconds);
  if (!s) return "";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Last.fm texts contain HTML links; keep plain text only.
function cleanText(html = "") {
  const text = new DOMParser().parseFromString(html, "text/html").body.textContent || "";
  return text.replace(/\s*Read more on Last\.fm.*$/s, "").trim();
}

function imageOf(images) {
  const list = toArray(images).filter((img) => img["#text"] && !img["#text"].includes(PLACEHOLDER_HASH));
  const best = list.find((img) => img.size === "extralarge") || list[list.length - 1];
  return best ? best["#text"] : "";
}

const hue = (name) => [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;
const initials = (name) => name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

async function lastfm(method, params = {}) {
  const url = new URL(API_URL);
  url.search = new URLSearchParams({ method, api_key: API_KEY, format: "json", ...params });
  const key = url.toString();
  if (cache.has(key)) return cache.get(key);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Last.fm answered with status ${response.status}.`);
  const data = await response.json();
  if (data.error) throw new Error(data.message || `Last.fm error ${data.error}.`);

  cache.set(key, data);
  return data;
}

/* ---------- Artist photos (TheAudioDB) ----------
   Last.fm stopped serving real artist photos, so we ask TheAudioDB instead.
   "123" is TheAudioDB's shared free test key (rate-limited). */
const AUDIODB_KEY = "123";
const photoCache = new Map();

async function artistPhoto(name) {
  if (photoCache.has(name)) return photoCache.get(name);
  let result = null;
  try {
    const url = `https://www.theaudiodb.com/api/v1/json/${AUDIODB_KEY}/search.php?s=${encodeURIComponent(name)}`;
    const response = await fetch(url);
    if (response.ok) {
      const artist = (await response.json()).artists?.[0];
      if (artist?.strArtistThumb) {
        result = { thumb: artist.strArtistThumb, fanart: artist.strArtistFanart || "" };
      }
    }
  } catch {
    // No photo is fine: the hero falls back to the album-cover backdrop.
  }
  photoCache.set(name, result);
  return result;
}

/* ---------- Artist list ---------- */
function renderList() {
  $("#artist-list").innerHTML = state.artists.map((name) => `
    <li>
      <button class="artist-btn" data-artist="${esc(name)}" aria-current="${name === state.current}">
        <span class="avatar" style="--hue:${hue(name)}">${esc(initials(name))}</span>
        <span>${esc(name)}</span>
      </button>
    </li>`).join("");
}

function ensureInList(name) {
  if (!state.artists.some((n) => n.toLowerCase() === name.toLowerCase())) {
    state.artists.unshift(name);
  }
}

/* ---------- Artist page ---------- */
async function selectArtist(requestedName) {
  const id = ++artistRequest;
  state.current = requestedName;
  ensureInList(requestedName);
  renderList();
  main.innerHTML = `<p class="loading">Loading ${esc(requestedName)}…</p>`;

  try {
    const params = { artist: requestedName, autocorrect: 1 };
    const [info, albums, tracks] = await Promise.all([
      lastfm("artist.getinfo", params),
      lastfm("artist.gettopalbums", { ...params, limit: 24 }),
      lastfm("artist.gettoptracks", { ...params, limit: 8 }),
    ]);
    if (id !== artistRequest) return; // a newer click won

    // Use Last.fm's spelling of the name (e.g. "radiohed" -> "Radiohead").
    const canonical = info.artist.name;
    if (canonical !== requestedName) {
      state.artists = [...new Set(state.artists.map((n) => (n === requestedName ? canonical : n)))];
      state.current = canonical;
    }
    renderList();
    renderArtist(info.artist, albums, tracks);
    window.scrollTo({ top: 0 });
  } catch (error) {
    if (id !== artistRequest) return;
    if (!DEFAULT_ARTISTS.includes(requestedName)) {
      state.artists = state.artists.filter((n) => n !== requestedName);
      state.current = null;
      renderList();
    }
    renderError(error.message);
  }
}

function renderArtist(artist, albumsData, tracksData) {
  // Skip Last.fm's "(null)" entries and duplicate album names.
  const seen = new Set();
  const albums = toArray(albumsData.topalbums?.album).filter((a) => {
    const key = (a.name || "").toLowerCase();
    if (!a.name || a.name === "(null)" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const topTracks = toArray(tracksData.toptracks?.track).slice(0, 8);
  const maxPlays = Math.max(1, ...topTracks.map((t) => Number(t.playcount) || 0));
  const tags = toArray(artist.tags?.tag).slice(0, 5);
  const similar = toArray(artist.similar?.artist).slice(0, 6);
  const bio = cleanText(artist.bio?.summary);
  const heroCover = albums.map((a) => imageOf(a.image)).find(Boolean) || "";

  main.innerHTML = `
    <section class="hero" ${heroCover ? `style="--cover:url('${esc(heroCover)}')"` : ""}>
      <div class="hero-photo" id="hero-photo" hidden></div>
      <div>
        <h2>${esc(artist.name)}</h2>
        <p class="stats">
          <span><strong>${formatCount(artist.stats?.listeners)}</strong> listeners</span>
          <span><strong>${formatCount(artist.stats?.playcount)}</strong> plays</span>
        </p>
        ${tags.length ? `<ul class="tags">${tags.map((t) => `<li>${esc(t.name)}</li>`).join("")}</ul>` : ""}
      </div>
    </section>

    <div class="columns">
      <section class="section">
        <h3>About</h3>
        <p class="bio">${bio ? esc(bio) : "Last.fm has no biography for this artist yet."}</p>
        <a class="bio-link" href="${esc(artist.url)}" target="_blank" rel="noopener">Read more on Last.fm</a>
      </section>

      <section class="section">
        <h3>Top tracks</h3>
        ${topTracks.length ? `
          <ol class="top-tracks">
            ${topTracks.map((t, i) => `
              <li>
                <span class="rank">${i + 1}</span>
                <a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a>
                <span class="plays">${formatCount(t.playcount)} plays</span>
                <span class="bar" style="--w:${Math.round(((Number(t.playcount) || 0) / maxPlays) * 100)}%"></span>
              </li>`).join("")}
          </ol>` : "<p>No top tracks found.</p>"}
      </section>
    </div>

    ${similar.length ? `
      <section class="section">
        <h3>Similar artists</h3>
        <ul class="chips">
          ${similar.map((s) => `<li><button class="chip" data-artist="${esc(s.name)}">${esc(s.name)}</button></li>`).join("")}
        </ul>
      </section>` : ""}

    <section class="section">
      <h3>Albums</h3>
      ${albums.length ? `
        <ul class="album-grid">
          ${albums.map((a) => {
            const cover = imageOf(a.image);
            return `
              <li>
                <button class="album" data-artist="${esc(artist.name)}" data-album="${esc(a.name)}">
                  <span class="sleeve">
                    <span class="disc"></span>
                    <span class="cover">${cover
                      ? `<img src="${esc(cover)}" alt="" loading="lazy">`
                      : `<span class="no-cover">♪</span>`}</span>
                  </span>
                  <span class="album-name">${esc(a.name)}</span>
                  <span class="album-meta">${formatCount(a.playcount)} plays</span>
                </button>
              </li>`;
          }).join("")}
        </ul>` : "<p>No albums found for this artist.</p>"}
    </section>`;

  // Load the photo in the background so the page appears immediately.
  artistPhoto(artist.name).then((photo) => {
    const slot = $("#hero-photo");
    if (!photo || !slot || state.current !== artist.name) return;
    slot.innerHTML = `<img src="${esc(photo.thumb)}" alt="Photo of ${esc(artist.name)}">`;
    slot.hidden = false;
    if (photo.fanart) $(".hero").style.setProperty("--cover", `url("${photo.fanart}")`);
  });
}

/* ---------- Album dialog ---------- */
async function openAlbum(artistName, albumName) {
  const id = ++albumRequest;
  dialogBody.innerHTML = `<p class="dialog-empty loading">Loading ${esc(albumName)}…</p>`;
  if (!dialog.open) dialog.showModal();

  try {
    const data = await lastfm("album.getinfo", { artist: artistName, album: albumName, autocorrect: 1 });
    if (id !== albumRequest) return;
    renderAlbum(data.album);
  } catch (error) {
    if (id !== albumRequest) return;
    dialogBody.innerHTML = `
      <div class="dialog-wrap">
        <button class="dialog-close" data-close>Close</button>
        <div class="dialog-empty">
          <h2>Couldn't load this album</h2>
          <p>${esc(error.message)}</p>
        </div>
      </div>`;
  }
}

function renderAlbum(album) {
  const cover = imageOf(album.image);
  const tags = toArray(album.tags?.tag).slice(0, 4);
  const tracks = toArray(album.tracks?.track);
  const wiki = cleanText(album.wiki?.summary);
  const totalSeconds = tracks.reduce((sum, t) => sum + (Number(t.duration) || 0), 0);

  dialogBody.innerHTML = `
    <div class="dialog-wrap">
      <button class="dialog-close" data-close>Close</button>
      <div class="dialog-grid">
        <div class="dialog-art">
          <span class="sleeve">
            <span class="disc"></span>
            <span class="cover">${cover
              ? `<img src="${esc(cover)}" alt="Cover of ${esc(album.name)}">`
              : `<span class="no-cover">♪</span>`}</span>
          </span>
        </div>

        <div class="dialog-info">
          <h2 id="album-title">${esc(album.name)}</h2>
          <p class="by">by ${esc(album.artist)}</p>
          <p class="stats">
            <span><strong>${formatCount(album.listeners)}</strong> listeners</span>
            <span><strong>${formatCount(album.playcount)}</strong> plays</span>
            ${tracks.length ? `<span><strong>${tracks.length}</strong> tracks${totalSeconds ? `, ${Math.round(totalSeconds / 60)} min` : ""}</span>` : ""}
          </p>
          ${tags.length ? `<ul class="tags">${tags.map((t) => `<li>${esc(t.name)}</li>`).join("")}</ul>` : ""}
          ${wiki ? `<p class="wiki">${esc(wiki)}</p>` : ""}

          ${tracks.length ? `
            <ol class="tracklist">
              ${tracks.map((t) => `
                <li>
                  <a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a>
                  <span class="time">${formatDuration(t.duration)}</span>
                </li>`).join("")}
            </ol>` : `<p>Last.fm has no track list for this album.</p>`}
        </div>
      </div>
    </div>`;
}

/* ---------- Messages ---------- */
function renderError(message) {
  main.innerHTML = `
    <div class="notice">
      <h2>Something went wrong</h2>
      <p>${esc(message)}</p>
      <p>Check your connection and API key, then pick an artist again.</p>
    </div>`;
}

function renderWelcome() {
  main.innerHTML = `
    <div class="notice">
      <h2>Choose an artist</h2>
      <p>Select a name from the list to see their albums, top tracks and more. Click an album to open its track list.</p>
    </div>`;
}

function renderMissingKey() {
  main.innerHTML = `
    <div class="notice">
      <h2>Add your Last.fm API key</h2>
      <p>Create a free key at <a href="https://www.last.fm/api/account/create" target="_blank" rel="noopener">last.fm/api/account/create</a>, then paste it into the <code>API_KEY</code> line at the top of <code>app.js</code> and reload this page.</p>
    </div>`;
}

/* ---------- Events ---------- */
$("#artist-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-artist]");
  if (button) selectArtist(button.dataset.artist);
});

main.addEventListener("click", (event) => {
  const album = event.target.closest(".album");
  if (album) return openAlbum(album.dataset.artist, album.dataset.album);
  const chip = event.target.closest(".chip");
  if (chip) selectArtist(chip.dataset.artist);
});

$("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#search-input");
  const query = input.value.trim();
  if (!query) return;
  input.value = "";
  selectArtist(query);
});

dialog.addEventListener("click", (event) => {
  // Clicking the dark backdrop (the dialog element itself) or a close button closes it.
  if (event.target === dialog || event.target.closest("[data-close]")) dialog.close();
});

/* ---------- Start ---------- */
renderList();
if (API_KEY === "YOUR_LASTFM_API_KEY") {
  renderMissingKey();
} else {
  renderWelcome();
  selectArtist(state.artists[0]);
}
