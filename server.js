const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
require("dotenv").config({ quiet: true });
const { parse: parseCookie, serialize: serializeCookie } = require("cookie");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "bafing-admin-2026";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const MAIL_HOST = process.env.MAIL_HOST || "smtp.gmail.com";
const MAIL_PORT = Number(process.env.MAIL_PORT || 587);
const MAIL_SECURE = process.env.MAIL_SECURE === "true";
const MAIL_USER = process.env.MAIL_USER || "bafingbrunch@gmail.com";
const MAIL_FROM = process.env.MAIL_FROM || "Le Brunch du Bafing <bafingbrunch@gmail.com>";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");

const packs = {
  classique: {
    key: "classique",
    prefix: "PC",
    name: "Pack Classique",
    price: 3000,
    waveUrl: "https://pay.wave.com/m/M_ci_n7rTX5yCv86V/c/ci/?amount=3000",
    includes: [
      "L'entree du jour pour commencer en douceur",
      "1 repas au choix parmi les 3 propositions de la carte",
      "La note sucree de fin de repas",
      "Un cocktail rafraichissant sans alcool"
    ]
  },
  gourmand: {
    key: "gourmand",
    prefix: "PG",
    name: "Pack Gourmand",
    price: 5000,
    waveUrl: "https://pay.wave.com/m/M_ci_n7rTX5yCv86V/c/ci/?amount=5000",
    includes: [
      "L'entree du jour pour commencer en douceur",
      "2 repas differents au choix parmi les 3 de la carte",
      "La note sucree de fin de repas",
      "Un cocktail au choix, avec ou sans alcool"
    ]
  }
};

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "[]\n");
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]\n");

function readOrders() {
  return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
}

function writeOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2) + "\n");
}

function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2) + "\n");
}

function send(res, status, body, type = "text/html; charset=utf-8", headers = {}) {
  res.writeHead(status, { "Content-Type": type, ...headers });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function json(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function clean(value) {
  return String(value || "").trim().slice(0, 120);
}

function ticketCode(prefix, existingCodes) {
  let code;
  do {
    const date = new Date();
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
    const random = crypto.randomBytes(4).toString("hex").toUpperCase();
    code = `${prefix}-${stamp}-${random}`;
  } while (existingCodes.has(code));
  return code;
}

function makeToken() {
  return crypto.randomBytes(18).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function makeSession() {
  const value = `admin.${Date.now()}`;
  return `${value}.${sign(value)}`;
}

function makeUserSession(userId) {
  const value = `user.${userId}.${Date.now()}`;
  return `${value}.${sign(value)}`;
}

function readSession(req, cookieName, type) {
  const cookies = parseCookie(req.headers.cookie || "");
  const session = cookies[cookieName] || "";
  const pieces = session.split(".");
  if (pieces.length < 3) return null;
  const signature = pieces.at(-1);
  const value = pieces.slice(0, -1).join(".");
  const expected = sign(value);
  if (pieces[0] !== type || signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return pieces;
}

function isAdmin(req) {
  return Boolean(readSession(req, "bafing_admin", "admin"));
}

function currentUser(req) {
  const pieces = readSession(req, "bafing_user", "user");
  if (!pieces) return null;
  return readUsers().find((user) => user.id === pieces[1]) || null;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const candidate = hashPassword(password, salt).split(":")[1];
  return candidate.length === hash.length && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(body))));
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, "Interdit");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext = path.extname(file).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  };
  send(res, 200, fs.readFileSync(file), types[ext] || "application/octet-stream");
  return true;
}

function publicOrder(order) {
  const pack = packs[order.pack];
  return {
    id: order.id,
    token: order.token,
    status: order.status,
    ticketCode: order.ticketCode,
    buyerName: order.buyerName,
    buyerPhone: order.buyerPhone,
    buyerEmail: order.buyerEmail,
    packName: pack.name,
    packKey: pack.key,
    price: pack.price,
    waveUrl: pack.waveUrl,
    createdAt: order.createdAt,
    confirmedAt: order.confirmedAt || null,
    emailStatus: order.emailStatus || null
  };
}

function drawTicketPdf(order, stream) {
  const pack = packs[order.pack];
  const doc = new PDFDocument({ size: "A4", margin: 42 });
  doc.pipe(stream);

  doc.rect(0, 0, 595, 842).fill("#0b0907");
  doc.fillColor("#d7a84d").fontSize(18).text("LE BRUNCH DU BAFING", 42, 42, { align: "center" });
  doc.moveDown(0.5);
  doc.fillColor("#ffffff").fontSize(38).text(pack.name.toUpperCase(), { align: "center" });
  doc.fillColor("#d7a84d").fontSize(24).text(`${pack.price.toLocaleString("fr-FR")} F CFA`, { align: "center" });

  doc.roundedRect(72, 180, 451, 270, 10).fillAndStroke("#15110d", "#d7a84d");
  doc.fillColor("#ffffff").fontSize(13).text("Numero de ticket", 98, 210);
  doc.fillColor("#d7a84d").fontSize(28).text(order.ticketCode, 98, 232);
  doc.fillColor("#ffffff").fontSize(13).text("Nom", 98, 286);
  doc.fontSize(20).text(order.buyerName, 98, 306);
  doc.fontSize(13).text("Telephone", 98, 354);
  doc.fontSize(18).text(order.buyerPhone, 98, 374);
  doc.fontSize(13).text("Statut", 98, 414);
  doc.fillColor("#5ee28a").fontSize(18).text("Paiement confirme", 98, 434);

  doc.fillColor("#d7a84d").fontSize(16).text("Inclus dans votre formule", 72, 500);
  doc.fillColor("#ffffff").fontSize(12);
  pack.includes.forEach((item) => doc.text(`- ${item}`, 92, doc.y + 10));

  doc.fillColor("#ffffff").fontSize(14).text("Date : 28 juin", 72, 660);
  doc.text("Lieu : a preciser", 72, 684);
  doc.text("Dress code : blanc", 72, 708);
  doc.fillColor("#d7a84d").fontSize(11).text("Presentez ce ticket a l'entree. Ticket personnel et verifiable par son numero.", 72, 770, { align: "center" });
  doc.end();
}

function buildTicketPdf(order, res) {
  const filename = `ticket-${order.ticketCode}.pdf`;
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}"`
  });
  drawTicketPdf(order, res);
}

function ticketPdfBuffer(order) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = new (require("stream").PassThrough)();
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    drawTicketPdf(order, stream);
  });
}

function mailReady() {
  return Boolean(MAIL_HOST && MAIL_USER && process.env.MAIL_PASS && MAIL_FROM);
}

async function sendTicketEmail(order) {
  if (!order.buyerEmail || !mailReady()) return { sent: false, reason: "email_not_configured" };
  const pack = packs[order.pack];
  const transporter = nodemailer.createTransport({
    host: MAIL_HOST,
    port: MAIL_PORT,
    secure: MAIL_SECURE,
    auth: {
      user: MAIL_USER,
      pass: process.env.MAIL_PASS
    }
  });
  const pdf = await ticketPdfBuffer(order);
  await transporter.sendMail({
    from: MAIL_FROM,
    to: order.buyerEmail,
    subject: `Votre ticket ${order.ticketCode} - Le Brunch du Bafing`,
    text: `Bonjour ${order.buyerName},\n\nVotre paiement pour ${pack.name} a ete confirme. Votre ticket ${order.ticketCode} est en piece jointe.\n\nA tres vite au Brunch du Bafing.`,
    attachments: [{
      filename: `ticket-${order.ticketCode}.pdf`,
      content: pdf,
      contentType: "application/pdf"
    }]
  });
  return { sent: true };
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/me") {
    const user = currentUser(req);
    return json(res, 200, {
      user: user ? {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email
      } : null
    });
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    const body = await parseBody(req);
    const name = clean(body.name);
    const phone = clean(body.phone);
    const email = clean(body.email).toLowerCase();
    const password = String(body.password || "");
    if (!name || !phone || !email || password.length < 6) {
      return json(res, 400, { error: "Nom, telephone, email et mot de passe de 6 caracteres minimum obligatoires." });
    }
    const users = readUsers();
    if (users.some((user) => user.email.toLowerCase() === email)) {
      return json(res, 409, { error: "Un compte existe deja avec cet email." });
    }
    const user = {
      id: crypto.randomUUID(),
      name,
      phone,
      email,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    };
    users.unshift(user);
    writeUsers(users);
    const cookie = serializeCookie("bafing_user", makeUserSession(user.id), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30
    });
    res.writeHead(201, { "Content-Type": "application/json; charset=utf-8", "Set-Cookie": cookie });
    return res.end(JSON.stringify({ user: { id: user.id, name: user.name, phone: user.phone, email: user.email } }));
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await parseBody(req);
    const email = clean(body.email).toLowerCase();
    const user = readUsers().find((item) => item.email.toLowerCase() === email);
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      return json(res, 401, { error: "Email ou mot de passe incorrect." });
    }
    const cookie = serializeCookie("bafing_user", makeUserSession(user.id), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30
    });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Set-Cookie": cookie });
    return res.end(JSON.stringify({ user: { id: user.id, name: user.name, phone: user.phone, email: user.email } }));
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const cookie = serializeCookie("bafing_user", "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0
    });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Set-Cookie": cookie });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.method === "POST" && url.pathname === "/api/orders") {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: "Connectez-vous ou creez un compte avant de commander." });
    const body = await parseBody(req);
    const pack = packs[body.pack];
    if (!pack) return json(res, 400, { error: "Formule invalide." });

    const orders = readOrders();
    const existingCodes = new Set(orders.map((order) => order.ticketCode));
    const order = {
      id: crypto.randomUUID(),
      token: makeToken(),
      status: "pending",
      pack: pack.key,
      ticketCode: ticketCode(pack.prefix, existingCodes),
      userId: user.id,
      buyerName: user.name,
      buyerPhone: user.phone,
      buyerEmail: user.email,
      note: clean(body.note),
      createdAt: new Date().toISOString()
    };
    orders.unshift(order);
    writeOrders(orders);
    return json(res, 201, publicOrder(order));
  }

  if (req.method === "GET" && url.pathname === "/api/my-orders") {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: "Connectez-vous pour voir votre historique." });
    const orders = readOrders()
      .filter((order) => order.userId === user.id || order.buyerEmail?.toLowerCase() === user.email.toLowerCase())
      .map(publicOrder);
    return json(res, 200, { orders });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/orders/")) {
    const id = url.pathname.split("/")[3];
    const token = url.searchParams.get("token");
    const order = readOrders().find((item) => item.id === id && item.token === token);
    if (!order) return json(res, 404, { error: "Commande introuvable." });
    return json(res, 200, publicOrder(order));
  }

  if (req.method === "GET" && url.pathname.startsWith("/tickets/")) {
    const id = url.pathname.split("/")[2];
    const token = url.searchParams.get("token");
    const order = readOrders().find((item) => item.id === id && item.token === token);
    if (!order) return send(res, 404, "Ticket introuvable.");
    if (order.status !== "paid") return send(res, 403, "Paiement pas encore confirme.");
    return buildTicketPdf(order, res);
  }

  if (req.method === "POST" && url.pathname === "/admin/login") {
    const body = await parseBody(req);
    if (body.password !== ADMIN_PASSWORD) return redirect(res, "/admin?error=1");
    const cookie = serializeCookie("bafing_admin", makeSession(), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8
    });
    res.writeHead(302, { Location: "/admin", "Set-Cookie": cookie });
    return res.end();
  }

  if (req.method === "POST" && url.pathname.startsWith("/admin/confirm/")) {
    if (!isAdmin(req)) return redirect(res, "/admin");
    const id = url.pathname.split("/")[3];
    const orders = readOrders();
    const order = orders.find((item) => item.id === id);
    if (order) {
      order.status = "paid";
      order.confirmedAt = new Date().toISOString();
      try {
        const result = await sendTicketEmail(order);
        order.emailStatus = result.sent ? "sent" : result.reason;
        order.emailSentAt = result.sent ? new Date().toISOString() : null;
      } catch (error) {
        console.error("Email ticket failed", error);
        order.emailStatus = "failed";
        order.emailError = error.message;
      }
      writeOrders(orders);
    }
    return redirect(res, "/admin");
  }

  if (req.method === "POST" && url.pathname.startsWith("/admin/cancel/")) {
    if (!isAdmin(req)) return redirect(res, "/admin");
    const id = url.pathname.split("/")[3];
    const orders = readOrders();
    const order = orders.find((item) => item.id === id);
    if (order) {
      order.status = "cancelled";
      order.cancelledAt = new Date().toISOString();
      writeOrders(orders);
    }
    return redirect(res, "/admin");
  }

  return false;
}

function adminPage(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!isAdmin(req)) {
    const error = url.searchParams.get("error") ? "<p class=\"error\">Mot de passe incorrect.</p>" : "";
    return send(res, 200, `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><title>Admin - Brunch du Bafing</title></head><body class="admin-body"><main class="admin-login"><h1>Admin</h1><p>Confirme les paiements Wave pour liberer les tickets PDF et envoyer le mail au client.</p>${error}<form method="post" action="/admin/login"><input type="password" name="password" placeholder="Mot de passe admin" required><button>Se connecter</button></form></main></body></html>`);
  }

  const rows = readOrders().map((order) => {
    const pack = packs[order.pack];
    const status = order.status === "paid" ? "Confirme" : order.status === "cancelled" ? "Annule" : "En attente";
    const emailStatus = {
      sent: "Envoye",
      email_not_configured: "SMTP a configurer",
      failed: "Erreur email"
    }[order.emailStatus] || "-";
    const actions = order.status === "pending"
      ? `<form method="post" action="/admin/confirm/${order.id}"><button>Confirmer</button></form><form method="post" action="/admin/cancel/${order.id}"><button class="ghost">Annuler</button></form>`
      : `<a class="link-button" href="/tickets/${order.id}?token=${order.token}">PDF</a>`;
    return `<tr><td><strong>${order.ticketCode}</strong><span>${new Date(order.createdAt).toLocaleString("fr-FR")}</span></td><td>${order.buyerName}<span>${order.buyerPhone}</span><span>${order.buyerEmail}</span></td><td>${pack.name}<span>${pack.price.toLocaleString("fr-FR")} F</span></td><td><mark class="${order.status}">${status}</mark></td><td>${emailStatus}</td><td class="actions">${actions}</td></tr>`;
  }).join("");

  return send(res, 200, `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><title>Admin - Brunch du Bafing</title></head><body class="admin-body"><main class="admin-panel"><div class="admin-head"><div><p>Billetterie</p><h1>Commandes Brunch du Bafing</h1></div><a href="/">Voir le site</a></div><table><thead><tr><th>Ticket</th><th>Acheteur</th><th>Formule</th><th>Statut</th><th>Email</th><th>Action</th></tr></thead><tbody>${rows || "<tr><td colspan=\"6\">Aucune commande pour le moment.</td></tr>"}</tbody></table></main></body></html>`);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/") || req.url.startsWith("/tickets/") || req.url.startsWith("/admin/")) {
      const handled = await handleApi(req, res);
      if (handled !== false) return;
    }
    if (req.method === "GET" && req.url.startsWith("/admin")) return adminPage(req, res);
    if (req.method === "GET" && serveStatic(req, res)) return;
    send(res, 404, "Page introuvable.");
  } catch (error) {
    console.error(error);
    send(res, 500, "Erreur serveur.");
  }
});

server.listen(PORT, () => {
  console.log(`Brunch du Bafing disponible sur http://localhost:${PORT}`);
  console.log(`Admin : http://localhost:${PORT}/admin`);
});
