const $ = (id) => document.getElementById(id);

const state = {
  view: "home",
  authMode: "login",
  user: null,
  searchTimer: null,
  items: []
};

const placeholder =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450">' +
    '<rect width="300" height="450" fill="#191722"/>' +
    '<circle cx="150" cy="190" r="55" fill="#302643"/>' +
    '<text x="150" y="205" font-size="48" text-anchor="middle" fill="#b6a1e8">C</text>' +
    '<text x="150" y="285" font-family="Arial" font-size="16" text-anchor="middle" fill="#a6a0b7">CINEVERSE</text>' +
    '</svg>'
  );

const escapeHTML = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({
    error: "Unexpected server response."
  }));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

let toastTimer;

function toast(message) {
  const element = $("toast");
  element.textContent = message;
  element.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    element.classList.remove("show");
  }, 3000);
}

/* =========================
   VOICE SEARCH
   Uses the browser Web Speech API when supported (Chrome/Edge work best).
========================= */
function startVoiceSearch(inputId, mode) {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    toast("Voice search is not supported by this browser. Try Chrome or Edge.");
    return;
  }

  const input = $(inputId);
  if (!input) return;

  const recognition = new SpeechRecognition();
  recognition.lang = "en-IN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  const buttonId =
    mode === "hero"
      ? "hero-voice-btn"
      : mode === "global"
        ? "global-voice-btn"
        : "plot-voice-btn";

  const button = $(buttonId);
  const originalLabel = button ? button.textContent : "🎙";

  if (button) {
    button.disabled = true;
    button.textContent = "Listening…";
  }

  toast("Listening… speak now.");

  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim();

    if (!transcript) {
      toast("I couldn't catch that. Please try again.");
      return;
    }

        input.value = transcript;

    if (mode === "hero") {
      openSearch();
      const globalInput = $("global-query");
      if (globalInput) globalInput.value = transcript;
      runSearch(transcript, $("search-type").value);
    } else if (mode === "global") {
      runSearch(transcript, $("search-type").value);
    } else if (mode === "plot") {
      runPlotSearch();
    }
  };

  recognition.onerror = (event) => {
    const message = event.error === "not-allowed"
      ? "Please allow microphone access to use voice search."
      : "Voice search couldn't hear you. Please try again.";

    toast(message);
  };

  recognition.onend = () => {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  };

  try {
    recognition.start();
  } catch (_error) {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }

    toast("Voice search is already active. Try again in a moment.");
  }
}

function titleFor(item) {
  return item.title || item.name || "Untitled";
}

function posterFor(item) {
  return item.poster || item.profile || null;
}

/* =========================
   MOVIE AND PERSON CARDS
========================= */

function card(item, person = false) {
  const title = titleFor(item);
  const image = posterFor(item);
  const type = item.media_type || (person ? "person" : "movie");

  const year =
    item.year ||
    (item.release_date || "").slice(0, 4) ||
    "—";

  const rating = Number(item.rating);

  return `
    <article
      class="movie-card ${person ? "person-card" : ""}"
      data-id="${item.id}"
      data-type="${escapeHTML(type)}"
      tabindex="0"
      role="button"
      aria-label="Open ${escapeHTML(title)}"
    >
      <div class="poster-wrap">
        ${
          image
            ? `<img
                 loading="lazy"
                 src="${escapeHTML(image)}"
                 alt="${escapeHTML(title)} poster"
                 onerror="this.onerror=null;this.src='${placeholder}'"
               >`
            : `<img src="${placeholder}" alt="CineVerse placeholder">`
        }

        ${
          !person && Number.isFinite(rating) && rating > 0
            ? `<span class="poster-rating">★ ${rating.toFixed(1)}</span>`
            : ""
        }

        <span class="poster-type">
          ${escapeHTML(type === "tv" ? "TV" : type)}
        </span>

        ${
          !person && state.user
            ? `
              <button
                class="card-watch ${state.view === "watchlist" ? "saved" : ""}"
                data-watch="1"
                aria-label="${
                  state.view === "watchlist" ? "Remove" : "Add"
                } ${escapeHTML(title)} ${
                  state.view === "watchlist" ? "from" : "to"
                } watchlist"
                title="${
                  state.view === "watchlist"
                    ? "Remove from My List"
                    : "Add to My List"
                }"
              >
                ${state.view === "watchlist" ? "−" : "+"}
              </button>
            `
            : ""
        }
      </div>

      <div class="movie-title">${escapeHTML(title)}</div>

      <div class="movie-meta">
        <span>${escapeHTML(year)}</span>

        ${
          item.known_for_department
            ? `<span>· ${escapeHTML(item.known_for_department)}</span>`
            : ""
        }

        ${
          item.match_score !== undefined
            ? `<span>· ${item.match_score}% match</span>`
            : ""
        }
      </div>

      ${
        item.match_score !== undefined
          ? `<div class="match-score">ML similarity score</div>`
          : ""
      }
    </article>
  `;
}

function renderItems(target, items, options = {}) {
  const element = $(target);

  if (!items || !items.length) {
    element.innerHTML = `
      <div class="empty-state">
        No matching titles found. Try different keywords or filters.
      </div>
    `;
    return;
  }

  element.innerHTML = items
    .map((item) => card(
      item,
      options.people || item.media_type === "person"
    ))
    .join("");
}

function showError(target, error, retry) {
  $(target).innerHTML = `
    <div class="error-state">
      ${escapeHTML(error)}
      ${
        retry
          ? '<button class="text-button" id="retry-content">Retry ↻</button>'
          : ""
      }
    </div>
  `;

  if (retry && $("retry-content")) {
    $("retry-content").onclick = retry;
  }
}

/* =========================
   TRENDING AND DISCOVERY
========================= */

async function loadTrending(type = "all") {
  $("content").innerHTML = `
    <div class="loading-card">Loading live TMDB data…</div>
  `;

  try {
    const data = await api(`/api/trending?type=${type}`);

    state.items = data.results || [];
    renderItems("content", state.items);
  } catch (error) {
    showError("content", error.message, () => loadTrending(type));
  }
}

async function loadDiscover(kind, filters = {}) {
  $("content").innerHTML = `
    <div class="loading-card">Loading real catalog data…</div>
  `;

  const params = new URLSearchParams({
    type: kind,
    ...filters
  });

  try {
    const data = await api(`/api/discover?${params.toString()}`);

    state.items = data.results || [];
    renderItems("content", state.items);
  } catch (error) {
    showError(
      "content",
      error.message,
      () => loadDiscover(kind, filters)
    );
  }
}
async function loadPeople() {
  $("content").innerHTML = `
    <div class="loading-card">Loading real people data…</div>
  `;

  try {
    const data = await api("/api/trending?type=person");

    state.items = data.results || [];
    renderItems("content", state.items, { people: true });
  } catch (error) {
    showError("content", error.message, loadPeople);
  }
}

async function loadWatchlist() {
  if (!state.user) {
    $("content").innerHTML = `
      <div class="empty-state">
        Sign in to save and view your watchlist.
        <button class="text-button" id="watch-sign-in">Sign in →</button>
      </div>
    `;

    $("watch-sign-in").onclick = openAuth;
    return;
  }

  $("content").innerHTML = `
    <div class="loading-card">Loading your saved titles…</div>
  `;

  try {
    const data = await api("/api/watchlist");

    state.items = data.results || [];
    renderItems("content", state.items);
  } catch (error) {
    showError("content", error.message, loadWatchlist);
  }
}

/* =========================
   PAGE NAVIGATION
========================= */

function setView(view) {
  state.view = view;

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  $("hero").classList.toggle("hidden", view !== "home");
  $("search-panel").classList.add("hidden");

  $("smart-panel").classList.toggle("hidden", view !== "smart");

  $("filters-panel").classList.toggle(
    "hidden",
    !["movies", "shows"].includes(view)
  );

  $("preferences-panel").classList.toggle(
    "hidden",
    view !== "preferences"
  );

  $("main-content").classList.toggle(
    "hidden",
    ["smart", "preferences"].includes(view)
  );

  const titles = {
    home: "Trending this week",
    movies: "Popular movies worldwide",
    shows: "Popular TV & dramas",
    actors: "Actors & creators",
    watchlist: "Your watchlist",
    smart: "Smart plot search",
    preferences: "Your preferences"
  };

  $("page-title").textContent = titles[view] || "Discover";

  const subtitles = {
    home: "What the world is watching right now.",
    movies: "Explore real movie metadata from around the world.",
    shows: "Discover television, dramas, and anime.",
    actors: "Explore real people from film and television.",
    watchlist: "Your saved titles, linked to your account."
  };

  $("page-subtitle").textContent = subtitles[view] || "";

  if (view === "home") {
    loadTrending("all");
  } else if (view === "movies") {
    loadDiscover("movie");
  } else if (view === "shows") {
    loadDiscover("tv");
  } else if (view === "actors") {
    loadPeople();
  } else if (view === "watchlist") {
    loadWatchlist();
  } else if (view === "preferences") {
    loadPreferences();
  }

  window.scrollTo({
    top: view === "home"
      ? 0
      : $("main-content").offsetTop - 70,
    behavior: "smooth"
  });
}

/* =========================
   GLOBAL SEARCH
========================= */

async function runSearch(
  query,
  type = "multi",
  target = "search-results"
) {
  if (!query.trim()) {
    $(target).innerHTML = `
      <div class="empty-state">
        Enter a title, person, or keyword to search.
      </div>
    `;
    return;
  }

  $(target).innerHTML = `
    <div class="loading-card">
      Searching live entertainment data…
    </div>
  `;

  try {
    const data = await api(
      `/api/search?q=${encodeURIComponent(query)}&type=${type}`
    );

    renderItems(target, data.results || []);
  } catch (error) {
    showError(
      target,
      error.message,
      () => runSearch(query, type, target)
    );
  }
}

function openSearch() {
  $("search-panel").classList.remove("hidden");
  $("global-query").focus();

  $("search-panel").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

/* =========================
   TF-IDF PLOT SEARCH
========================= */

async function runPlotSearch() {
  const query = $("plot-query").value.trim();

  if (query.length < 4) {
    toast("Describe the plot in a little more detail.");
    return;
  }

  $("plot-search-btn").disabled = true;
  $("plot-search-btn").textContent = "Finding matches…";

  $("plot-results").innerHTML = `
    <div class="loading-card">
      Comparing your plot with real movie and TV descriptions…
    </div>
  `;

  try {
    const data = await api(
      `/api/plot-search?q=${encodeURIComponent(query)}`
    );

    renderItems("plot-results", data.results || []);

    $("ml-note").textContent =
      `Method: ${data.method}. ${data.note || ""}`;
  } catch (error) {
    showError("plot-results", error.message, runPlotSearch);
  } finally {
    $("plot-search-btn").disabled = false;
    $("plot-search-btn").innerHTML =
      'Find matching stories <span>↗</span>';
  }
}

/* =========================
   MOVIE DETAILS
========================= */

async function openDetail(kind, id) {
  $("detail-content").innerHTML = `
    <div class="loading-card">Loading title details…</div>
  `;

  $("detail-dialog").showModal();

  try {
    const data = await api(`/api/detail/${kind}/${id}`);

    if (kind === "person") {
      $("detail-content").innerHTML = `
        <div class="detail-close-row">
          <button class="modal-close"
            onclick="document.getElementById('detail-dialog').close()">
            ×
          </button>
        </div>

        <div class="detail-hero">
          ${
            data.profile
              ? `<img src="${escapeHTML(data.profile)}"
                      alt="${escapeHTML(data.title)}">`
              : ""
          }

          <div>
            <p class="eyebrow">ACTOR & CREATOR</p>
            <h2>${escapeHTML(data.title)}</h2>
            <p class="muted">
              ${escapeHTML(
                data.known_for_department || "Entertainment professional"
              )}
            </p>
          </div>
        </div>

        <div class="detail-body">
          <h3>Biography</h3>
          <p>${escapeHTML(
            data.biography || "No biography is available from the data provider."
          )}</p>

          <h3>Known For</h3>
          <div class="detail-recommendations">
            ${(data.filmography || []).map((item) => `
              <button class="mini-title"
                data-open-kind="${escapeHTML(item.media_type || "movie")}"
                data-open-id="${item.id}">
                ${
                  item.poster
                    ? `<img src="${escapeHTML(item.poster)}"
                            alt="${escapeHTML(titleFor(item))}">`
                    : ""
                }
                <span>${escapeHTML(titleFor(item))}</span>
              </button>
            `).join("")}
          </div>
        </div>
      `;
    } else {
      $("detail-content").innerHTML = `
        <div class="detail-close-row">
          <button class="modal-close"
            onclick="document.getElementById('detail-dialog').close()">
            ×
          </button>
        </div>

        <div class="detail-hero">
          ${
            data.backdrop
              ? `<img src="${escapeHTML(data.backdrop)}"
                      alt="${escapeHTML(data.title)}">`
              : ""
          }

          <div>
            <p class="eyebrow">
              ${escapeHTML((data.media_type || kind).toUpperCase())}
            </p>

            <h2>${escapeHTML(titleFor(data))}</h2>

            <p class="muted">
              ${escapeHTML(data.year || "—")}
              · ★ ${escapeHTML(data.rating ?? "—")}
              ${data.runtime ? ` · ${escapeHTML(data.runtime)} min` : ""}
            </p>

            ${
              data.tagline
                ? `<p class="detail-tagline">${escapeHTML(data.tagline)}</p>`
                : ""
            }
          </div>
        </div>

        <div class="detail-body">
          <h3>Overview</h3>
          <p>${escapeHTML(
            data.overview || "No overview is available."
          )}</p>

          ${
            data.genres?.length
              ? `<p class="genre-list">
                   ${data.genres.map(genre =>
                     `<span>${escapeHTML(genre)}</span>`
                   ).join("")}
                 </p>`
              : ""
          }

          <h3>Cast</h3>
          <div class="cast-list">
            ${(data.cast || []).map(person => `
              <button class="cast-person"
                data-open-kind="person"
                data-open-id="${person.id}">
                ${
                  person.profile
                    ? `<img src="${escapeHTML(person.profile)}"
                            alt="${escapeHTML(person.name)}">`
                    : ""
                }
                <span>${escapeHTML(person.name)}</span>
                <small>${escapeHTML(person.character || "")}</small>
              </button>
            `).join("")}
          </div>

          <h3>Recommended Titles</h3>
          <div class="detail-recommendations">
            ${(data.recommendations || []).map(item => `
              <button class="mini-title"
                data-open-kind="${escapeHTML(item.media_type || kind)}"
                data-open-id="${item.id}">
                ${
                  item.poster
                    ? `<img src="${escapeHTML(item.poster)}"
                            alt="${escapeHTML(titleFor(item))}">`
                    : ""
                }
                <span>${escapeHTML(titleFor(item))}</span>
              </button>
            `).join("")}
          </div>
        </div>
      `;
    }
  } catch (error) {
    $("detail-content").innerHTML = `
      <div class="error-state">
        ${escapeHTML(error.message)}
      </div>
    `;
  }
}
/* =========================
   MOVIE DETAILS
========================= */

async function openDetail(kind, id) {
  $("detail-content").innerHTML = `
    <div class="loading-card">Loading title details…</div>
  `;

  $("detail-dialog").showModal();

  try {
    const data = await api(`/api/detail/${kind}/${id}`);

    if (kind === "person") {
      $("detail-content").innerHTML = `
        <div class="detail-close-row">
          <button class="modal-close"
            onclick="document.getElementById('detail-dialog').close()">
            ×
          </button>
        </div>

        <div class="detail-hero">
          ${
            data.profile
              ? `<img src="${escapeHTML(data.profile)}"
                      alt="${escapeHTML(data.title)}">`
              : ""
          }

          <div>
            <p class="eyebrow">ACTOR & CREATOR</p>
            <h2>${escapeHTML(data.title)}</h2>
            <p class="muted">
              ${escapeHTML(
                data.known_for_department || "Entertainment professional"
              )}
            </p>
          </div>
        </div>

        <div class="detail-body">
          <h3>Biography</h3>
          <p>${escapeHTML(
            data.biography || "No biography is available from the data provider."
          )}</p>

          <h3>Filmography</h3>
          <div class="movie-grid">
            ${(data.filmography || []).map((item) => card(item)).join("")}
          </div>
        </div>
      `;
    } else {
      const background = data.backdrop
        ? `background-image:linear-gradient(0deg,#111019 0%,#111019a8 48%,#11101935),url('${data.backdrop}')`
        : "";

      $("detail-content").innerHTML = `
        <div class="detail-close-row">
          <button class="modal-close"
            onclick="document.getElementById('detail-dialog').close()">
            ×
          </button>
        </div>

        <div class="detail-hero" style="${background}">
          ${
            data.poster
              ? `<img src="${escapeHTML(data.poster)}"
                      alt="${escapeHTML(data.title)} poster">`
              : ""
          }

          <div>
            <p class="eyebrow">
              ${escapeHTML(kind === "tv" ? "TV SERIES" : "FEATURE FILM")}
            </p>

            <h2>${escapeHTML(data.title)}</h2>

            <p class="muted">
              ${escapeHTML(data.year)}
              ·
              ${
                Number(data.rating) > 0
                  ? "★ " + Number(data.rating).toFixed(1)
                  : "No rating"
              }
              ·
              ${escapeHTML((data.genres || []).join(" / "))}
            </p>

            <button class="primary-button" data-detail-watch="1">
              ＋ Add to My List
            </button>
          </div>
        </div>

        <div class="detail-body">
          ${
            data.tagline
              ? `<p><em>${escapeHTML(data.tagline)}</em></p>`
              : ""
          }

          <h3>Overview</h3>
          <p>${escapeHTML(data.overview || "No overview is available.")}</p>

          <p class="muted">
            Original language: ${escapeHTML(data.original_language || "—")}
            · Status: ${escapeHTML(data.status || "—")}
            ${
              data.runtime
                ? ` · Runtime: ${escapeHTML(data.runtime)} min`
                : ""
            }
          </p>

          <h3>Cast</h3>

          <div class="cast-row">
            ${(data.cast || []).map((person) => `
              <div class="cast-person">
                ${
                  person.profile
                    ? `<img src="${escapeHTML(person.profile)}"
                            alt="${escapeHTML(person.name)}"
                            onerror="this.onerror=null;this.src='${placeholder}'">`
                    : `<img src="${placeholder}" alt="No profile image">`
                }

                <strong>${escapeHTML(person.name)}</strong>
                <br>
                <span>${escapeHTML(person.character || "")}</span>
              </div>
            `).join("")}
          </div>

          <h3>You might also like</h3>

          <div class="movie-grid">
            ${(data.recommendations || []).map((item) => card(item)).join("")}
          </div>
        </div>
      `;

      const watchButton =
        $("detail-content").querySelector("[data-detail-watch]");

      if (watchButton) {
        watchButton.onclick = () => addWatchlist(data, kind);
      }
    }
  } catch (error) {
    $("detail-content").innerHTML = `
      <div class="detail-body">
        <p>${escapeHTML(error.message)}</p>
      </div>
    `;
  }
}

/* =========================
   WATCHLIST
========================= */

async function addWatchlist(item, kind) {
  if (!state.user) {
    toast("Sign in to save titles.");
    openAuth();
    return;
  }

  try {
    await api("/api/watchlist", {
      method: "POST",
      body: JSON.stringify({
        id: item.id,
        media_type: kind || item.media_type || "movie",
        title: titleFor(item),
        poster_path:
          item.poster_path ||
          (item.poster ? item.poster.split("/w500")[1] : null),
        release_date: item.release_date || null,
        rating: item.rating || null
      })
    });

    toast("Added to your watchlist.");

    if (state.view === "watchlist") {
      loadWatchlist();
    }
  } catch (error) {
    toast(error.message);
  }
}

async function removeWatchlist(item) {
  try {
    await api(
      `/api/watchlist/${item.media_type}/${item.id}`,
      { method: "DELETE" }
    );

    toast("Removed from your watchlist.");
    loadWatchlist();
  } catch (error) {
    toast(error.message);
  }
}

/* =========================
   LOGIN AND REGISTRATION
========================= */

function openAuth(mode = "login") {
  state.authMode = mode;
  updateAuthMode();
  $("auth-dialog").showModal();
}

function updateAuthMode() {
  const registering = state.authMode === "register";

  $("auth-title").textContent =
    registering ? "Create account" : "Sign in";

  $("auth-description").textContent = registering
    ? "Start building your personal entertainment universe."
    : "Save your watchlist and preferences.";

  $("username-wrap").classList.toggle("hidden", !registering);
  $("email-wrap").classList.toggle("hidden", !registering);
  $("identifier-label").classList.toggle("hidden", registering);

  $("auth-identifier").required = !registering;
  $("auth-email").required = registering;
  $("auth-username").required = registering;

  $("auth-submit").textContent =
    registering ? "Create account" : "Sign in";

  $("auth-switch-copy").textContent =
    registering ? "Already have an account?" : "New here?";

  $("auth-switch").textContent =
    registering ? "Sign in" : "Create an account";
}

async function authSubmit(event) {
  event.preventDefault();

  const registering = state.authMode === "register";

  const payload = registering
    ? {
        username: $("auth-username").value,
        email: $("auth-email").value,
        password: $("auth-password").value
      }
    : {
        identifier: $("auth-identifier").value,
        password: $("auth-password").value
      };

  try {
    const data = await api(
      `/api/auth/${registering ? "register" : "login"}`,
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    );

    state.user = data.username;

    $("auth-dialog").close();
    $("auth-button").textContent = data.username;

    toast(
      registering
        ? "Account created. Welcome!"
        : "Welcome back!"
    );

    if (state.view === "watchlist") {
      loadWatchlist();
    }
  } catch (error) {
    toast(error.message);
  }
}

async function refreshMe() {
  try {
    const data = await api("/api/me");

    state.user = data.signed_in ? data.username : null;
    $("auth-button").textContent = state.user || "Sign in";
  } catch (_error) {
    state.user = null;
  }
}

/* =========================
   PREFERENCES
========================= */

async function savePreferences() {
  if (!state.user) {
    toast("Sign in to save preferences.");
    openAuth();
    return;
  }

  const selectedValues = (id) =>
    Array.from($(id).selectedOptions).map((option) => option.value);

  try {
    await api("/api/preferences", {
      method: "PUT",
      body: JSON.stringify({
        region: $("pref-region").value,
        languages: selectedValues("pref-languages"),
        genres: selectedValues("pref-genres")
      })
    });

    toast("Preferences saved to your account.");
  } catch (error) {
    toast(error.message);
  }
}

async function loadPreferences() {
  if (!state.user) {
    toast("Sign in to save preferences.");
    openAuth();
    return;
  }

  try {
    const data = await api("/api/me");
    const preferences = data.preferences || {};

    $("pref-region").value = preferences.region || "";

    ["languages", "genres"].forEach((key) => {
      const select = $(`pref-${key}`);

      Array.from(select.options).forEach((option) => {
        option.selected = (preferences[key] || []).includes(
          option.value || option.text
        );
      });
    });
  } catch (error) {
    toast(error.message);
  }
}
/* =========================
   EVENT LISTENERS
========================= */

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");

  if (viewButton) {
    event.preventDefault();
    setView(viewButton.dataset.view);
  }

  const movieCard = event.target.closest(".movie-card");

  if (movieCard && !event.target.closest("[data-watch]")) {
    openDetail(movieCard.dataset.type, movieCard.dataset.id);
  }

  const watchButton = event.target.closest("[data-watch]");

  if (watchButton) {
    event.stopPropagation();

    const parentCard = watchButton.closest(".movie-card");

    const item = state.items.find((entry) =>
      String(entry.id) === parentCard.dataset.id &&
      entry.media_type === parentCard.dataset.type
    );

    if (item) {
      if (state.view === "watchlist") {
        removeWatchlist(item);
      } else {
        addWatchlist(item);
      }
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (
    (event.key === "Enter" || event.key === " ") &&
    event.target.classList.contains("movie-card")
  ) {
    event.preventDefault();
    openDetail(event.target.dataset.type, event.target.dataset.id);
  }
});

$("open-search").onclick = openSearch;
$("hero-voice-btn").onclick = () => startVoiceSearch("hero-query", "hero");
$("global-voice-btn").onclick = () => startVoiceSearch("global-query", "global");
$("plot-voice-btn").onclick = () => startVoiceSearch("plot-query", "plot");

$("close-search").onclick = () => {
  $("search-panel").classList.add("hidden");
};

$("global-search-btn").onclick = () => {
  runSearch(
    $("global-query").value,
    $("search-type").value
  );
};

$("global-query").addEventListener("input", () => {
  clearTimeout(state.searchTimer);

  state.searchTimer = setTimeout(() => {
    runSearch(
      $("global-query").value,
      $("search-type").value
    );
  }, 350);
});

$("hero-search-btn").onclick = () => {
  openSearch();

  $("global-query").value = $("hero-query").value;

  runSearch($("global-query").value);
};

$("hero-query").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    $("hero-search-btn").click();
  }
});

$("global-query").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    runSearch(
      $("global-query").value,
      $("search-type").value
    );
  }
});

$("plot-search-btn").onclick = runPlotSearch;

$("see-all").onclick = () => {
  if (state.view === "home") {
    loadTrending("all");
  } else if (state.view === "movies") {
    loadDiscover("movie");
  } else if (state.view === "shows") {
    loadDiscover("tv");
  } else if (state.view === "actors") {
    loadPeople();
  } else {
    loadWatchlist();
  }
};

$("apply-filters").onclick = () => {
  const kind = state.view === "shows" ? "tv" : "movie";
  const filters = {};

  if ($("genre-filter").value) {
    filters.with_genres = $("genre-filter").value;
  }

  if ($("language-filter").value) {
    filters.with_original_language = $("language-filter").value;
  }

  if ($("year-filter").value) {
    filters[
      kind === "tv"
        ? "first_air_date_year"
        : "primary_release_year"
    ] = $("year-filter").value;
  }

  if ($("rating-filter").value) {
    filters["vote_average.gte"] = $("rating-filter").value;
  }

  loadDiscover(kind, filters);
};

$("auth-button").onclick = async () => {
  if (state.user) {
    if (confirm("Sign out of CineVerse?")) {
      await api("/api/auth/logout", { method: "POST" });

      state.user = null;
      $("auth-button").textContent = "Sign in";

      toast("Signed out.");

      if (state.view === "watchlist") {
        loadWatchlist();
      }
    }
  } else {
    openAuth();
  }
};

$("auth-close").onclick = () => {
  $("auth-dialog").close();
};

$("auth-form").onsubmit = authSubmit;

$("auth-switch").onclick = () => {
  state.authMode =
    state.authMode === "login" ? "register" : "login";

  updateAuthMode();
};

$("detail-close").onclick = () => {
  $("detail-dialog").close();
};

$("save-preferences").onclick = savePreferences;

$("mobile-menu").onclick = () => {
  document.querySelector(".main-nav").classList.toggle("open");
};

$("year-now").textContent = new Date().getFullYear();

/* =========================
   FEATURED SUPERHERO HERO
========================= */

async function loadHeroFeatured() {
  try {
    const movie = await api("/api/hero-featured");

    window.cineVerseHeroMovie = movie;

    $("hero-title").textContent =
      movie.title || "Featured Movie";

    $("hero-copy").textContent =
      movie.overview || "Discover your next favorite movie.";

    $("hero-eyebrow").textContent =
      /spider-man/i.test(movie.title || "")
        ? "SUPERHERO SPOTLIGHT"
        : "TRENDING MOVIE";

    const rating = Number(movie.rating);

    $("hero-meta").textContent =
      `${
        Number.isFinite(rating) && rating > 0
          ? "★ " + rating.toFixed(1) + " / 10"
          : "Featured movie"
      } · ${movie.year || "Explore now"}`;

    if (movie.backdrop) {
      $("hero").style.backgroundImage =
        `linear-gradient(90deg, rgba(8,8,13,.92), rgba(8,8,13,.38)), url("${movie.backdrop}")`;

      $("hero").style.backgroundSize = "cover";
      $("hero").style.backgroundPosition = "center";

      $("hero-video").poster = movie.backdrop;
    }
  } catch (error) {
    console.error("Featured movie could not load:", error);
  }
}

$("hero-featured-info").addEventListener("click", () => {
  const movie = window.cineVerseHeroMovie;

  if (movie && movie.id) {
    openDetail(movie.media_type || "movie", movie.id);
  } else {
    toast("Featured movie is still loading. Please try again.");
  }
});

/* =========================
   INITIALIZE CINEVERSE
========================= */

async function initializeApp() {
  await refreshMe();
  await loadHeroFeatured();
  await loadTrending("all");
}

initializeApp();