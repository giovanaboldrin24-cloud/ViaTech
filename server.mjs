import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = process.env.VIATECH_DATA_DIR ? path.resolve(process.env.VIATECH_DATA_DIR) : path.join(__dirname, "data");
const uploadDir = path.join(dataDir, "uploads");
const dbFile = path.join(dataDir, "store.json");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const sessions = new Map();

const defaultStore = {
  settings: {
    whatsapp: "",
    adminUser: "admin",
    originCep: "14010000",
    originCity: "Ribeirão Preto",
    originState: "SP",
    handlingFee: 3.9,
    freeShippingFrom: 0,
  },
  categories: [
    { id: "audio", name: "Áudio", description: "Fones, caixas de som e acessórios bluetooth." },
    { id: "wearables", name: "Wearable", description: "Relógios inteligentes e dispositivos conectados." },
    { id: "energia", name: "Energia", description: "Carregadores, cabos e power banks." },
  ],
  products: [
    {
      id: "fone-bluetooth-pro-x",
      name: "Fone Bluetooth Pro X",
      categoryId: "audio",
      price: 249.9,
      compareAt: 329.9,
      stock: 8,
      rating: 4.9,
      promo: true,
      visible: true,
      featured: true,
      image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=85",
      description: "Cancelamento de ruído, áudio imersivo e bateria para longas jornadas.",
    },
    {
      id: "smartwatch-pulse",
      name: "Smartwatch Pulse",
      categoryId: "wearables",
      price: 189.9,
      compareAt: 239.9,
      stock: 5,
      rating: 4.8,
      promo: true,
      visible: true,
      featured: true,
      image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85",
      description: "Monitoramento diário, notificações rápidas e design minimalista.",
    },
    {
      id: "power-bank-20k",
      name: "Power Bank 20K",
      categoryId: "energia",
      price: 129.9,
      compareAt: 159.9,
      stock: 7,
      rating: 4.7,
      promo: true,
      visible: true,
      featured: true,
      image: "https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?auto=format&fit=crop&w=900&q=85",
      description: "Carga rápida para celular, fone, tablet e acessórios durante o dia.",
    },
  ],
  customers: [],
  reviews: [],
  orders: [],
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, auth) {
  if (!auth?.salt || !auth?.hash) return false;
  const hash = crypto.scryptSync(String(password), auth.salt, 64);
  const expected = Buffer.from(auth.hash, "hex");
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(uploadDir, { recursive: true });
  try {
    await fs.access(dbFile);
  } catch {
    const auth = passwordRecord("123456");
    await writeStore({ ...clone(defaultStore), auth });
  }
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(dbFile, "utf8");
  const data = JSON.parse(raw);
  return normalizeStore(data);
}

async function writeStore(store) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dbFile, JSON.stringify(normalizeStore(store), null, 2), "utf8");
}

function normalizeStore(data) {
  const auth = data.auth?.hash ? data.auth : passwordRecord("123456");
  return {
    ...clone(defaultStore),
    ...data,
    settings: { ...defaultStore.settings, ...(data.settings || {}) },
    categories: Array.isArray(data.categories) && data.categories.length ? data.categories : clone(defaultStore.categories),
    products: Array.isArray(data.products) && data.products.length ? data.products : clone(defaultStore.products),
    customers: Array.isArray(data.customers) ? data.customers : [],
    reviews: Array.isArray(data.reviews) ? data.reviews : [],
    orders: Array.isArray(data.orders) ? data.orders : [],
    auth,
  };
}

function publicStore(store) {
  const copy = clone(store);
  delete copy.auth;
  copy.settings = { ...copy.settings, adminPass: "" };
  return copy;
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 25_000_000) throw new Error("Payload grande demais.");
  }
  return body ? JSON.parse(body) : {};
}

function createSession() {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + 1000 * 60 * 60 * 12);
  return token;
}

function sessionFrom(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return "";
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    sessions.delete(token);
    return "";
  }
  return token;
}

function mergeByKey(existing, incoming, key) {
  const map = new Map(existing.map((item) => [item[key], item]));
  for (const item of incoming || []) {
    if (!item?.[key]) continue;
    map.set(item[key], { ...(map.get(item[key]) || {}), ...item });
  }
  return [...map.values()];
}

function mergePublicChanges(current, incoming) {
  current.customers = mergeByKey(current.customers, incoming.customers || [], "email");
  current.reviews = mergeByKey(current.reviews, incoming.reviews || [], "id");
  current.orders = mergeByKey(current.orders, incoming.orders || [], "id");

  const incomingProducts = new Map((incoming.products || []).map((product) => [product.id, product]));
  current.products = current.products.map((product) => {
    const changed = incomingProducts.get(product.id);
    if (!changed || typeof changed.stock === "undefined") return product;
    const nextStock = Math.min(Number(product.stock || 0), Number(changed.stock || 0));
    return { ...product, stock: Number.isFinite(nextStock) ? nextStock : product.stock };
  });

  return current;
}

function applyAdminChanges(current, incoming) {
  current.settings = { ...current.settings, ...(incoming.settings || {}) };
  if (incoming.settings?.adminUser) current.settings.adminUser = String(incoming.settings.adminUser);
  if (incoming.settings?.adminPass) current.auth = passwordRecord(String(incoming.settings.adminPass));
  delete current.settings.adminPass;

  if (Array.isArray(incoming.categories)) current.categories = incoming.categories;
  if (Array.isArray(incoming.products)) current.products = incoming.products;
  if (Array.isArray(incoming.customers)) current.customers = incoming.customers;
  if (Array.isArray(incoming.reviews)) current.reviews = incoming.reviews;
  if (Array.isArray(incoming.orders)) current.orders = incoming.orders;
  return current;
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/store") {
    return json(res, 200, publicStore(await readStore()));
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    const body = await readJson(req);
    const store = await readStore();
    const validUser = String(body.user || "") === String(store.settings.adminUser || "admin");
    const validPass = verifyPassword(String(body.password || ""), store.auth);
    if (!validUser || !validPass) return json(res, 401, { error: "Usuário ou senha inválidos." });
    return json(res, 200, { token: createSession(), store: publicStore(store) });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/logout") {
    const token = sessionFrom(req);
    if (token) sessions.delete(token);
    return json(res, 200, { ok: true });
  }

  if (req.method === "PUT" && url.pathname === "/api/store") {
    const incoming = await readJson(req);
    const store = await readStore();
    const isAdmin = Boolean(sessionFrom(req));
    const nextStore = isAdmin ? applyAdminChanges(store, incoming) : mergePublicChanges(store, incoming);
    await writeStore(nextStore);
    return json(res, 200, publicStore(nextStore));
  }

  if (req.method === "POST" && url.pathname === "/api/upload") {
    if (!sessionFrom(req)) return json(res, 401, { error: "Acesso admin necessário." });
    const body = await readJson(req);
    const match = String(body.dataUrl || "").match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
    if (!match) return json(res, 400, { error: "Imagem inválida." });
    const extension = match[1].includes("png") ? "png" : match[1].includes("webp") ? "webp" : "jpg";
    const name = String(body.name || "produto").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "produto";
    const filename = `${Date.now()}-${name}.${extension}`;
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(path.join(uploadDir, filename), Buffer.from(match[2], "base64"));
    return json(res, 200, { url: `/uploads/${filename}` });
  }

  return json(res, 404, { error: "API não encontrada." });
}

async function serveFile(req, res, url) {
  let base = publicDir;
  let requestPath = decodeURIComponent(url.pathname);

  if (requestPath.startsWith("/uploads/")) {
    base = uploadDir;
    requestPath = requestPath.replace(/^\/uploads\//, "/");
  }

  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(base, safePath === "/" ? "index.html" : safePath);
  if (!filePath.startsWith(base)) {
    res.writeHead(403);
    res.end("Acesso negado");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Arquivo não encontrado");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveFile(req, res, url);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: "Erro interno do servidor." });
  }
});

await ensureStore();
server.listen(port, host, () => {
  console.log(`ViaTech real rodando em http://127.0.0.1:${port}`);
});
