const path = require("path");
const fs = require("fs/promises");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

/*
// ruta raiz GET que devuelve un mensaje de bienvenida 
app.get('/', (req, res) => {
    res.send('Bienvenido a la biblioteca PWA');
});
*/

const ROOT = path.join(__dirname, "..");
const CLIENT_DIR = path.join(ROOT, "client");
const DATA_DIR = path.join(__dirname, "data");
const BOOKS_FILE = path.join(DATA_DIR, "books.json");
const RES_FILE = path.join(DATA_DIR, "reservations.json");

// Desactiva el header "X-Powered-By: Express" por seguridad (menos información expuesta)
app.disable("x-powered-by");

// Permite al servidor entender JSON en el cuerpo de las peticiones (POST)
app.use(express.json({ limit: "256kb" }));

async function readJson(file, fallback) {
  try {
    const txt = await fs.readFile(file, "utf8");
    return JSON.parse(txt);
  } catch {
    // Si el archivo no existe o falla la lectura, devuelve el valor por defecto
    return fallback;
  }
}

async function writeJsonAtomic(file, data) {
  // Escribe primero en un temporal y luego renombra.
  // Esto evita corrupción de datos si el servidor cae durante la escritura.
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file);
}

function userFromReq(req) {
  // Obtenemos el usuario del header personalizado X-User
  const u = (req.get("X-User") || "").trim();
  if (!u) return null;
  // Limitamos longitud para evitar abusos
  return u.slice(0, 64);
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "biblio-api", ts: Date.now() });
});

app.get("/api/books", async (req, res) => {
  const booksData = await readJson(BOOKS_FILE, { books: [] });
  const reservations = await readJson(RES_FILE, { byBookId: {} });
  const byBookId = reservations.byBookId || {};

  // Cruzamos libros con reservas para añadir el campo "isReserved" dinámicamente
  const out = (booksData.books || []).map((b) => {
    const r = byBookId[b.id];
    const reservedBy = r ? r.userId : null;
    return {
      ...b,
      reservedBy,
      isReserved: Boolean(reservedBy)
    };
  });

  res.json({ books: out });
});

app.get("/api/books/:id", async (req, res) => {
  const id = String(req.params.id);
  const booksData = await readJson(BOOKS_FILE, { books: [] });
  const book = (booksData.books || []).find((b) => b.id === id);
  if (!book) return res.status(404).json({ error: "NOT_FOUND" });

  const reservations = await readJson(RES_FILE, { byBookId: {} });
  const r = reservations.byBookId?.[id] || null;

  res.json({
    book: {
      ...book,
      reservedBy: r ? r.userId : null,
      isReserved: Boolean(r)
    }
  });
});

app.get("/api/reservations", async (req, res) => {
  const userId = userFromReq(req);
  if (!userId) return res.status(401).json({ error: "MISSING_USER" });

  const booksData = await readJson(BOOKS_FILE, { books: [] });
  const reservations = await readJson(RES_FILE, { byBookId: {} });
  const byBookId = reservations.byBookId || {};

  // Filtramos SOLO las reservas que pertenecen al usuario (privacidad)
  const my = Object.entries(byBookId)
    .filter(([, v]) => v.userId === userId)
    .map(([bookId, v]) => {
      const book = (booksData.books || []).find((b) => b.id === bookId);
      return {
        bookId,
        reservedAt: v.reservedAt,
        title: book?.title || "(Libro desconocido)",
        author: book?.author || ""
      };
    });

  res.json({ userId, reservations: my });
});

app.post("/api/reservations", async (req, res) => {
  const userId = userFromReq(req);
  if (!userId) return res.status(401).json({ error: "MISSING_USER" });

  const bookId = String(req.body?.bookId || "").trim();
  if (!bookId) return res.status(400).json({ error: "MISSING_BOOK_ID" });

  const booksData = await readJson(BOOKS_FILE, { books: [] });
  const book = (booksData.books || []).find((b) => b.id === bookId);
  if (!book) return res.status(404).json({ error: "BOOK_NOT_FOUND" });

  const reservations = await readJson(RES_FILE, { byBookId: {} });
  reservations.byBookId = reservations.byBookId || {};

  // Comprobar conflicto: si ya está reservado por OTRO usuario
  const current = reservations.byBookId[bookId];
  if (current && current.userId !== userId) {
    return res.status(409).json({ error: "ALREADY_RESERVED", reservedBy: current.userId });
  }

  reservations.byBookId[bookId] = {
    userId,
    reservedAt: new Date().toISOString()
  };

  await writeJsonAtomic(RES_FILE, reservations);
  res.json({ ok: true, bookId });
});

app.delete("/api/reservations/:bookId", async (req, res) => {
  const userId = userFromReq(req);
  if (!userId) return res.status(401).json({ error: "MISSING_USER" });

  const bookId = String(req.params.bookId);
  const reservations = await readJson(RES_FILE, { byBookId: {} });
  reservations.byBookId = reservations.byBookId || {};

  const current = reservations.byBookId[bookId];
  if (!current) return res.json({ ok: true, removed: false });
  
  // Solo el dueño de la reserva puede cancelarla
  if (current.userId !== userId) return res.status(403).json({ error: "NOT_OWNER" });

  delete reservations.byBookId[bookId];
  await writeJsonAtomic(RES_FILE, reservations);
  res.json({ ok: true, removed: true });
});

// Servir archivos de la carpeta client/
app.use(express.static(CLIENT_DIR, {
  extensions: ["html"],
  etag: true,
  lastModified: true
}));

// Fallback: cualquier ruta no API ni estática devuelve index.html (SPA)
app.get("*", (req, res) => {
  res.sendFile(path.join(CLIENT_DIR, "index.html"));
});

// se inicia el servidor
app.listen(PORT, () => {
    console.log(`Biblioteca PWA+API
        corriendo en http://localhost:${PORT}`);
});