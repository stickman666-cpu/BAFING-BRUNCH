const packs = {
  classique: { label: "Pack Classique", price: "3 000 F" },
  gourmand: { label: "Pack Gourmand", price: "5 000 F" }
};

const form = document.querySelector("#orderForm");
const packInput = form.elements.pack;
const summaryPack = document.querySelector("#summaryPack");
const summaryPrice = document.querySelector("#summaryPrice");
const paymentBox = document.querySelector("#paymentBox");
const authBox = document.querySelector("#authBox");
const connectedBox = document.querySelector("#connectedBox");
const connectedName = document.querySelector("#connectedName");
const connectedInfo = document.querySelector("#connectedInfo");
const accountBadge = document.querySelector("#accountBadge");
const authMessage = document.querySelector("#authMessage");
const registerForm = document.querySelector("#registerForm");
const loginForm = document.querySelector("#loginForm");
const logoutButton = document.querySelector("#logoutButton");
const historySection = document.querySelector("#historySection");
const historyList = document.querySelector("#historyList");
const refreshHistoryButton = document.querySelector("#refreshHistoryButton");
let currentUser = null;

function selectPack(key) {
  packInput.value = key;
  summaryPack.textContent = packs[key].label;
  summaryPrice.textContent = packs[key].price;
  document.querySelectorAll(".pack").forEach((pack) => {
    pack.classList.toggle("selected", pack.dataset.pack === key);
  });
}

document.querySelectorAll(".pack button").forEach((button) => {
  button.addEventListener("click", () => selectPack(button.closest(".pack").dataset.pack));
});

function setMessage(message, isError = false) {
  authMessage.textContent = message || "";
  authMessage.className = isError ? "error" : "success";
}

function renderUser(user) {
  currentUser = user;
  authBox.hidden = Boolean(user);
  connectedBox.hidden = !user;
  form.hidden = !user;
  historySection.hidden = !user;
  if (user) {
    connectedName.textContent = user.name;
    connectedInfo.textContent = `${user.phone} - ${user.email}`;
    accountBadge.textContent = user.name;
    loadHistory();
  } else {
    connectedName.textContent = "";
    connectedInfo.textContent = "";
    accountBadge.textContent = "";
    historyList.innerHTML = "";
  }
}

function statusLabel(status) {
  if (status === "paid") return "Paiement confirme";
  if (status === "cancelled") return "Commande annulee";
  return "En attente de confirmation";
}

function renderHistory(orders) {
  if (!orders.length) {
    historyList.innerHTML = `<article class="history-empty">Aucun ticket commande pour le moment.</article>`;
    return;
  }

  historyList.innerHTML = orders.map((order) => {
    const ticketUrl = `/tickets/${order.id}?token=${order.token}`;
    const statusUrl = `/suivi.html?id=${order.id}&token=${order.token}`;
    const action = order.status === "paid"
      ? `<a class="primary" href="${ticketUrl}" download="ticket-${order.ticketCode}.pdf">Telecharger le PDF</a>`
      : order.status === "pending"
        ? `<a class="secondary" href="${order.waveUrl}" target="_blank" rel="noopener">Payer maintenant</a>`
        : `<span class="history-muted">Contactez l'infoline</span>`;
    const emailLine = order.status === "paid"
      ? `<span>${order.emailStatus === "sent" ? "Ticket envoye par email" : "PDF disponible dans votre historique"}</span>`
      : `<span>Le PDF sera disponible apres confirmation admin</span>`;

    return `
      <article class="history-item">
        <div>
          <strong>${order.ticketCode}</strong>
          <span>${order.packName} - ${order.price.toLocaleString("fr-FR")} F</span>
          ${emailLine}
        </div>
        <mark class="${order.status}">${statusLabel(order.status)}</mark>
        <div class="history-actions">
          ${action}
          <a class="link-button" href="${statusUrl}">Voir le suivi</a>
        </div>
      </article>
    `;
  }).join("");
}

async function loadHistory() {
  if (!currentUser) return;
  historyList.innerHTML = `<article class="history-empty">Chargement...</article>`;
  try {
    const response = await fetch("/api/my-orders");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Impossible de charger l'historique.");
    renderHistory(data.orders);
  } catch (error) {
    historyList.innerHTML = `<article class="history-empty error">${error.message}</article>`;
  }
}

async function postForm(url, formElement) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(new FormData(formElement))
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Une erreur est survenue.");
  return data;
}

document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    const mode = tab.dataset.authTab;
    document.querySelectorAll("[data-auth-tab]").forEach((item) => item.classList.toggle("active", item === tab));
    registerForm.hidden = mode !== "register";
    loginForm.hidden = mode !== "login";
    setMessage("");
  });
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = registerForm.querySelector("button");
  button.disabled = true;
  button.textContent = "Creation...";
  try {
    const data = await postForm("/api/register", registerForm);
    renderUser(data.user);
    setMessage("");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Creer mon compte";
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button");
  button.disabled = true;
  button.textContent = "Connexion...";
  try {
    const data = await postForm("/api/login", loginForm);
    renderUser(data.user);
    setMessage("");
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Me connecter";
  }
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  renderUser(null);
  paymentBox.hidden = true;
});

refreshHistoryButton.addEventListener("click", loadHistory);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) {
    paymentBox.hidden = false;
    paymentBox.innerHTML = `<p class="error">Creez un compte ou connectez-vous avant de commander.</p>`;
    return;
  }
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Creation...";
  paymentBox.hidden = true;

  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(new FormData(form))
  });

  const data = await response.json();
  button.disabled = false;
  button.textContent = "Creer ma commande";

  if (!response.ok) {
    paymentBox.hidden = false;
    paymentBox.innerHTML = `<p class="error">${data.error || "Impossible de creer la commande."}</p>`;
    return;
  }

  const statusUrl = `${location.origin}/suivi.html?id=${data.id}&token=${data.token}`;
  paymentBox.hidden = false;
  paymentBox.innerHTML = `
    <div class="ticket-code">${data.ticketCode}</div>
    <p>Commande creee pour <strong>${data.packName}</strong>. Garde ce numero, puis paie avec Wave.</p>
    <a class="primary full" href="${data.waveUrl}" target="_blank" rel="noopener">Payer maintenant</a>
    <a class="secondary full" href="${statusUrl}">Voir le statut de mon ticket</a>
  `;
  loadHistory();
});

fetch("/api/me")
  .then((response) => response.json())
  .then((data) => renderUser(data.user))
  .catch(() => renderUser(null));
