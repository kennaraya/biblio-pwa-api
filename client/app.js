const $ = (sel) => document.querySelector(sel);

const els = {
  userId: $("#userId"),
  saveUserBtn: $("#saveUserBtn"),

  q: $("#q"),
  filtro: $("#filtro"),
  btnBuscar: $("#btnBuscar"),
  btnLimpiar: $("#btnLimpiar"),
  lista: $("#lista"),
  count: $("#count"),
  empty: $("#empty"),

  detail: $("#detail"),
  detailHint: $("#detailHint"),
  dTitle: $("#dTitle"),
  dAuthor: $("#dAuthor"),
  dYear: $("#dYear"),
  dTags: $("#dTags"),
  dAvailability: $("#dAvailability"),
  dLocation: $("#dLocation"),
  dIsbn: $("#dIsbn"),
  reserveBtn: $("#reserveBtn"),
  shareBtn: $("#shareBtn"),
  actionMsg: $("#actionMsg"),

  myRes: $("#myRes"),
  myResEmpty: $("#myResEmpty"),

  installBtn: $("#installBtn"),
  resetBtn: $("#resetBtn"),

  netDot: $("#netDot"),
  netText: $("#netText"),
  swText: $("#swText"),
  apiText: $("#apiText"),
};

const STORAGE = {
  userId: "biblio_user_v1",
  booksCache: "biblio_books_cache_v2",
  myResCache: "biblio_my_res_cache_v1"
};

let books = [];
let selectedId = null;
let myReservations = [];

function getUserId() {
  return (localStorage.getItem(STORAGE.userId) || "demo").trim() || "demo";
}

function setUserId(v) {
  localStorage.setItem(STORAGE.userId, (v || "demo").trim() || "demo");
}

function apiHeaders() {
  return {
    "Content-Type": "application/json",
    "X-User": getUserId()
  };
}

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), ...apiHeaders() }
  });

  const ct = res.headers.get("content-type") || "";
  const payload = ct.includes("application/json") ? await res.json() : await res.text();

  if (!res.ok) {
    const err = new Error("API_ERROR");
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

function saveBooksCache() {
  localStorage.setItem(STORAGE.booksCache, JSON.stringify({ books, savedAt: Date.now() }));
}

function loadBooksCache() {
  const raw = localStorage.getItem(STORAGE.booksCache);
  if (!raw) return [];
  try { return JSON.parse(raw).books || []; } catch { return []; }
}

function saveMyResCache() {
  localStorage.setItem(STORAGE.myResCache, JSON.stringify({ reservations: myReservations, savedAt: Date.now() }));
}

function loadMyResCache() {
  const raw = localStorage.getItem(STORAGE.myResCache);
  if (!raw) return [];
  try { return JSON.parse(raw).reservations || []; } catch { return []; }
}

function isReservedByMe(bookId) {
  return myReservations.some((r) => r.bookId === bookId);
}

function availabilityLabel(book) {
  if (isReservedByMe(book.id)) return { text: "Reservado por mí", ok: false };
  if (!book.isReserved) return { text: "Disponible", ok: true };
  return { text: "Reservado", ok: false };
}

function makeTag(t) {
  const el = document.createElement("span");
  el.className = "tag";
  el.textContent = t;
  return el;
}

function renderMyReservations() {
  els.myRes.innerHTML = "";

  if (!myReservations || myReservations.length === 0) {
    els.myResEmpty.hidden = false;
    return;
  }
  els.myResEmpty.hidden = true;

  myReservations.forEach((r) => {
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.textContent = r.title;

    const btn = document.createElement("button");
    btn.className = "link";
    btn.type = "button";
    btn.textContent = "Quitar";
    btn.addEventListener("click", async () => {
      await cancelReservation(r.bookId);
    });

    li.append(left, btn);
    els.myRes.appendChild(li);
  });
}

// ── Rellena la sección de detalle con los datos del libro seleccionado ──
function renderDetail(bookId) {
  const book = books.find((b) => b.id === bookId); // Busca el libro por ID en el array local
  if (!book) return;                                // Si no existe, no hace nada

  selectedId = bookId;            // Guarda el ID seleccionado para re-renderizar tras reservar
  els.detail.hidden = false;      // Muestra el panel de detalle (estaba oculto con hidden)
  els.detailHint.textContent = "";
  els.actionMsg.textContent = ""; // Limpia mensajes de acciones anteriores

  // Rellena los campos de texto del detalle
  els.dTitle.textContent    = book.title;
  els.dAuthor.textContent   = book.author;
  els.dYear.textContent     = book.year;
  els.dIsbn.textContent     = book.isbn;
  els.dLocation.textContent = book.location;

  // Limpia y re-genera las etiquetas (chips de categoría)
  els.dTags.innerHTML = "";
  (book.tags || []).forEach((t) => els.dTags.appendChild(makeTag(t)));

  // Calcula disponibilidad y aplica color (verde=ok, rosa=no disponible)
  const a = availabilityLabel(book);
  els.dAvailability.textContent = a.text;
  els.dAvailability.style.color = a.ok ? "#1f7a4a" : "#8a1f4d";

  // El botón alterna entre "Reservar" y "Cancelar reserva" según estado
  els.reserveBtn.textContent = isReservedByMe(book.id) ? "Cancelar reserva" : "Reservar";

  // Handler del botón Reservar/Cancelar
  els.reserveBtn.onclick = async () => {
    if (!navigator.onLine) {  // Bloquea si no hay conexión (no hay offline queue en esta versión)
      els.actionMsg.textContent = "Estás offline: reservar/cancelar requiere conexión.";
      return;
    }
    if (isReservedByMe(book.id)) await cancelReservation(book.id);
    else                          await createReservation(book.id);
  };

  // Handler del botón Compartir (usa Web Share API si está disponible)
  els.shareBtn.onclick = async () => {
    const text = `Te recomiendo: ${book.title} — ${book.author} (${book.year})`;
    const url  = location.href.split("#")[0] + `#${encodeURIComponent(book.id)}`;
    if (navigator.share) {
      try { await navigator.share({ title: "Biblioteca", text, url }); } catch {}
    } else {
      await navigator.clipboard?.writeText(`${text}\n${url}`); // Fallback: copiar al portapapeles
      alert("Enlace copiado.\n\n" + url);
    }
  };
}

// ── Comprueba si el libro coincide con la búsqueda ──
function matchesQuery(book, q) {
  if (!q) return true; // Sin query, todos pasan
  const hay = `${book.title} ${book.author} ${(book.tags||[]).join(" ")}`.toLowerCase();
  return hay.includes(q.toLowerCase()); // Búsqueda simple "includes" (no regex, no fuzzy)
}

// ── Comprueba si el libro pasa el filtro de disponibilidad ──
function matchesFilter(book, filter) {
  if (filter === "available") return !book.isReserved;        // Solo libros libres
  if (filter === "reserved")  return isReservedByMe(book.id); // Solo mis reservas
  return true;                                                  // "all" → sin filtro
}

// ── Renderiza la lista de resultados aplicando filtros ──
function renderList() {
  const q      = els.q.value.trim();
  const filter = els.filtro.value;

  const rows = books
    .filter((b) => matchesQuery(b, q))    // Filtra por texto
    .filter((b) => matchesFilter(b, filter)); // Filtra por disponibilidad

  els.lista.innerHTML = "";                     // Limpia la lista anterior
  els.count.textContent = String(rows.length);  // Actualiza contador de resultados
  els.empty.hidden = rows.length !== 0;         // Muestra/oculta el mensaje "sin resultados"

  rows.forEach((b) => {
    const li      = document.createElement("li");
    li.className  = "item";

    const main    = document.createElement("div");
    main.className = "item__main";

    const h       = document.createElement("p");
    h.className   = "item__title";
    h.textContent = b.title;

    const meta    = document.createElement("p");
    meta.className = "item__meta";
    meta.textContent = `${b.author} · ${b.year} · ${b.location}`;

    main.append(h, meta);

    const actions    = document.createElement("div");
    actions.className = "item__actions";

    // Chip de disponibilidad (verde o rosa)
    const av   = availabilityLabel(b);
    const chip = document.createElement("span");
    chip.className = `chip ${av.ok ? "chip--ok" : "chip--no"}`;
    chip.textContent = av.text;

    // Botón "Ver" para abrir el detalle del libro
    const btn  = document.createElement("button");
    btn.className = "link";
    btn.type      = "button";
    btn.textContent = "Ver";
    btn.addEventListener("click", () => {
      location.hash = encodeURIComponent(b.id); // Actualiza la URL con hash del libro
      renderDetail(b.id);
      renderMyReservations();
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    });

    actions.append(chip, btn);
    li.append(main, actions);
    els.lista.appendChild(li);
  });
}

// ── Carga el catálogo de libros con estrategia red → localStorage ──
async function loadBooks() {
  try {
    // cache:"no-store" evita caché HTTP nativa; el SW puede interceptar si está activo
    const data = await fetch("/api/books", { cache: "no-store" }).then(r => r.json());
    books = data.books || [];
    saveBooksCache(); // Guarda copia en localStorage para próxima vez offline
  } catch {
    // Sin red o API caída: usa la última copia localStorage
    books = loadBooksCache();
  }
}

// ── Carga las reservas del usuario con estrategia red → localStorage ──
async function loadMyReservations() {
  try {
    const data = await apiFetch("/api/reservations", { method: "GET" });
    myReservations = data.reservations || [];
    saveMyResCache(); // Guarda copia en localStorage (el SW no cachea este endpoint)
  } catch {
    // Si falla, muestra la última copia conocida del usuario actual
    myReservations = loadMyResCache();
  }
}

// ── Crear una reserva ──
async function createReservation(bookId) {
  try {
    await apiFetch("/api/reservations", {
      method: "POST",
      body: JSON.stringify({ bookId }) // Envía el ID del libro a reservar
    });
    els.actionMsg.textContent = "Reserva creada.";
  } catch (e) {
    // Manejo de errores específicos por código HTTP:
    if (e.status === 409) els.actionMsg.textContent = "No se pudo reservar: ya está reservado por otro usuario.";
    else if (e.status === 401) els.actionMsg.textContent = "Falta usuario (X-User).";
    else                       els.actionMsg.textContent = "Error al reservar.";
  }
  await refreshAll(); // Recarga datos y re-renderiza para mostrar estado actualizado
}

// ── Cancelar una reserva ──
async function cancelReservation(bookId) {
  try {
    await apiFetch(`/api/reservations/${encodeURIComponent(bookId)}`, { method: "DELETE" });
    els.actionMsg.textContent = "Reserva cancelada.";
  } catch (e) {
    if (e.status === 403) els.actionMsg.textContent = "No puedes cancelar una reserva que no es tuya.";
    else                  els.actionMsg.textContent = "Error al cancelar.";
  }
  await refreshAll();
}

// ── Refresca todos los datos y re-renderiza ──
async function refreshAll() {
  await Promise.all([loadMyReservations(), loadBooks()]); // Carga datos en paralelo
  renderMyReservations();
  renderList();
  if (selectedId) renderDetail(selectedId); // Re-renderiza detalle si hay uno abierto
}

let deferredPrompt = null; // Almacena el evento para usarlo después

// Captura el evento de instalación del navegador
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();           // Evita el banner automático del navegador
  deferredPrompt = e;           // Guarda el evento para usarlo al hacer clic
  els.installBtn.hidden = false; // Muestra el botón "Instalar" (estaba hidden)
});

// Al hacer clic en el botón "Instalar"
els.installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();       // Muestra el diálogo de instalación nativo
  try { await deferredPrompt.userChoice; } finally {
    deferredPrompt = null;       // Limpia la referencia tras la elección
    els.installBtn.hidden = true; // Oculta el botón (ya se instaló o rechazó)
  }
});

// ── Actualiza el punto de estado de conexión (verde/rojo) ──
function updateNetworkUI() {
  const online = navigator.onLine;
  els.netText.textContent = online ? "Online" : "Offline";
  els.netDot.classList.toggle("dot--on",  online);  // Clase CSS punto verde
  els.netDot.classList.toggle("dot--off", !online); // Clase CSS punto rojo
}
window.addEventListener("online",  updateNetworkUI); // Se dispara al recuperar red
window.addEventListener("offline", updateNetworkUI); // Se dispara al perder red

// ── Registra el Service Worker ──
async function registerSW() {
  if (!("serviceWorker" in navigator)) {
    els.swText.textContent = "Service Worker: no compatible";
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register("/sw.js"); // Registra sw.js en la raíz
    els.swText.textContent = "Service Worker: activo";

    // Detecta cuando se descarga una nueva versión del SW
    reg.addEventListener("updatefound", () => {
      els.swText.textContent = "Service Worker: actualizando…";
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener("statechange", () => {
        if (nw.state === "installed") {
          // Si hay un SW controlador activo, hay una nueva versión lista
          els.swText.textContent = navigator.serviceWorker.controller
            ? "Service Worker: nueva versión lista (recarga)"
            : "Service Worker: instalado";
        }
      });
    });
  } catch {
    els.swText.textContent = "Service Worker: error";
  }
}

// ── Comprueba si la API está disponible ──
async function checkApiHealth() {
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    if (!r.ok) throw new Error();
    const d = await r.json();
    els.apiText.textContent = d.ok ? "OK" : "KO"; // Muestra estado en la statusbar
  } catch {
    els.apiText.textContent = "No disponible";
  }
}

// ── Manejadores de eventos de UI ──
els.btnBuscar.addEventListener("click", renderList);
els.btnLimpiar.addEventListener("click", () => {
  els.q.value = "";
  els.filtro.value = "all";
  renderList();
});
els.q.addEventListener("input", renderList);        // Búsqueda en tiempo real
els.filtro.addEventListener("change", renderList);  // Filtra al cambiar el select

els.saveUserBtn.addEventListener("click", async () => {
  setUserId(els.userId.value);   // Guarda el nuevo usuario en localStorage
  els.actionMsg.textContent = "";
  await refreshAll();            // Recarga datos con el nuevo usuario
});

// Botón Reiniciar: borra localStorage y caches del SW
els.resetBtn.addEventListener("click", async () => {
  const ok = confirm("¿Seguro? Borra datos locales. No borra reservas del servidor.");
  if (!ok) return;
  localStorage.removeItem(STORAGE.userId);
  localStorage.removeItem(STORAGE.booksCache);
  localStorage.removeItem(STORAGE.myResCache);
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k))); // Vacía todas las caches del SW
  } catch {}
  location.hash = "";
  await boot(); // Reinicia la aplicación desde cero
});

// ── Función de arranque principal ──
async function boot() {
  updateNetworkUI();                          // Estado inicial de conexión
  els.userId.value = getUserId();             // Muestra el usuario actual

  // Carga en paralelo: SW + API health + datos
  await Promise.all([registerSW(), checkApiHealth(), loadMyReservations(), loadBooks()]);

  renderMyReservations();
  renderList();
  handleHashOpen(); // Si la URL tiene un hash (#bk-1001), abre ese libro

  // Detecta cambios de hash para navegación (compartir enlace directo)
  window.addEventListener("hashchange", () => {
    const id = decodeURIComponent((location.hash || "").replace(/^#/, "").trim());
    if (!id) return;
    renderDetail(id);
  });
}

applyPresetButtons(); // Conecta los botones de búsqueda rápida
boot();               // Arranca la app