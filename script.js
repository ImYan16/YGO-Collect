let userCurrency = "PHP";
 let localCardDatabase = [];
 let localCardDatabaseReady = false;
 let localCardDatabasePromise = null;
 let banlists = {
  TCG: {},
  AE: {},
  OCG: {}
 };
 let activeBanlist = "AE";
 let banlistsLoaded = false;


 const LOCAL_CARD_FILES = [
  "./data/tcg.json",
  "./data/ae.json",
  "./data/ocg.json"
];

async function loadLocalCardDatabase() {
  if (localCardDatabasePromise) return localCardDatabasePromise;

  localCardDatabasePromise = Promise.all(
    LOCAL_CARD_FILES.map(async file => {
      const response = await fetch(file);
      if (!response.ok) throw new Error(`${file} HTTP ${response.status}`);
      return response.json();
    })
  ).then(([tcg, ae, ocg]) => {
  const tcgCards = Array.isArray(tcg.data) ? tcg.data : [];
  const aeCards = Array.isArray(ae.data) ? ae.data : [];
  const ocgCards = Array.isArray(ocg.data) ? ocg.data : [];

  const cardNameKey = value => String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`´]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  const byCardName = sourceCards => {
    const result = new Map();

    sourceCards.forEach(card => {
      const name = cardNameKey(card.card_name || card.name);
      if (!name) return;
      if (!result.has(name)) result.set(name, []);
      result.get(name).push(card);
    });

    return result;
  };

  const aeByName = byCardName(aeCards);
  const ocgByName = byCardName(ocgCards);

  localCardDatabase = tcgCards
    .filter(card => card?.id && card?.name)
    .map(card => {
      const tcgSets = Array.isArray(card.card_sets)
        ? card.card_sets
        : [];

      const cardName = cardNameKey(card.name);
      const asianEnglishPrintings = aeByName.get(cardName) || [];
      const ocgPrintings = ocgByName.get(cardName) || [];

      return {
        ...card,

        image:
          card.card_images?.[0]?.image_url_small ||
          card.card_images?.[0]?.image_url ||
          "",

        cardText: card.desc || "",
        cardCode: getPrimaryCardCode(card),

        asian_english_sets: mergePrintings(
          card.asian_english_sets,
          asianEnglishPrintings
        ),
        ocg_sets: mergePrintings(card.ocg_sets, ocgPrintings),
        asian_english_printings: asianEnglishPrintings,
        ocg_printings: ocgPrintings
      };
    });

  cardDatabase = localCardDatabase;
  localCardDatabaseReady = true;

  console.log("Loaded:", {
    tcg: tcgCards.length,
    ae: aeCards.length,
    ocg: ocgCards.length,
    merged: localCardDatabase.length,
    cardsWithAe: localCardDatabase.filter(card => card.asian_english_sets.length).length,
    cardsWithOcg: localCardDatabase.filter(card => card.ocg_sets.length).length
  });

  return localCardDatabase;
}).catch(error => {
  console.error("Error loading local card database:", error);
  localCardDatabaseReady = false;
  throw error;
});
  return localCardDatabase;
}

function mergePrintings(existing, additions) {
  const merged = [
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(additions) ? additions : [])
  ];
  const seen = new Set();

  return merged.filter(printing => {
    const key = [
      printing.set_name || "",
      printing.card_code || printing.set_code || "",
      ...(Array.isArray(printing.rarity) ? printing.rarity : [printing.rarity || ""])
    ].join("|").toLowerCase();

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getPrimaryCardCode(card) {
  return (
    card.asian_english_sets?.[0]?.card_code ||
    card.ocg_sets?.[0]?.card_code ||
    card.card_sets?.[0]?.set_code ||
    ""
  );
}

function getSetCode(code) {
  return String(code || "").trim().toUpperCase().split("-")[0];
}

function getPrintingRegion(code) {
  const value = String(code || "").toUpperCase();

  if (/-AE\d+$/.test(value)) return "AE";
  if (/-OCG\d+$/.test(value)) return "OCG";
  return "TCG";
}

function getCardPrintings(card) {
  const printings = [];

  (card.card_sets || []).forEach(set => {
    if (!set.set_code) return;

    printings.push({
      region: "TCG",
      set: getSetCode(set.set_code),
      setName: set.set_name || "",
      code: set.set_code,
      rarity: set.set_rarity || "",
      rarityCode: set.set_rarity_code || ""
    });
  });

  (card.asian_english_sets || []).forEach(set => {
    const code = set.card_code || set.set_code;
    if (!code) return;

    const rarities = Array.isArray(set.rarity)
      ? (set.rarity.length ? set.rarity : [""])
      : [set.rarity || ""];

    rarities.forEach(rarity => {
      printings.push({
        region: "AE",
        set: getSetCode(code),
        setName: set.set_name || "",
        code,
        rarity,
        rarityCode: ""
      });
    });
  });

  (card.ocg_sets || []).forEach(set => {
    const code = set.card_code || set.set_code;
    if (!code) return;

    const rarities = Array.isArray(set.rarity)
      ? (set.rarity.length ? set.rarity : [""])
      : [set.rarity || ""];

    rarities.forEach(rarity => {
      printings.push({
        region: "OCG",
        set: getSetCode(code),
        setName: set.set_name || "",
        code,
        rarity,
        rarityCode: ""
      });
    });
  });

  return printings;
}

function getCardSets(card) {
  return [...new Set(getCardPrintings(card).map(printing => printing.set))];
}

function getSetRarities(card, setCode) {
  return [...new Set(
    getCardPrintings(card)
      .filter(printing => printing.set === setCode)
      .map(printing => printing.rarity)
      .filter(Boolean)
  )];
}


async function detectUserCurrency() {
    const currencyMap = {
        PH: "PHP",
        US: "USD",
        CA: "CAD",
        GB: "GBP",
        SG: "SGD",
        AU: "AUD",
        JP: "JPY",
        KR: "KRW",
        CN: "CNY",
        HK: "HKD",
        TW: "TWD",
        MY: "MYR",
        ID: "IDR",
        TH: "THB",
        VN: "VND",
        IN: "INR",
        NZ: "NZD",
        DE: "EUR",
        FR: "EUR",
        IT: "EUR",
        ES: "EUR",
        NL: "EUR"
    };

    try {
        const response = await fetch("https://ipwho.is/");

        if (!response.ok) {
            throw new Error(`Location service returned HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || "Unable to detect location");
        }

        userCurrency = currencyMap[data.country_code] || "PHP";

    } catch (error) {
        console.error("Unable to detect country:", error);

        // Philippines is the fallback
        userCurrency = "PHP";
    }

    updateCurrencyDisplay();
}


function formatPrice(price) {
    return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: userCurrency
    }).format(Number(price) || 0);
}


function getCurrencySymbol() {
    return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: userCurrency
    })
    .formatToParts(0)
    .find(part => part.type === "currency")?.value || userCurrency;
}


function updateCurrencyDisplay() {
  document.querySelectorAll(".currency-symbol").forEach(element => {
    element.textContent = getCurrencySymbol();
  });

  if (typeof renderCards === "function") renderCards();
}


/*
async function testCardsJson() {
    console.log("TESTING cards.json");

    try {
        const response = await fetch("./cards.json");

     console.log("HTTP status:", response.status);
        console.log("Response OK:", response.ok);
        console.log("URL used:", response.url); 

        const text = await response.text();
        
        console.log(
            "Response length:",
            text.length
        );

        console.log(
            "First 200 characters:",
            text.substring(0, 200)
        );
        
    } catch (error) {
        console.error(
            "cards.json TEST FAILED:",
            error
        );
    }
}

testCardsJson();
*/

const TCG_FEEDS = [
  {
    url: "https://tcg-corner.com/collections/yu-gi-oh-single-card-asia-english/products.json?limit=250",
    language: "Asian English"
  },
  {
    url: "https://tcg-corner.com/collections/yu-gi-oh-single-card-japanese/products.json?limit=250",
    language: "Japanese"
  }
];
const TCG_GLOBAL_FEED = "https://tcg-corner.com/products.json";

const TCGC_RAR = {
  C: "C",
  N: "C", 
  NR: "C",
  "Normal Parallel Rare":"NPR", 
  "Common": "C", 
  R: "R",
  "Rare":"R",
  SR: "SR", 
  "Super Rare":"SR",
  UR: "UR", 
  "Ultra Rare": "UR", 
  UL: "UtR", 
  "Ultimate Rare": "UtR", 
  ULT: "UtR",
  SER: "ScR", 
  SE: "ScR", 
  "Secret Rare":"ScR", 
  PSER: "PScR", 
  PSE: "PScR",
  "Prismatic Secret Rare": "PScR",
  EXSER: "ExSR", 
  ESER: "ExSR", 
  ESE: "ExSR", 
  "Extra Secret Rare": "ExSR",
  QCSR: "QCSR", 
  QSCR: "QCSR", 
  QCSER: "QCSR", 
  QCSE: "QCSR", 
  QC: "QCSR", 
  "Quarter Century Secret Rare": "QCSR",
  CR: "CR", 
  "Collector's Rare":"CR", 
  COR: "CR", 
  HR: "HGR", HGR: "HGR"
};

let cards = [];
let tcgLoading = false;
let tcgError = "";
let cardRenderTimer;
let purchaseSearchTimer;
const purchaseSearchCache = new Map();
const MAX_CARD_RESULTS = 48;

let purchases = JSON.parse(localStorage.getItem("ygoPurchases") || "[]");
let cardDatabase = [];
let decks = JSON.parse(localStorage.getItem("ygoDecks") || "[]");
let deckCards = JSON.parse(localStorage.getItem("ygoDeckCards") || "{}");
let deckCardOrder = JSON.parse(localStorage.getItem("ygoDeckCardOrder") || "{}");
let activeDeck = "";
let selectedDeckCardId = "";
let deckCardSearchTerm = "";
let deckApiCards = [];
let deckApiLoading = false;
let deckApiError = "";
let deckSearchTimer;
const deckSearchCache = new Map();


function money(n) {
  return formatPrice(n);
}
function saveData() {
  localStorage.setItem("ygoPurchases", JSON.stringify(purchases));
  localStorage.setItem("ygoDecks", JSON.stringify(decks));
  localStorage.setItem("ygoDeckCards", JSON.stringify(deckCards));
  localStorage.setItem("ygoDeckCardOrder", JSON.stringify(deckCardOrder));
}
function showPage(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(page).classList.add("active");
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  if(page === "dashboard") renderDashboard();
  if(page === "collection") renderCollection();
  if(page === "spending") renderSpending();
  if(page === "cards") {
    if (!cards.length && !tcgLoading) loadTCGProducts();
    renderCards();
  }
  if(page === "decks") renderDecks();
}
document.querySelectorAll("nav button").forEach(b => b.onclick = () => showPage(b.dataset.page));

function populatePurchaseDestinations() {
  const select = document.getElementById("purchaseDestination");
  const current = select.value;
  select.innerHTML = [
    "<option>Binder Collection</option>",
    ...decks.map(deck => `<option>Deck: ${escapeHtml(deck)}</option>`)
  ].join("");
  if ([...select.options].some(option => option.value === current)) select.value = current;
}

function addDeck() {
  document.getElementById("deckNameInput").value = "";
  document.getElementById("deckModal").classList.add("open");
  setTimeout(() => document.getElementById("deckNameInput").focus(), 0);
}

function closeDeckModal() {
  document.getElementById("deckModal").classList.remove("open");
}

function saveDeck() {
  const input = document.getElementById("deckNameInput");
  const deckName = input.value.trim();
  if (!deckName) {
    input.focus();
    return;
  }
  if (decks.some(deck => deck.toLowerCase() === deckName.toLowerCase())) return;
  decks.push(deckName);
  saveData();
  populatePurchaseDestinations();
  closeDeckModal();
  renderDecks();
  openDeckProfile(deckName);
}

document.getElementById("deckNameInput").addEventListener("keydown", event => {
  if (event.key === "Enter") saveDeck();
  if (event.key === "Escape") closeDeckModal();
});

function renderDecks() {
  const list = document.getElementById("deckList");
  const profile = document.getElementById("deckProfile");
  const owned = {};
  purchases.forEach(purchase => {
    owned[purchase.cardId] = (owned[purchase.cardId] || 0) + purchase.qty;
  });
  let deckValue = 0;
  let missingCards = 0;
  let estimatedCost = 0;
  Object.values(deckCards).flat().forEach(entry => {
    const card =
      cards.find(item => String(item.id) === String(entry.cardId)) ||
      localCardDatabase.find(item => String(item.id) === String(entry.cardId)) ||
      entry;
    const price = Number(entry.tcgCornerPrice ?? entry.price ?? 0);
    const missing = Math.max(0, entry.qty - (owned[entry.cardId] || 0));
    deckValue += entry.qty * price;
    missingCards += missing;
    estimatedCost += missing * price;
  });
  document.getElementById("deckCount").textContent = decks.length;
  document.getElementById("deckMissing").textContent = missingCards;
  document.getElementById("deckValue").textContent = money(deckValue);
  document.getElementById("deckEstimatedCost").textContent = money(estimatedCost);
  document.getElementById("closeCardDetails").onclick = () => {
  document.getElementById("cardDetailsPanel").hidden = true;};
  if (!decks.length) {
    list.className = "section card empty";
    list.textContent = "No decks yet. The deck builder will use the same card and collection database.";
    profile.style.display = "none";
   
  }
  

  list.className = "section card";

  list.innerHTML = decks.map(deck => `
    <div class="section-head">
        <div>
            <button type="button" class="deck-name-button">
                ${escapeHtml(deck)}
            </button>

            <button
                type="button"
                class="deck-edit-button"
                title="Rename deck">
                ✎
            </button>

            <button
                type="button"
                class="deck-delete-button"
                title="Delete deck">
                🗑
            </button>
        </div>

        <span class="pill">Deck</span>
    </div>
  `).join("");

  const deckRows = list.querySelectorAll(".section-head");

  deckRows.forEach((row, index) => {
    const deckNameButton = row.querySelector(".deck-name-button");
    const renameButton = row.querySelector(".deck-edit-button");
    const deleteButton = row.querySelector(".deck-delete-button");

    const deckName = decks[index];

    deckNameButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      if (activeDeck === deckName) {
        activeDeck = null;
        renderDecks();
        return;
    }

    toggleDeckProfile(deckName);
});

    renameButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();

        renameDeck(deckName);
    });

    deleteButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();

        deleteDeck(deckName);
    });
  });

  if (activeDeck && decks.includes(activeDeck)) {
    renderDeckProfile();
  }

  list.querySelectorAll(".deck-edit-button").forEach((button, index) => {
    button.onclick = () => {
        renameDeck(decks[index]);
    };
  });

  function deleteDeck(deckName) {
    const existing = document.getElementById("deleteDeckModal");

    if (existing) {
        existing.remove();
    }

    const modal = document.createElement("div");
    modal.id = "deleteDeckModal";
    modal.className = "delete-deck";

    modal.innerHTML = `
        <div class="delete-deck-overlay"></div>

        <div class="delete-deck-dialog">
            <h3>Delete Deck?</h3>

            <p>
                Are you sure you want to delete
                <strong>${escapeHtml(deckName)}</strong>?
            </p>

            <p class="delete-deck-warning">
                All cards in this deck will be removed.
            </p>

            <div class="delete-deck-actions">
                <button type="button" id="deleteDeckCancel">
                    Cancel
                </button>

                <button
                    type="button"
                    id="deleteDeckConfirm"
                    class="btn danger">
                    Delete
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);

    const cancelButton =
        document.getElementById("deleteDeckCancel");

    const confirmButton =
        document.getElementById("deleteDeckConfirm");

  function closeModal() {
        modal.remove();
    }

    cancelButton.addEventListener("click", closeModal);

    confirmButton.addEventListener("click", () => {

        const deckIndex = decks.indexOf(deckName);

        if (deckIndex < 0) {
            closeModal();
            return;
        }

        // Remove
        decks.splice(deckIndex, 1);

        // Remove cards
        delete deckCards[deckName];

        // Remove purchases assigned to this deck
        for (let i = purchases.length - 1; i >= 0; i--) {
            if (purchases[i].destination === `Deck: ${deckName}`) {
                purchases.splice(i, 1);
            }
        }

        // Clear active deck if it was deleted
        if (activeDeck === deckName) {
            activeDeck = null;
        }

        saveData();
        populatePurchaseDestinations();

        closeModal();

        renderDecks();
    });
  }
}
  
function toggleDeckProfile(deckName) {
    if (activeDeck === deckName) {
        activeDeck = null
    } else {
        activeDeck = deckName;
    }

    renderDecks();
}

function renameDeck(oldName) {
    const existing = document.getElementById("renameDeckModal");

    if (existing) {
        existing.remove();
    }

    const modal = document.createElement("div");
    modal.id = "renameDeckModal";
    modal.className = "rename-deck-modal";

    modal.innerHTML = `
        <div class="rename-deck-overlay"></div>

        <div class="rename-deck-dialog">
            <h3>Rename Deck</h3>

            <input
                id="renameDeckInput"
                type="text"
                value="${escapeHtml(oldName)}"
                maxlength="100"
                autocomplete="off"
            >

            <div class="rename-deck-actions">
                <button type="button" id="renameDeckCancel">
                    Cancel
                </button>

                <button type="button" id="renameDeckConfirm" class="btn primary">
                    Rename
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const input = document.getElementById("renameDeckInput");
    const confirmButton = document.getElementById("renameDeckConfirm");
    const cancelButton = document.getElementById("renameDeckCancel");

    input.focus();
    input.select();

    function closeModal() {
        modal.remove();
    }

    function confirmRename() {
        const trimmedName = input.value.trim();

        if (!trimmedName) {
            input.focus();
            return;
        }

        if (trimmedName === oldName) {
            closeModal();
            return;
        }

        if (
            decks.some(
                deck =>
                    deck.toLowerCase() === trimmedName.toLowerCase()
            )
        ) {
            input.focus();
            input.select();
            return;
        }

        const deckIndex = decks.indexOf(oldName);

        if (deckIndex < 0) {
            closeModal();
            return;
        }

        decks[deckIndex] = trimmedName;

        if (deckCards[oldName]) {
            deckCards[trimmedName] = deckCards[oldName];
            delete deckCards[oldName];
        }

        purchases.forEach(purchase => {
            if (purchase.destination === `Deck: ${oldName}`) {
                purchase.destination = `Deck: ${trimmedName}`;
            }
        });

        if (activeDeck === oldName) {
            activeDeck = trimmedName;
        }

        saveData();
        populatePurchaseDestinations();
        closeModal();
        renderDecks();
    }

    confirmButton.addEventListener("click", confirmRename);

    cancelButton.addEventListener("click", closeModal);

    input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            confirmRename();
        }

        if (event.key === "Escape") {
            event.preventDefault();
            closeModal();
        }
    });
}

function openDeckProfile(deckName) {
  activeDeck = deckName;
  renderDeckProfile();
}

function renderDeckProfile() {
  const profile = document.getElementById("deckProfile");
  if (!activeDeck || !decks.includes(activeDeck)) {
    profile.style.display = "none";
    return;
  }

  const entries = deckCards[activeDeck] || [];
  const copies = getDeckCardCopies(activeDeck);
  profile.style.display = "block";
  profile.innerHTML = `
    <div class="section-head"><h2>${escapeHtml(activeDeck)}</h2><span class="pill">${entries.reduce((sum, entry) => sum + entry.qty, 0)} cards</span></div>
    <div class="deck-builder-layout">
      <div class="deck-list-grid" id="deckCardDropZone">${copies.map(({ entry, copyId }) => {
          const card = cards.find(item => String(item.id) === String(entry.cardId)) || entry;
          const name = card?.name || entry.card || "Unknown card";
          const rarity = entry.rarity || "";
          const image = card?.image ? `<img src="${escapeHtml(card.image)}" alt="${escapeHtml(name)}">` : `<div class="card-image">No image</div>`;
          const copyNumber = entry.copyIds.indexOf(copyId) + 1;
          
          return `<div class="deck-list-card" data-deck-copy-id="${escapeHtml(copyId)}" draggable="true">
            ${image}
            <span class="deck-list-quantity">${copyNumber}/${entry.qty}</span>
            <button class="deck-list-remove" title="Remove one copy" onclick="removeCardFromDeck('${escapeHtml(copyId)}')">×</button>
            <div class="deck-list-tooltip">
              <strong>${escapeHtml(name)}</strong>
              <small>${escapeHtml(card?.cardCode || "")} · ${escapeHtml(rarity)} · ${money(entry.tcgCornerPrice ?? entry.price ?? 0)}</small>
              <div class="deck-list-tooltip-label">Card text</div>
              <p>${escapeHtml(card?.cardText || entry.cardText || "Card text unavailable.")}</p>
            </div>
          </div>`;
        }).join("") || `<div class="empty" style="grid-column:1/-1;">No cards in this deck yet.</div>`}</div>
      <div class="deck-picker-panel">
        <div class="searchbar">
          <input id="deckCardSearch" oninput="queueDeckCardSearch()" value="${escapeHtml(deckCardSearchTerm)}" placeholder="Searching the card database...">
          <input id="deckCardQty" type="number" min="1" value="1" style="max-width:100px;">
          <button class="btn primary" onclick="addCardToDeck()">Add Card</button>
        </div>
        <div class="notice">Type at least 2 characters to find official card data.</div>
        <div class="deck-card-picker" id="deckCardPicker"></div>
      </div>
    </div>`;
  setupDeckCardReordering();
  renderDeckCardPicker();
}

function queueDeckCardSearch() {
  deckCardSearchTerm = document.getElementById("deckCardSearch").value;
  clearTimeout(deckSearchTimer);
  deckSearchTimer = setTimeout(loadDeckApiCards, 300);
  renderDeckCardPicker();
}

function normaliseYgoProCard(card) {
    return {
        id: `ygopro-${card.id}`,
        ygoProId: card.id,
        name: card.name,

        cardCode:
            card.asian_english_sets?.[0]?.card_code ||
            card.card_sets?.[0]?.set_code ||
            String(card.id),

        rarity: card.type || "Card",

        cardText: card.desc || "",

        // Small image for lists and card pickers
        image:
            card.card_images?.[0]?.image_url_small ||
            card.card_images?.[0]?.image_url ||
            "",

        // Full image for large previews
        imageFull:
            card.card_images?.[0]?.image_url ||
            "",

        price: 0,

        tags: [
            card.race,
            card.attribute,
            card.archetype,
            card.type
        ]
        .filter(Boolean)
        .join(" "),

        card_sets: Array.isArray(card.card_sets)
            ? card.card_sets
            : [],

        asian_english_sets: Array.isArray(card.asian_english_sets)
            ? card.asian_english_sets
            : [],

        ocg_sets: Array.isArray(card.ocg_sets)
          ? card.ocg_sets
          : [],

        card_images: Array.isArray(card.card_images)
            ? card.card_images
            : [],

        atk: card.atk,
        def: card.def,
        level: card.level,
        attribute: card.attribute,
        type: card.type,
        desc: card.desc
    };
}

async function loadDeckApiCards() {
  const query = deckCardSearchTerm.trim().toLowerCase();

  if (query.length < 2) {
    deckApiCards = [];
    deckApiError = "";
    renderDeckCardPicker();
    return;
  }

  const cacheKey = query;

  if (deckSearchCache.has(cacheKey)) {
    deckApiCards = deckSearchCache.get(cacheKey);
    deckApiError = "";

    selectedDeckCardId =
      deckApiCards.some(card => card.id === selectedDeckCardId)
        ? selectedDeckCardId
        : (deckApiCards[0]?.id || "");

    renderDeckCardPicker();
    return;
  }

  deckApiLoading = true;
  deckApiError = "";
  renderDeckCardPicker();

  try {

  if (!Array.isArray(cardDatabase) || cardDatabase.length === 0) {

    await loadLocalCardDatabase();
    cardDatabase = localCardDatabase;

    if (!response.ok) {
      throw new Error(
        `Card database returned HTTP ${response.status}.`
      );
    }

    const data = await response.json();

    cardDatabase = Array.isArray(data.data)
      ? data.data.map(card => ({
          ...card,
          image: card.card_images?.[0]?.image_url || "",
          cardText: card.desc || "",
          cardCode: card.asian_english_sets?.[0]?.card_code || ""
        }))
      : [];

    //console.log(
    //  "Loaded cards.json:",
    //  cardDatabase.length,
    //  "cards"
    //);
    }

    deckApiCards = cardDatabase
        .filter(card =>
        String(card.name || "")
            .toLowerCase()
            .includes(query)
        )
        .map(normaliseYgoProCard);

    deckSearchCache.set(cacheKey, deckApiCards);

    selectedDeckCardId =
        deckApiCards.some(card => card.id === selectedDeckCardId)
        ? selectedDeckCardId
        : (deckApiCards[0]?.id || "");

    } catch (error) {

    console.error("Card database error:", error);

    deckApiCards = [];
    deckApiError =
        error.message || "Unable to load the local card database.";

    } finally {

    deckApiLoading = false;
    renderDeckCardPicker();

    }
}

function renderDeckCardPicker() {
  const picker = document.getElementById("deckCardPicker");
  if (!picker) return;

  const query = deckCardSearchTerm.trim();

  if (query.length < 2) {
    picker.innerHTML =
      `<div class="empty" style="grid-column:1/-1;">Enter at least 2 characters to search the card database.</div>`;
    return;
  }

  if (deckApiLoading) {
    picker.innerHTML =
      `<div class="empty" style="grid-column:1/-1;">Searching the card database...</div>`;
    return;
  }

  if (deckApiError) {
    picker.innerHTML =
      `<div class="empty" style="grid-column:1/-1;">${escapeHtml(deckApiError)}</div>`;
    return;
  }

  picker.innerHTML = deckApiCards.slice(0, 60).map(card => `
    <div
      class="deck-card-option ${String(card.id) === String(selectedDeckCardId) ? "selected" : ""}"
      data-card-id="${escapeHtml(card.id)}"
      draggable="true"
    >
      ${
        card.image
          ? `<img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}">`
          : `<div class="card-image">No image</div>`
      }
      <strong>${escapeHtml(card.name)}</strong>
      <small>${escapeHtml(card.rarity || "")} · ${escapeHtml(card.cardCode || "")}</small>
    </div>
  `).join("");

  if (!picker.innerHTML) {
    picker.innerHTML =
      `<div class="empty" style="grid-column:1/-1;">No cards match this search.</div>`;
    return;
  }

  const tiles = picker.querySelectorAll(".deck-card-option");

  tiles.forEach(function(tile) {

    tile.addEventListener("click", function(event) {
      event.preventDefault();
      event.stopPropagation();

      const cardId = tile.dataset.cardId;

      //console.log("Card clicked:", cardId);

      const normalizedCard = deckApiCards.find(
        function(card) {
          return String(card.id) === String(cardId);
        }
      );

      if (!normalizedCard) {
        console.error("Card not found in deckApiCards:", cardId);
        return;
      }

      //console.log("Normalized card:", normalizedCard);

      const localId =
        normalizedCard.ygoProId ||
        String(normalizedCard.id).replace("ygopro-", "");

      const localCard = cardDatabase.find(
        function(card) {
          return String(card.id) === String(localId);
        }
      );

      if (!localCard) {
        console.error("Card not found in cards.json:", localId);
        //console.log("cardDatabase:", cardDatabase);
        return;
      }

      //console.log("Local card:", localCard);

      selectDeckCard(cardId);
      showCardDetails(localCard);
    });

    tile.addEventListener("dragstart", function(event) {
      selectDeckCard(tile.dataset.cardId);

      event.dataTransfer.effectAllowed = "copy";

      event.dataTransfer.setData(
        "text/plain",
        tile.dataset.cardId
      );
    });

  });

  setupDeckDropZone();
}



async function showCardDetails(card) {
  const panel = document.getElementById("cardDetailsPanel");
  if (!panel || !card) return;

  await loadLocalCardDatabase();

  const printings = getCardPrintings(card);

  const setElement = document.getElementById("detailCardSet");
  const setSelect = document.getElementById("detailCardSetSelect");
  const raritySelect = document.getElementById("detailCardRaritySelect");

  // Show every TCG, AE, and OCG printing.
  if (setElement) {
    setElement.innerHTML = printings.length
      ? printings.map(printing => `
          <div class="card-set-row">
            <strong>${escapeHtml(printing.set)}</strong>
            <span>${escapeHtml(printing.setName || "Unknown set")}</span>
            <span class="pill">${escapeHtml(printing.region)}</span>
            <span>${escapeHtml(printing.code)}</span>
            <span>${escapeHtml(printing.rarity || "Unknown rarity")}</span>
          </div>
        `).join("")
      : "No set information available.";
  }

  // One option per set and region.
  const setOptions = [
    ...new Map(
      printings.map(printing => [
        `${printing.region}|${printing.set}`,
        printing
      ])
    ).values()
  ];

  if (setSelect) {
    setSelect.innerHTML = setOptions.map(printing => `
            <option value="${escapeHtml(`${printing.region}|${printing.set}`)}"
              data-set="${escapeHtml(printing.set)}"
              data-region="${escapeHtml(printing.region)}">
        ${escapeHtml(printing.set)}
        — ${escapeHtml(printing.region)}
        ${printing.setName ? `— ${escapeHtml(printing.setName)}` : ""}
      </option>
    `).join("");
    const preferredOption = [...setSelect.options].find(option =>
      option.dataset.region === "AE" || option.dataset.region === "OCG"
    );
    if (preferredOption) setSelect.value = preferredOption.value;
  }

  function updateRarityOptions() {
    const selectedOption = setSelect?.selectedOptions?.[0];
    const selectedSet = selectedOption?.dataset.set || "";
    const selectedRegion = selectedOption?.dataset.region || "TCG";

    const matchingPrintings = printings.filter(printing =>
      printing.set === selectedSet &&
      printing.region === selectedRegion
    );

    const rarities = [...new Set(
      matchingPrintings.map(printing => printing.rarity || "")
    )];

    if (raritySelect) {
      raritySelect.innerHTML = rarities.length
        ? rarities.map(rarity => `
            <option value="${escapeHtml(rarity)}"
                    data-tcg-rarity="${escapeHtml(
                      TCGC_RAR[rarity] || rarity
                    )}">
              ${escapeHtml(getTcgCornerRarity(rarity) || "Unknown rarity")}
            </option>`
        ).join("")
        : `<option value="">No rarity available</option>`;
    }
  }

  setSelect?.addEventListener("change", updateRarityOptions);
  updateRarityOptions();

  document.getElementById("detailCardName").textContent =
    card.name || "N/A";

  document.getElementById("detailCardType").textContent =
    card.type || "N/A";

  document.getElementById("detailCardAtk").textContent =
    card.atk ?? "N/A";

  document.getElementById("detailCardDef").textContent =
    card.def ?? "N/A";

  document.getElementById("detailCardLevel").textContent =
    card.level ?? "N/A";

  document.getElementById("detailCardAttribute").textContent =
    card.attribute || "N/A";

  document.getElementById("detailCardRarity").textContent =
    [...new Set(printings.map(item => item.rarity).filter(Boolean))]
      .join(", ") || "N/A";

  document.getElementById("detailCardDescription").textContent =
    card.desc || card.cardText || "N/A";

  const image = document.getElementById("detailCardImage");
  const imageUrl =
    card.card_images?.[0]?.image_url || card.image || "";

  if (imageUrl) {
    image.src = imageUrl;
    image.alt = card.name || "";
  } else {
    image.removeAttribute("src");
    image.alt = "No image";
  }

  const addButton = document.getElementById("addDetailCardToDeck");

  if (addButton) {
    addButton.onclick = event => {
      event.preventDefault();

      if (!activeDeck) {
        alert("Select or create a deck first.");
        return;
      }

      const selectedOption = setSelect?.selectedOptions?.[0];
      const selectedSet = selectedOption?.dataset.set || "";
      const selectedRegion = selectedOption?.dataset.region || "TCG";
      const selectedRarity = raritySelect?.value || "";

      const quantity = Math.min(
        3,
        Math.max(
          1,
          Number(document.getElementById("detailCardQuantity")?.value) || 1
        )
      );

      const printing = printings.find(item =>
        item.set === selectedSet &&
        item.region === selectedRegion &&
        item.rarity === selectedRarity
      );

      if (!printing) {
        alert("Select a valid set and rarity.");
        return;
      }

      const added = addCardEntryToDeck(
        activeDeck,
        card,
        quantity,
        selectedRarity,
        getTcgCornerRarity(selectedRarity),
        selectedSet,
        selectedRegion
      );

      if (added === true) {
        saveData();
        panel.hidden = true;
        renderDecks();
      }
    };
  }

  panel.hidden = false;
}


function selectDeckCard(cardId) {
  selectedDeckCardId = cardId;
  document.querySelectorAll(".deck-card-option").forEach(tile => {
    tile.classList.toggle("selected", tile.dataset.cardId === cardId);
  });
}

function setupDeckDropZone() {
    const deckList = document.getElementById("deckList");

    if (!deckList) return;

    deckList.ondragover = function(event) {
        event.preventDefault();

        const draggingCard = deckList.querySelector(".dragging");

        if (!draggingCard) return;

        const afterElement = getDragAfterElement(
            deckList,
            event.clientY
        );

        if (afterElement == null) {
            deckList.appendChild(draggingCard);
        } else {
            deckList.insertBefore(draggingCard, afterElement);
        }
    };

    deckList.ondrop = function(event) {
        event.preventDefault();

        const draggingCard = deckList.querySelector(".dragging");

        if (!draggingCard) return;

        const afterElement = getDragAfterElement(
            deckList,
            event.clientY
        );

        if (afterElement == null) {
            deckList.appendChild(draggingCard);
        } else {
            deckList.insertBefore(draggingCard, afterElement);
        }

        saveDeckOrder();
    };
}

function getDragAfterElement(container, y) {
    const draggableElements = [
        ...container.querySelectorAll(
            ".deck-card:not(.dragging)"
        )
    ];

    return draggableElements.reduce(
        (closest, child) => {

            const box = child.getBoundingClientRect();

            const offset =
                y - box.top - box.height / 2;

            if (offset < 0 && offset > closest.offset) {
                return {
                    offset: offset,
                    element: child
                };
            }

            return closest;

        },
        {
            offset: Number.NEGATIVE_INFINITY,
            element: null
        }
    ).element;
}


function setupDeckCardReordering() {
  let draggedDeckCopyId = null;

  const cardsInDeck = document.querySelectorAll(
    ".deck-list-card[data-deck-copy-id]"
  );

  cardsInDeck.forEach(tile => {

    tile.ondragstart = event => {
      draggedDeckCopyId = tile.dataset.deckCopyId;

      event.dataTransfer.effectAllowed = "move";

      event.dataTransfer.setData(
        "application/x-ygo-deck-copy",
        draggedDeckCopyId
      );

      tile.classList.add("dragging");
    };

    tile.ondragover = event => {
      if (!draggedDeckCopyId) return;

      event.preventDefault();
      event.stopPropagation();

      event.dataTransfer.dropEffect = "move";

      document.querySelectorAll(
        ".deck-list-card[data-deck-copy-id]"
      ).forEach(card => {
        card.classList.remove("drag-over");
      });

      tile.classList.add("drag-over");
    };

    tile.ondragleave = () => {
      tile.classList.remove("drag-over");
    };

    tile.ondrop = event => {
      event.preventDefault();
      event.stopPropagation();

      tile.classList.remove("drag-over");

      if (!draggedDeckCopyId) return;

      const targetId = tile.dataset.deckCopyId;

      if (!targetId) return;

      if (String(draggedDeckCopyId) === String(targetId)) {
        draggedDeckCopyId = null;
        return;
      }

      const targetRect = tile.getBoundingClientRect();

      const dropBefore =
        event.clientY <
        targetRect.top + targetRect.height / 2;

      reorderDeckCardCopy(
        draggedDeckCopyId,
        targetId,
        dropBefore
      );

      draggedDeckCopyId = null;
    };

    tile.ondragend = () => {
      tile.classList.remove("dragging");
      tile.classList.remove("drag-over");

      document.querySelectorAll(
        ".deck-list-card[data-deck-copy-id]"
      ).forEach(card => {
        card.classList.remove("drag-over");
      });

      draggedDeckCopyId = null;
    };

  });
}

function reorderDeckCardCopy(draggedId, targetId, dropBefore) {
  if (!activeDeck) return;

  const order = deckCardOrder[activeDeck];

  if (!Array.isArray(order)) {
    console.error("No card order found for:", activeDeck);
    return;
  }

  const draggedIndex = order.findIndex(
    id => String(id) === String(draggedId)
  );

  const targetIndex = order.findIndex(
    id => String(id) === String(targetId)
  );

  if (draggedIndex === -1 || targetIndex === -1) {
    console.error("Card copy not found:", {
      draggedId,
      targetId,
      order
    });
    return;
  }

  if (draggedIndex === targetIndex) {
    return;
  }

  // Remove dragged card from its old position.
  const [draggedCopy] = order.splice(draggedIndex, 1);

  // Find target again because the array changed.
  let newTargetIndex = order.findIndex(
    id => String(id) === String(targetId)
  );

  if (newTargetIndex === -1) {
    return;
  }

  // Insert before or after the target.
  if (!dropBefore) {
    newTargetIndex++;
  }

  order.splice(newTargetIndex, 0, draggedCopy);

  // Save the changed card order.
  saveData();

  // Rebuild the deck display.
  renderDecks();
}

function addCardToDeck(
  cardId = selectedDeckCardId,
  quantity,
  asianEnglishRarity,
  tcgCornerRarity
) {
  if (!activeDeck) return false;

  const card = deckApiCards.find(
    item => String(item.id) === String(cardId)
  );

  const qty =
    quantity ??
    Number(
      document.getElementById("deckCardQty")?.value
    );

  if (!card || !Number.isFinite(qty) || qty < 1) {
    return false;
  }

  const selectedSet = "";
  const selectedRegion = "";

  const added = addCardEntryToDeck(
    activeDeck,
    card,
    qty,
    asianEnglishRarity,
    tcgCornerRarity,
    selectedSet,
    selectedRegion
  );

  if (added !== true) {
    return false;
  }

  saveData();
  renderDecks();

  return true;
}


function getCardCountInDeck(deckName, cardId) {

  const entries = deckCards[deckName] || [];

  return entries
    .filter(
      entry =>
        String(entry.cardId) === String(cardId)
    )
    .reduce(
      (total, entry) =>
        total + Number(entry.qty || 0),
      0
    );
}


function getCardLimit(cardName) {
  const requested = String(activeBanlist || "TCG")
    .trim()
    .toUpperCase();

  const aliases = {
    TCG: ["TCG", "EN", "ENGLISH"],
    AE: ["AE", "ASIAN_ENGLISH", "ASIAN ENGLISH", "ASIAN-ENGLISH"],
    OCG: ["OCG", "JP", "JAPANESE"]
  };

  const possibleKeys = aliases[requested] || [requested];

  const banlist = possibleKeys
    .map(key => banlists?.[key])
    .find(value => value && typeof value === "object");

  if (!banlist) {
    console.warn(
      "Banlist not found:",
      requested,
      "Available:",
      Object.keys(banlists || {})
    );

    return 3;
  }

  const entry = banlist[String(cardName || "").trim().toLowerCase()];

  if (entry === undefined || entry === null) return 3;

  if (typeof entry === "number") return entry;

  return Number(entry.limit ?? entry.status ?? 3);
}

function addCardEntryToDeck(
  deckName,
  card,
  qty,
  asianEnglishRarity = "",
  tcgCornerRarity = "",
  selectedSet = "",
  selectedRegion = ""
) {
  qty = Number(qty) || 1;

  const cardId = card.ygoProId || card.id;

  const localCard =
    localCardDatabase.find(item =>
      String(item.id) === String(cardId) ||
      String(item.ygoProId) === String(cardId)
    ) || localCardDatabase.find(item =>
      String(item.name || "").trim().toLowerCase() ===
      String(card.name || "").trim().toLowerCase()
    ) || card;

  const selectedRarity =
    asianEnglishRarity || tcgCornerRarity || "";

  const printings = getCardPrintings(localCard);

  if (!printings.length && card.cardCode) {
    printings.push({
      region: getPrintingRegion(card.cardCode),
      set: getSetCode(card.cardCode),
      setName: "TCG Corner purchase",
      code: card.cardCode,
      rarity: card.rarity || "",
      rarityCode: ""
    });
  }

  const purchaseRegion = selectedRegion || getPrintingRegion(card.cardCode);
  const purchaseSet = selectedSet || getSetCode(card.cardCode);
  const printing =
    printings.find(item =>
      item.region === purchaseRegion &&
      item.set === purchaseSet &&
      (!selectedRarity || item.rarity === selectedRarity)
    ) || printings.find(item =>
      (!selectedSet || item.set === selectedSet) &&
      (!selectedRegion || item.region === selectedRegion) &&
      (!selectedRarity || item.rarity === selectedRarity)
    ) || printings.find(item =>
      item.region === purchaseRegion
    ) || printings[0];

  if (!printing) {
    console.error("Printing not found", {
      card: localCard.name,
      selectedSet,
      selectedRegion,
      selectedRarity
    });
    return false;
  }

  const entries = deckCards[deckName] ||
    (deckCards[deckName] = []);

  const currentCount = getCardCountInDeck(deckName, cardId);
  const cardLimit = getCardLimit(localCard.name);

  if (cardLimit === 0) {
    showBanlistPopup(
      "Card Forbidden",
      `${localCard.name} is forbidden on the selected banlist.`
    );
    return false;
  }

  if (currentCount + qty > cardLimit) {
    const remaining = Math.max(0, cardLimit - currentCount);

    showBanlistPopup(
      "Deck Limit Exceeded",
      `${localCard.name} is limited to ${cardLimit} copy/copies.\n\n` +
      `Already in deck: ${currentCount}\n` +
      `You selected: ${qty}\n` +
      `You can add: ${remaining}`
    );

    return false;
  }

  const existing = entries.find(entry =>
    String(entry.cardId) === String(cardId) &&
    String(entry.setCode || "") === String(printing.code || "") &&
    String(entry.rarity || "") === String(printing.rarity || "")
  );

  const entry = existing || {
    cardId,
    card: localCard.name,
    set: printing.set,
    setCode: printing.code,
    region: printing.region,
    rarity: printing.rarity,
    price: getDeckCardPrice(
      localCard,
      selectedRarity,
      printing.set,
      printing.region
    ),
    tcgCornerPrice: null,
    cardText: localCard.cardText || localCard.desc || "",
    image: localCard.image ||
      localCard.card_images?.[0]?.image_url || localCard.image|| "",
    cardCode: printing.code,
    qty: 0,
    copyIds: []
  };

  if (!existing) entries.push(entry);

  ensureEntryCopyIds(entry);

  for (let index = 0; index < qty; index++) {
    const copyId = createDeckCopyId();
    entry.copyIds.push(copyId);

    if (!deckCardOrder[deckName]) {
      deckCardOrder[deckName] = [];
    }

    deckCardOrder[deckName].push(copyId);
  }

  entry.qty = entry.copyIds.length;

  return true;
}

function createDeckCopyId() {
  return `copy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function ensureEntryCopyIds(entry) {
  entry.copyIds = Array.isArray(entry.copyIds) ? entry.copyIds : [];
  while (entry.copyIds.length < entry.qty) entry.copyIds.push(createDeckCopyId());
  if (entry.copyIds.length > entry.qty) entry.copyIds.length = entry.qty;
}

function getDeckCardCopies(deckName) {
  const entries = deckCards[deckName] || [];
  const copies = entries.flatMap(entry => {
    ensureEntryCopyIds(entry);
    return entry.copyIds.map(copyId => ({ entry, copyId }));
  });
  const byId = new Map(copies.map(copy => [copy.copyId, copy]));
  const existingOrder = deckCardOrder[deckName] || [];
  const orderedIds = existingOrder.filter(copyId => byId.has(copyId));
  copies.forEach(copy => {
    if (!orderedIds.includes(copy.copyId)) orderedIds.push(copy.copyId);
  });
  deckCardOrder[deckName] = orderedIds;
  return orderedIds.map(copyId => byId.get(copyId));
}

function syncPurchasesToDecks() {
  let changed = false;
  purchases.forEach(purchase => {
    if (!purchase.destination?.startsWith("Deck: ")) return;
    const deckName = purchase.destination.slice("Deck: ".length);
    const card = cards.find(item => String(item.id) === String(purchase.cardId));
    const alreadyListed = deckCards[deckName]?.some(entry => String(entry.cardId) === String(purchase.cardId));
    if (card && decks.includes(deckName) && !alreadyListed) {
      addCardEntryToDeck(deckName, card, purchase.qty);
      changed = true;
    }
  });
  if (changed) saveData();
}

function removeCardFromDeck(copyId) {
  if (!activeDeck || !deckCards[activeDeck]) return;
  getDeckCardCopies(activeDeck);
  const entry = deckCards[activeDeck].find(item => item.copyIds.includes(copyId));
  if (!entry) return;
  entry.copyIds = entry.copyIds.filter(id => id !== copyId);
  entry.qty = entry.copyIds.length;
  deckCards[activeDeck] = deckCards[activeDeck].filter(item => item.copyIds.length > 0);
  deckCardOrder[activeDeck] = (deckCardOrder[activeDeck] || []).filter(id => id !== copyId);
  saveData();
  renderDecks();
}

function removeQuantityFromDeck(deckName, cardId, qty) {
  const entry = deckCards[deckName]?.find(item => String(item.cardId) === String(cardId));
  if (!entry) return;
  ensureEntryCopyIds(entry);
  const removedCopyIds = entry.copyIds.splice(Math.max(0, entry.copyIds.length - qty));
  entry.qty = entry.copyIds.length;
  deckCards[deckName] = deckCards[deckName].filter(item => item.copyIds.length > 0);
  deckCardOrder[deckName] = (deckCardOrder[deckName] || []).filter(id => !removedCopyIds.includes(id));
}

function deletePurchase(purchaseId) {
  const index = purchases.findIndex(purchase => String(purchase.id) === String(purchaseId));
  if (index < 0) return;
  const purchase = purchases[index];
  if (!confirm(`Delete the purchase of ${purchase.card}?`)) return;
  purchases.splice(index, 1);
  if (purchase.destination?.startsWith("Deck: ")) {
    removeQuantityFromDeck(purchase.destination.slice("Deck: ".length), purchase.cardId, purchase.qty);
  }
  saveData();
  renderDashboard();
  renderCollection();
  renderSpending();
  renderDecks();
}

function deleteCollectionGroup(cardId, printing, destination) {
  const matching = purchases.filter(purchase =>
    String(purchase.cardId) === String(cardId) &&
    purchase.printing === printing &&
    (purchase.destination || "Binder Collection") === destination
  );
  if (!matching.length || !confirm(`Delete all ${matching.reduce((sum, purchase) => sum + purchase.qty, 0)} copies of this card?`)) return;
  purchases = purchases.filter(purchase => !matching.includes(purchase));
  if (destination.startsWith("Deck: ")) {
    removeQuantityFromDeck(destination.slice("Deck: ".length), cardId, matching.reduce((sum, purchase) => sum + purchase.qty, 0));
  }
  saveData();
  renderDashboard();
  renderCollection();
  renderSpending();
  renderDecks();
}

function openPurchase() {
  const select = document.getElementById("purchaseCard");
  if (!cards.length) {
    if (!tcgLoading) loadTCGProducts();
    alert("Loading the TCG Corner catalog. Please try Add Purchase again in a moment.");
    return;
  }
  populatePurchaseDestinations();
  const groups = new Map();
  cards.forEach(card => {
    const key = `${card.sourceLanguage}|${card.cardCode || card.productId}`;
    if (!groups.has(key)) groups.set(key, card);
  });
  select.innerHTML = [...groups.values()].map(card => `<option value="${escapeHtml(card.id)}">${escapeHtml(card.name)} · ${escapeHtml(card.cardCode)}</option>`).join("");
  document.getElementById("purchaseCardOptions").innerHTML = [...groups.values()].map(card => `<option value="${escapeHtml(card.name)}" label="${escapeHtml(card.cardCode)}"></option>`).join("");
  document.getElementById("purchaseCardName").value = "";
  document.getElementById("purchaseDate").value = new Date().toISOString().slice(0,10);
  updatePurchaseFields();
  document.getElementById("purchaseModal").classList.add("open");
}
function findPurchaseCard() {
  const query = document.getElementById("purchaseCardName").value.toLowerCase().trim();
  if (!query) return;
  const card = cards.find(item => item.name.toLowerCase() === query || item.cardCode.toLowerCase() === query);
  if (!card) return;
  const option = [...document.getElementById("purchaseCard").options].find(item => {
    const optionCard = cards.find(cardItem => String(cardItem.id) === String(item.value));
    return optionCard && optionCard.sourceLanguage === card.sourceLanguage &&
      (optionCard.cardCode ? optionCard.cardCode === card.cardCode : optionCard.productId === card.productId);
  });
  if (option) document.getElementById("purchaseCard").value = option.value;
  document.getElementById("purchaseCardName").value = card.name;
  updatePurchaseFields();
}
function getRarityVariants(card) {
  return cards.filter(item =>
    item.sourceLanguage === card.sourceLanguage &&
    (item.cardCode ? item.cardCode === card.cardCode : item.productId === card.productId)
  );
}
function updatePurchaseFields() {
  const card = cards.find(c => c.id == document.getElementById("purchaseCard").value);
  if (!card) return;
  const raritySelect = document.getElementById("purchaseRarity");
  const variants = [...new Map(getRarityVariants(card).map(item => [item.rarity, item])).values()];
  raritySelect.innerHTML = variants.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.rarity)} · ${money(item.price)}</option>`).join("");
  updatePurchaseRarity();
}
function updatePurchaseRarity() {
  const card = cards.find(c => c.id == document.getElementById("purchaseRarity").value);
  if (!card) return;
  document.getElementById("purchasePrice").value = card.price || 0;
  renderPurchaseCardPreview(card);
}
function renderPurchaseCardPreview(card) {
  const preview = document.getElementById("purchaseCardPreview");
  if (!preview) return;
  preview.innerHTML = card?.image
    ? `<img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}">`
    : `<div class="card-image">No image</div>`;
}
document.getElementById("purchaseCard").addEventListener("change", updatePurchaseFields);
document.getElementById("purchaseRarity").addEventListener("change", updatePurchaseRarity);
function closePurchase() { document.getElementById("purchaseModal").classList.remove("open"); }

function savePurchase() {
  const card = cards.find(c => c.id == document.getElementById("purchaseRarity").value);
  const qty = Number(document.getElementById("purchaseQty").value);
  const price = Number(document.getElementById("purchasePrice").value);
  const destination = document.getElementById("purchaseDestination").value;
  if(!card || qty < 1 || price < 0) return;
  purchases.unshift({
    id: Date.now(),
    cardId: card.id,
    card: card.name,
    printing: card.rarity,
    destination,
    qty,
    price,
    total: qty * price,
    date: document.getElementById("purchaseDate").value,
    seller: document.getElementById("purchaseSeller").value || "—"
  });
  if (destination.startsWith("Deck: ")) {
    const deckName = destination.slice("Deck: ".length);
    if (decks.includes(deckName)) addCardEntryToDeck(deckName, card, qty);
  }
  saveData();
  closePurchase();
  renderDashboard();
  showPage("collection");
}

function collectionRows() {
  const map = {};
  purchases.forEach(p => {
    const destination = p.destination || "Binder Collection";
    const key = p.cardId + "|" + p.printing + "|" + destination;
    if(!map[key]) map[key] = {cardId:p.cardId,card:p.card,printing:p.printing,destination,qty:0,paid:0};
    map[key].qty += Number(p.qty || 0);
    map[key].paid += p.total;
  });
  return Object.values(map);
}

function renderDashboard() {
  const rows = collectionRows();
  const value = rows.reduce((s,r) => s + r.qty * (cards.find(c=>String(c.id)===String(r.cardId))?.price || 0),0);
  const spent = purchases.reduce((s,p)=>s+p.total,0);
  document.getElementById("dashValue").textContent = money(value);
  document.getElementById("dashSpent").textContent = money(spent);
  document.getElementById("dashGain").textContent = money(value-spent);
  document.getElementById("dashCards").textContent = rows.reduce((s,r)=>s + Number(r.qty || 0), 0);
  const now = new Date();
  const month = purchases.filter(p => {
    const d = new Date(p.date);
    return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
  }).reduce((s,p)=>s+p.total,0);
  document.getElementById("monthSpent").textContent = money(month);
  document.getElementById("avgPurchase").textContent = money(purchases.length ? spent/purchases.length : 0);
  document.getElementById("recentPurchases").innerHTML = purchases.slice(0,5).map(p =>
    (() => {
      const marketPrice = cards.find(card => String(card.id) === String(p.cardId))?.price || 0;
      const gain = marketPrice * Number(p.qty || 0) - p.total;
      return `<tr><td>${p.date}</td><td>${p.card}</td><td>${p.qty}</td><td>${money(p.price)}</td><td>${money(marketPrice)}</td><td>${money(p.total)}</td><td class="${gain >= 0 ? "green" : "red"}">${gain >= 0 ? "+" : ""}${money(gain)}</td></tr>`;
    })()
  ).join("") || `<tr><td colspan="7" class="empty">No purchases yet.</td></tr>`;
}

function renderCollection() {
  const q = document
    .getElementById("collectionSearch")
    .value
    .toLowerCase();

  const rows = collectionRows()
    .filter(r =>
      r.card.toLowerCase().includes(q)
    );

  document.getElementById("collectionTable").innerHTML =
    rows.map(r => {

      const card = cards.find(
        c => String(c.id) === String(r.cardId)
      );

      const market =
        (card?.price || 0) * r.qty;

      /*
       * Get the card's limit from the active banlist.
       *
       * 0 = Forbidden
       * 1 = Limited
       * 2 = Semi-Limited
       * 3 = Unlimited
       */
      const cardLimit = getCardLimit(r.card);

      let banlistClass = "banlist-unlimited";
      let banlistText = "3";

      if (cardLimit === 0) {
        banlistClass = "banlist-forbidden";
        banlistText = "0";
      } else if (cardLimit === 1) {
        banlistClass = "banlist-limited";
        banlistText = "1";
      } else if (cardLimit === 2) {
        banlistClass = "banlist-semi-limited";
        banlistText = "2";
      }

      return `
        <div class="collection-card-tile">

          ${
            card?.image
              ? `
                <img
                  src="${escapeHtml(card.image)}"
                  alt="${escapeHtml(r.card)}"
                  ${cardTooltipAttributes(card, card.rarity)}
                >
              `
              : `
                <div class="card-image">
                  No image
                </div>
              `
          }

          <span
            class="collection-card-quantity ${banlistClass}"
            title="${
              cardLimit === 0
                ? "Forbidden"
                : cardLimit === 1
                  ? "Limited"
                  : cardLimit === 2
                    ? "Semi-Limited"
                    : "Unlimited"
            }"
          >
            ${banlistText}
          </span>

          <button
            class="collection-card-delete"
            title="Delete card"
            onclick="deleteCollectionGroup(
              '${escapeHtml(r.cardId)}',
              '${escapeHtml(r.printing)}',
              '${escapeHtml(r.destination)}'
            )"
          >
            ×
          </button>

          <div class="collection-card-details">
            <strong>${escapeHtml(r.card)}</strong>
            <small>
              ${escapeHtml(r.printing)}
              ·
              ${escapeHtml(r.destination)}
              ·
              ${money(market)}
            </small>
          </div>

        </div>
      `;
    }).join("") ||
    `
      <div
        class="empty"
        style="grid-column:1/-1;"
      >
        No cards in your collection.
      </div>
    `;
}

function queuePurchaseMatchRender(type) {
  clearTimeout(purchaseSearchTimer);
  purchaseSearchTimer = setTimeout(() => {
    if (type === "collection") renderCollectionCardMatches();
    else renderSpendingCardMatches();
  }, 300);
}

function renderPurchaseCardMatches(searchId, matchesId) {
  const input = document.getElementById(searchId);
  const matchesContainer = document.getElementById(matchesId);
  if (!input || !matchesContainer) return;

  const query = input.value.toLowerCase().trim();
  if (!query) {
    matchesContainer.innerHTML = "";
    return;
  }
  if (tcgLoading) {
    matchesContainer.innerHTML = `<div class="empty">Loading cards...</div>`;
    return;
  }
  const cacheKey = query;
  if (purchaseSearchCache.has(cacheKey)) {
    matchesContainer.innerHTML = purchaseSearchCache.get(cacheKey);
    return;
  }

  const groups = new Map();
  cards.forEach(card => {
    if (!card.name.toLowerCase().includes(query) && !card.cardCode.toLowerCase().includes(query)) return;
    const key = `${card.sourceLanguage}|${card.cardCode || card.productId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  });
  const visibleGroups = [...groups.values()].slice(0, 30);
  const resultCards = visibleGroups.map(variants => {
    const card = variants[0];
    const rarityOptions = [...new Map(variants.map(variant => [variant.rarity, variant])).values()];
    return `<div class="spending-card-match">
      <div><strong>${escapeHtml(card.name)}</strong><small>${escapeHtml(card.cardCode)}</small></div>
      <select onchange="updateSpendingPurchase(this)">
        ${rarityOptions.map(variant => `<option value="${escapeHtml(variant.id)}">${escapeHtml(variant.rarity)} · ${money(variant.price)}</option>`).join("")}
      </select>
      <button class="btn primary spending-add-purchase" data-card-id="${escapeHtml(card.id)}" onclick="openPurchaseFor(this.dataset.cardId)">Add Purchase</button>
    </div>`;
  }).join("");

  const resultMarkup = resultCards
    ? `<div style="width:min(460px,100%); margin:0 0 0 auto; display:grid; gap:8px;">${resultCards}</div>`
    : `<div class="empty">No cards match this name or card code.</div>`;
  purchaseSearchCache.set(cacheKey, resultMarkup);
  matchesContainer.innerHTML = resultMarkup;
}

function renderSpendingCardMatches() {
  renderPurchaseCardMatches("spendingCardSearch", "spendingCardMatches");
}

function renderCollectionCardMatches() {
  renderPurchaseCardMatches("collectionCardSearch", "collectionCardMatches");
}

function updateSpendingPurchase(select) {
  const card = cards.find(item => String(item.id) === String(select.value));
  if (!card) return;
  select.closest(".spending-card-match").querySelector(".spending-add-purchase").dataset.cardId = card.id;
}

function renderSpending() {
  const total = purchases.reduce((s,p)=>s+p.total,0);
  const now = new Date();
  const month = purchases.filter(p => {
    const d = new Date(p.date);
    return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
  }).reduce((s,p)=>s+p.total,0);
  document.getElementById("spentTotal").textContent = money(total);
  document.getElementById("spentMonth").textContent = money(month);
  document.getElementById("purchaseCount").textContent = purchases.length;
  document.getElementById("purchaseAverage").textContent = money(purchases.length ? total/purchases.length : 0);
  document.getElementById("purchaseTable").innerHTML = purchases.map(p =>
    (() => {
      const marketPrice = cards.find(card => String(card.id) === String(p.cardId))?.price || 0;
      const gain = marketPrice * Number(p.qty || 0) - p.total;
      return `<tr><td>${p.date}</td><td>${p.card}</td><td>${p.qty}</td><td>${money(p.price)}</td><td>${money(marketPrice)}</td><td>${money(p.total)}</td><td class="${gain >= 0 ? "green" : "red"}">${gain >= 0 ? "+" : ""}${money(gain)}</td><td>${p.seller}</td><td><button class="btn" onclick="deletePurchase('${escapeHtml(p.id)}')">Delete</button></td></tr>`;
    })()
  ).join("") || `<tr><td colspan="11" class="empty">No purchases recorded.</td></tr>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));
}

function stripHtml(value) {
  const element = document.createElement("div");
  element.innerHTML = String(value ?? "");
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

function getCardText(value) {
  const text = stripHtml(value);
  const description = text.match(/\bDescription:\s*(.*)$/i);
  if (description) return description[1].trim();

  const def = text.match(/\bDEF:\s*[^ ]+\s*(.*)$/i);
  if (def) return def[1].trim();

  return text;
}

function isAllowedLanguage(product, variant) {
  const haystack = [
    product.sourceLanguage || "",
    product.title,
    product.handle,
    ...(product.tags || []),
    product.body_html || "",
    variant.title || ""
  ].join(" ").toLowerCase();

  return /asian[- ]english|asia[- ]english|japanese|\bocg[- ]jp\b|\bjp[- ]ocg\b/.test(haystack);
}

function getCardCode(name) {
  const match = String(name || "").match(/\b[A-Z0-9]+-[A-Z0-9]+\b/i);
  return match ? match[0].toUpperCase() : "";
}

function getCardRarity(value) {
  const rarityCodes = Object.keys(TCGC_RAR).sort((a, b) => b.length - a.length).join("|");
  const text = String(value || "").toUpperCase();
  const explicitMatch = text.match(new RegExp(`\\bRARITY:\\s*(${rarityCodes})\\b`));
  const parenthesizedMatch = text.match(new RegExp(`\\(\\s*(${rarityCodes})\\s*\\)`));
  const match = explicitMatch || parenthesizedMatch || text.match(new RegExp(`(?:^|[^A-Z0-9])(${rarityCodes})(?:$|[^A-Z0-9])`));
  return match ? TCGC_RAR[match[1]] : "Other";
}

function getCardName(title) {
  const rarityCodes = Object.keys(TCGC_RAR).join("|");
  return String(title || "")
    .replace(/^\s*[A-Z0-9]+-[A-Z0-9]+\s+/i, "")
    .replace(new RegExp(`\\s+\\((?:${rarityCodes}|Prismatic Secret Rare)\\)`, "ig"), "")
    .replace(/\s+\(Status[^)]*\)/i, "")
    .trim();
}

function queueCardRender() {
  clearTimeout(cardRenderTimer);
  cardRenderTimer = setTimeout(renderCards, 300);
}

function renderCards() {
  const q = document.getElementById("cardSearch").value.toLowerCase().trim();
  const grid = document.getElementById("cardGrid");

  if (tcgLoading) {
    grid.innerHTML = `<div class="card empty" style="grid-column:1/-1;">Loading Yu-Gi-Oh products from TCG Corner...</div>`;
    return;
  }

  if (tcgError) {
    grid.innerHTML = `<div class="card empty" style="grid-column:1/-1;">
      <strong>Unable to load TCG Corner</strong><br><br>${escapeHtml(tcgError)}
      <br><br><button class="btn primary" onclick="loadTCGProducts()">Retry</button>
    </div>`;
    return;
  }

  if (!q) {
    grid.innerHTML = `<div class="card empty" style="grid-column:1/-1;">Search for a card to view results.</div>`;
    return;
  }

  const groups = new Map();
  cards.forEach(card => {
    const groupKey = `${card.sourceLanguage}|${card.cardCode || card.productId}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(card);
  });

  const filteredGroups = [...groups.values()].filter(variants => variants.some(card =>
    card.name.toLowerCase().includes(q) ||
    card.cardCode.toLowerCase().includes(q) ||
    card.variantTitle.toLowerCase().includes(q) ||
    card.rarity.toLowerCase().includes(q) ||
    card.tags.toLowerCase().includes(q)
  )).slice(0, MAX_CARD_RESULTS);

  grid.innerHTML = filteredGroups.map(variants => {
    const card = variants[0];
    const rarityOptions = [...new Map(variants.map(variant => [variant.rarity, variant])).values()];
    return `<div class="card card-item">
      <div class="card-image">
      ${
          card.image
            ? `
                <img
                  src="${escapeHtml(card.image)}"
                  alt="${escapeHtml(card.name)}"
                  ${cardTooltipAttributes(card, card.rarity)}
                  style="width:100%;height:100%;object-fit:contain;"
                >
              `
            : "No image"
        }
      </div>
      <div class="card-info">
        <strong>${escapeHtml(card.name)}</strong>
        <small>${escapeHtml(card.cardCode)}</small>
        <label class="label" style="margin-top:8px;">Rarity
          <select onchange="updateCardRarity(this)">
            ${rarityOptions.map(variant => `<option value="${escapeHtml(variant.id)}">${escapeHtml(variant.rarity)} · ${money(variant.price)}</option>`).join("")}
          </select>
        </label>
        <div style="margin-top:8px;" class="gold card-price">${money(card.price)}</div>
        <div style="margin-top:6px;" class="label card-stock">${card.available ? "In stock" : "Out of stock"} · TCG Corner</div>
        <div class="row-actions">
          <button class="btn primary card-purchase" data-card-id="${escapeHtml(card.id)}" onclick="openPurchaseFor(this.dataset.cardId)">Add Purchase</button>
          ${card.url ? `<a class="btn card-view" href="${escapeHtml(card.url)}" target="_blank" rel="noopener">View</a>` : ""}
        </div>
      </div>
    </div>`;
  }).join("") || `<div class="card empty" style="grid-column:1/-1;">No matching Yu-Gi-Oh products found.</div>`;
}

function updateCardRarity(select) {
  const card = cards.find(
    item => String(item.id) === String(select.value)
  );

  if (!card) return;

  const cardItem = select.closest(".card-item");

  cardItem.querySelector(".card-price").textContent = money(card.price);
  cardItem.querySelector(".card-stock").textContent =
    `${card.available ? "In stock" : "Out of stock"} · TCG Corner`;

  const purchaseButton = cardItem.querySelector(".card-purchase");
  purchaseButton.dataset.cardId = card.id;
  purchaseButton.dataset.price = card.price;
  purchaseButton.dataset.rarity = card.rarity || select.options[select.selectedIndex].text;
}

function openPurchaseFor(id) {
  const selectedCard = cards.find(card => String(card.id) === String(id));
  if (!selectedCard) return;
  openPurchase();
  const cardOption = [...document.getElementById("purchaseCard").options].find(option => {
    const optionCard = cards.find(card => String(card.id) === String(option.value));
    return optionCard && optionCard.sourceLanguage === selectedCard.sourceLanguage &&
      (optionCard.cardCode ? optionCard.cardCode === selectedCard.cardCode : optionCard.productId === selectedCard.productId);
  });
  if (cardOption) document.getElementById("purchaseCard").value = cardOption.value;
  document.getElementById("purchaseCardName").value = selectedCard.name;
  updatePurchaseFields();
  document.getElementById("purchaseRarity").value = selectedCard.id;
  updatePurchaseRarity();
}

async function loadCollectionProducts(feed) {
  const products = [];
  const seen = new Set();

  for (let page = 1; page <= 100; page++) {
    let response;
    try {
      response = await fetch(`${feed.url}&page=${page}`, {
        headers: { "Accept": "application/json" }
      });
    } catch (error) {
      if (page === 1) throw error;
      break;
    }
    if (!response.ok) throw new Error(`TCG Corner returned HTTP ${response.status} for the ${feed.language} collection.`);

    const data = await response.json();
    const pageProducts = Array.isArray(data.products) ? data.products : [];
    const newProducts = pageProducts.filter(product => !seen.has(String(product.id)));
    newProducts.forEach(product => seen.add(String(product.id)));
    products.push(...newProducts);

    if (pageProducts.length < 250 || newProducts.length === 0) break;
  }

  return products.map(product => ({ ...product, sourceLanguage: feed.language }));
}

async function loadTCGProducts() {
  tcgLoading = true;
  tcgError = "";
  renderCards();

  try {
    let products;
    try {
      products = (await Promise.all(TCG_FEEDS.map(loadCollectionProducts))).flat();
    } catch (collectionError) {
      const response = await fetch(TCG_GLOBAL_FEED, { headers: { "Accept": "application/json" } });
      if (!response.ok) throw collectionError;
      const data = await response.json();
      products = (Array.isArray(data.products) ? data.products : []).map(product => ({
        ...product,
        sourceLanguage: ""
      }));
    }

    // The feed contains multiple TCGs and product types. For this prototype,
    // identify Yu-Gi-Oh products from the product title, handle, tags, and description.
    const ygoProducts = products.filter(product => {
      const haystack = [
        product.title,
        product.handle,
        ...(product.tags || []),
        product.body_html || ""
      ].join(" ").toLowerCase();

      return product.sourceLanguage === "Asian English" ||
        product.sourceLanguage === "Japanese" ||
        /yu-?gi-?oh|yugioh/.test(haystack);
    });

    cards = ygoProducts.flatMap(product => {
      const variants = Array.isArray(product.variants) && product.variants.length
        ? product.variants
        : [{ id: `${product.id}-default`, title: "Default", price: "0", available: false }];

      const image = product.images?.[0]?.src || "";

      return variants.filter(variant => isAllowedLanguage(product, variant)).map(variant => ({
        id: String(variant.id),
        productId: product.id,
        cardCode: getCardCode(product.title),
        name: getCardName(product.title),
        variantTitle: variant.title || "Default",
        rarity: getCardRarity([
          product.title,
          product.body_html || "",
          ...(product.tags || []),
          variant.title || ""
        ].join(" ")),
        cardText: getCardText(product.body_html || ""),
        price: Number(variant.price || 0),
        available: Boolean(variant.available),
        image,
        tags: Array.isArray(product.tags) ? product.tags.join(" ") : "",
        url: product.handle ? `https://tcg-corner.com/products/${product.handle}` : ""
      }));
    });
    purchaseSearchCache.clear();

    tcgLoading = false;
    syncPurchasesToDecks();
    renderCards();
    populatePurchaseSelector();
    renderDecks();
    renderDashboard();
    renderSpending();
    renderSpendingCardMatches();
    renderCollectionCardMatches();
  } catch (error) {
    tcgLoading = false;
    tcgError = error.message || "The browser could not fetch the feed.";
    renderCards();
  }
}

function populatePurchaseSelector() {
  const select = document.getElementById("purchaseCard");
  if (!cards.length) {
    select.innerHTML = `<option>No Yu-Gi-Oh products loaded</option>`;
    return;
  }
  select.innerHTML = cards.map(c =>
    `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} · ${escapeHtml(c.variantTitle)}</option>`
  ).join("");
}

function getDeckCardPrice(card, rarity = "", setCode = "", region = "") {
  const wantedRarity = getTcgCornerRarity(rarity).toLowerCase();

  const matchesCard = item =>
    String(item.cardCode || "").toLowerCase() ===
      String(card.cardCode || "").toLowerCase() ||
    item.name === card.name;

  const variant = cards.find(item =>
    matchesCard(item) &&
    String(item.rarity || "").toLowerCase() === wantedRarity
  );

  return Number(variant?.price || 0);
}


async function loadBanlists() {
  try {
    const response = await fetch("./data/banlists.json");

    if (!response.ok) {
      throw new Error(`Banlist HTTP ${response.status}`);
    }

    const data = await response.json();

    banlists = {
      TCG: normalizeBanlistSection(data.TCG),
      AE: normalizeBanlistSection(data.AE),
      OCG: normalizeBanlistSection(data.OCG)
    };

    console.log("Loaded banlists:", {
      TCG: Object.keys(banlists.TCG).length,
      AE: Object.keys(banlists.AE).length,
      OCG: Object.keys(banlists.OCG).length
    });
  } catch (error) {
    console.error("Banlist loading failed:", error);
    banlists = { TCG: {}, AE: {}, OCG: {} };
  }
}

function normalizeBanlistSection(section) {
  const result = {};

  for (const name of section?.Forbidden || []) {
    result[String(name).trim().toLowerCase()] = 0;
  }

  for (const name of section?.Limited || []) {
    result[String(name).trim().toLowerCase()] = 1;
  }

  for (const name of section?.["Semi-Limited"] || []) {
    result[String(name).trim().toLowerCase()] = 2;
  }

  return result;
}

function normalizeBanlists(data) {
  return {
    TCG: normalizeBanlistSection(data.TCG),
    AE: normalizeBanlistSection(data.AE),
    OCG: normalizeBanlistSection(data.OCG)
  };
}

async function loadBanlists() {
  try {
    const response = await fetch("./data/banlists.json");

    if (!response.ok) {
      throw new Error(`Banlist HTTP ${response.status}`);
    }

    const data = await response.json();

    banlists = {
      TCG: normalizeBanlistSection(data.TCG),
      AE: normalizeBanlistSection(data.AE),
      OCG: normalizeBanlistSection(data.OCG)
    };

    console.log("Loaded banlists:", {
      TCG: Object.keys(banlists.TCG).length,
      AE: Object.keys(banlists.AE).length,
      OCG: Object.keys(banlists.OCG).length
    });
  } catch (error) {
    console.error("Banlist loading failed:", error);
    banlists = { TCG: {}, AE: {}, OCG: {} };
  }
}


function setActiveBanlist(value) {
  const selectedBanlist = String(value || "").trim();

  if (!selectedBanlist) {
    /* console.error("No banlist selected."); */
    return false;
  }

  if (!banlists || !banlists[selectedBanlist]) {
    console.error(
      "Banlist not found:",
      selectedBanlist,
      "Available:",
      Object.keys(banlists || {})
    );

    return false;
  }

  activeBanlist = selectedBanlist;

  /* console.log("Active banlist changed to:", activeBanlist); */

  return true;
}


function getCardLimit(cardName) {
  const requested = String(activeBanlist || "TCG")
    .trim()
    .toUpperCase();

  const aliases = {
    TCG: ["TCG", "EN", "ENGLISH"],
    AE: ["AE", "ASIAN_ENGLISH", "ASIAN ENGLISH", "ASIAN-ENGLISH"],
    OCG: ["OCG", "JP", "JAPANESE"]
  };

  const possibleKeys = aliases[requested] || [requested];

  const banlist = possibleKeys
    .map(key => banlists?.[key])
    .find(value => value && typeof value === "object");

  if (!banlist) {
    console.warn(
      "Banlist not found:",
      requested,
      "Available:",
      Object.keys(banlists || {})
    );

    return 3;
  }

  const entry = banlist[String(cardName || "").trim().toLowerCase()];

  if (entry === undefined || entry === null) return 3;

  if (typeof entry === "number") return entry;

  return Number(entry.limit ?? entry.status ?? 3);
}



function showBanlistPopup(title, message) {
  const popup = document.getElementById("banlistPopup");
  const popupTitle = document.getElementById("banlistPopupTitle");
  const popupMessage = document.getElementById("banlistPopupMessage");

  if (!popup || !popupTitle || !popupMessage) {
    alert(message);
    return;
  }

  popupTitle.textContent = title;
  popupMessage.textContent = message;

  popup.classList.add("show");
}


function closeBanlistPopup() {
  const popup = document.getElementById("banlistPopup");

  if (popup) {
    popup.classList.remove("show");
  }
}


function normalizeBanlists(data) {
  return {
    TCG: normalizeBanlistSection(
      data.TCG || data.tcg || data.EN || data.English
    ),
    AE: normalizeBanlistSection(
      data.AE ||
      data.ae ||
      data["Asian English"] ||
      data["Asian-English"]
    ),
    OCG: normalizeBanlistSection(
      data.OCG || data.ocg || data.JP || data.Japanese
    )
  };
}

document.addEventListener("DOMContentLoaded", function () {

  const banlistSelect = document.getElementById("banlistSelect");

  if (banlistSelect) {

    banlistSelect.addEventListener("change", function () {

      const changed = setActiveBanlist(this.value);

      if (!changed) {
        return;
      }

      /*
       * If a deck is currently open, re-check its cards
       * against the newly selected banlist.
       */
      renderDecks();
      renderCollection();

    });
  }


  const closeButton =
    document.getElementById("banlistPopupClose");

  if (closeButton) {
    closeButton.addEventListener(
      "click",
      closeBanlistPopup
    );
  }


  const popup =
    document.getElementById("banlistPopup");

  if (popup) {
    popup.addEventListener("click", function (event) {

      if (event.target === popup) {
        closeBanlistPopup();
      }

    });
  }

});

// Detect country when the page loads
document.addEventListener("DOMContentLoaded", () => {
    updateCurrencyDisplay();
    detectUserCurrency();
});

document.addEventListener("DOMContentLoaded", () => {
  const banlistSelect = document.getElementById("banlistSelect");

  if (banlistSelect) {
    banlistSelect.addEventListener("change", function () {
      if (setActiveBanlist(this.value)) {
        renderDecks();
        renderCollection();
      }
    });
  }
});

function cardTooltipAttributes(card, rarity = "") {
  return `
    data-tooltip-name="${escapeHtml(card?.name || "")}"
    data-tooltip-code="${escapeHtml(card?.cardCode || "")}"
    data-tooltip-rarity="${escapeHtml(rarity || card?.rarity || "")}"
    data-tooltip-price="${escapeHtml(String(card?.price || 0))}"
    data-tooltip-text="${escapeHtml( "<strong>Card Text:</strong>"+ (card?.cardText || card?.desc || "Card text unavailable.") )}"
  `;
}

let activeCardTooltip = null;

document.addEventListener("mouseover", event => {
  const image = event.target.closest("img[data-tooltip-name]");
  if (!image) return;

  activeCardTooltip?.remove();

  const tooltip = document.createElement("div");
  tooltip.className = "card-hover-tooltip";
  tooltip.innerHTML = `
    <strong>${image.dataset.tooltipName}</strong>
    <small>
      ${image.dataset.tooltipCode}
      · ${image.dataset.tooltipRarity}
      · ${formatPrice(image.dataset.tooltipPrice)}
    </small>
    <p>${image.dataset.tooltipText}</p>
  `;

  document.body.appendChild(tooltip);
  activeCardTooltip = tooltip;

  const rect = image.getBoundingClientRect();
  tooltip.style.left = `${Math.min(rect.right + 10, window.innerWidth - tooltip.offsetWidth - 10)}px`;
  tooltip.style.top = `${Math.max(10, rect.top)}px`;
});

document.addEventListener("mouseout", event => {
  const image = event.target.closest("img[data-tooltip-name]");
  if (image && !image.contains(event.relatedTarget)) {
    activeCardTooltip?.remove();
    activeCardTooltip = null;
  }
});



let marketplaceListings = JSON.parse(
  localStorage.getItem("ygoMarketplaceListings") || "[]"
);



function addMarketplaceListing(card, quantity, price, set, rarity) {
  if (!card?.id) return;

  marketplaceListings.push({
    id: crypto.randomUUID(),
    cardId: String(card.id),
    quantity: Number(quantity) || 1,
    price: Number(price) || 0,
    set: set || "Unknown set",
    rarity: rarity || "Unknown rarity"
  });

  saveMarketplaceListings();
  renderMarketplaceListings();
}

function renderMarketplaceListings() {
  const container = document.getElementById("marketplaceListings");
  if (!container) return;
  container.innerHTML = marketplaceListings.map(listing => {
    const card = localCardDatabase.find(
      item => String(item.id) === String(listing.cardId)
    );

    if (!card) return "";
    
    const image = card.card_images?.[0]?.image_url_small || card.image || "";
    const quantity = Number(listing.quantity ?? listing.qty ?? 1);
    const price = Number(listing.price || 0);

    return `
      <article class="card marketplace-listing">
        <img src="${escapeHtml(image)}"
             alt="${escapeHtml(card.name)}" ${cardTooltipAttributes(card, listing.rarity)}>

        <div class="card-info">
          <strong>${escapeHtml(card.name)}</strong>
          <small>
            ${escapeHtml(listing.set || "Unknown set")} ·
            ${escapeHtml(listing.region || "TCG")} ·
            ${escapeHtml(listing.rarity || "Unknown rarity")}<br>
            Qty: ${quantity}
          </small>

          <div class="price">${formatPrice(price)}</div>

          <button class="btn remove-listing"
                  type="button"
                  data-listing-id="${escapeHtml(String(listing.id))}">
            Remove
          </button>
        </div>
      </article>
    `;
  }).join("") || `<p class="empty">No cards listed for sale.</p>`;
}

document
  .getElementById("marketplaceListings")
  ?.addEventListener("click", event => {
    const button = event.target.closest(".remove-listing");
    if (!button) return;

    const listingId = button.dataset.listingId;

    marketplaceListings = marketplaceListings.filter(
      listing => String(listing.id) !== String(listingId)
    );

    saveMarketplaceListings();
    renderMarketplaceListings();
  });

function openMarketplace(cardId) {
  const card = localCardDatabase.find(
    item => String(item.id) === String(cardId)
  );
  
  const modal = document.getElementById("marketplaceModal");
  const cardIdInput = document.getElementById("marketplaceCardId");
  const cardNameInput = document.getElementById("marketplaceCardName");
  const setSelect = document.getElementById("marketplaceSet");

  if (!card || !modal || !cardIdInput || !cardNameInput || !setSelect) {
    console.error("Marketplace elements or card not found.", {
      cardId,
      card,
      modal,
      cardIdInput,
      cardNameInput,
      setSelect
    });
    return;
  }

  cardIdInput.value = String(card.id);
  cardNameInput.value = card.name;

  const sets = [...new Map(
    getCardPrintings(card).map(printing => [
      `${printing.region}|${printing.set}`,
      printing
    ])
  ).values()];

  setSelect.innerHTML = sets.map(printing => `
        <option value="${escapeHtml(`${printing.region}|${printing.set}`)}"
          data-set="${escapeHtml(printing.set)}"
            data-region="${escapeHtml(printing.region)}">
      ${escapeHtml(printing.set)} — ${escapeHtml(printing.region)}
    </option>
  `).join("");
  const preferredOption = [...setSelect.options].find(option =>
    option.dataset.region === "AE" || option.dataset.region === "OCG"
  );
  if (preferredOption) setSelect.value = preferredOption.value;

  updateMarketplaceRarities(card);

  modal.classList.add("open");
}

function updateMarketplaceRarities(card) {
  const setSelect = document.getElementById("marketplaceSet");
  const set = setSelect.selectedOptions[0]?.dataset.set || "";
  const region = setSelect.selectedOptions[0]?.dataset.region || "TCG";
  const rarities = [...new Set(
    getCardPrintings(card)
      .filter(printing => printing.set === set && printing.region === region)
      .map(printing => printing.rarity || "")
  )];
  const raritySelect = document.getElementById("marketplaceRarity");

  raritySelect.innerHTML = rarities
    .map(rarity =>
      `<option value="${escapeHtml(rarity)}"
                  data-tcg-rarity="${escapeHtml(
                    TCGC_RAR[rarity] || rarity
                  )}">
        ${escapeHtml(getTcgCornerRarity(rarity) || "Unknown rarity")}
      </option>`
    )
    .join("") || `<p class="empty">No cards listed for sale.</p>`;
}

document
  .getElementById("marketplaceSet")?.addEventListener("change", () => {
    const name = document.getElementById("marketplaceCardName").value;
    const card = localCardDatabase.find(item => item.name === name);
    if (card) updateMarketplaceRarities(card);
});

function closeMarketplaceModal() {
  document.getElementById("marketplaceModal").classList.remove("open");
}

function saveMarketplaceListings() {
  localStorage.setItem(
    "ygoMarketplaceListings",
    JSON.stringify(marketplaceListings)
  );
}

function saveMarketplaceListing() {
  console.log("Add Listing clicked");
  
  const cardId = document.getElementById("marketplaceCardId").value;

  console.log("Selected card ID:", cardId);
  console.log("Database loaded:", localCardDatabase?.length);

  const card = localCardDatabase.find(
    item => String(item.id) === String(cardId)
  );

  if (!card) {
    console.error("Marketplace card not found:", cardId);
    return;
  }

  const quantity = Number(
    document.getElementById("marketplaceQty").value
  );

  const price = Number(
    document.getElementById("marketplacePrice").value
  );

  if (quantity < 1 || price < 0) return;

  marketplaceListings.unshift({
    id: crypto.randomUUID(),
    cardId: String(card.id),
    card: card.name,
    set: document.getElementById("marketplaceSet").selectedOptions[0]?.dataset.set || "",
    region: document.getElementById("marketplaceSet").selectedOptions[0]?.dataset.region || "TCG",
    rarity: document.getElementById("marketplaceRarity").value,
    quantity,
    price,
    createdAt: new Date().toISOString()
  });

  saveMarketplaceListings();
  closeMarketplaceModal();
  renderMarketplaceListings();
}

function renderMarketplace() {
  const grid = document.getElementById("marketCardGrid");
  const input = document.getElementById("marketCardSearch");

  if (!grid) return;

  const query = String(input?.value || "").trim().toLowerCase();

  const matchingCards = localCardDatabase.filter(card =>
    !query ||
    String(card.name || "").toLowerCase().includes(query) ||
    getCardSets(card).some(set =>
      String(set).toLowerCase().includes(query)
    )
  );

  grid.innerHTML = matchingCards.slice(0, 100).map(card => `
    <article class="card">
      <img src="${escapeHtml(card.card_images?.[0]?.image_url_small || card.image || "")}"
           alt="${escapeHtml(card.name || "")}">

      <h3>${escapeHtml(card.name || "Unknown card")}</h3>

      <button type="button"
              class="btn primary"
              data-card-id="${escapeHtml(String(card.id))}">
        Add Listing
      </button>
    </article>
  `).join("") || "<p>No cards found.</p>";
}

document.getElementById("marketCardSearch")
  ?.addEventListener("input", renderMarketplaceCards);

const tcgCornerCacheKey = "tcgCornerPriceCache";
const tcgCornerCache = JSON.parse(
  localStorage.getItem(tcgCornerCacheKey) || "{}"
);

async function refreshDeckPrices() {
  let changed = false;

  for (const deckName of Object.keys(deckCards || {})) {
    for (const entry of deckCards[deckName] || []) {
      const card = localCardDatabase.find(
        item => String(item.id) === String(entry.cardId)
      );

      if (!card) continue;

      const printing = getCardPrintings(card).find(item =>
        String(item.code || "") === String(entry.setCode || "") &&
        String(item.rarity || "") === String(entry.rarity || "")
      );

      if (!printing || typeof getTcgCornerPrice !== "function") continue;

      const cacheKey = [
        card.id,
        printing.region,
        printing.code,
        printing.rarity
      ].join("|");

      let price = tcgCornerCache[cacheKey];

      if (price === undefined) {
        price = await getTcgCornerPrice(card, printing);
        if (Number.isFinite(price)) {
          tcgCornerCache[cacheKey] = price;
          changed = true;
        }
      }

      if (Number.isFinite(price)) {
        entry.tcgCornerPrice = price;
        entry.price = price;
      }
    }
  }

  if (changed) {
    localStorage.setItem(
      tcgCornerCacheKey,
      JSON.stringify(tcgCornerCache)
    );
    saveData();
  }

  renderDecks();
}

let detailSelectedCard = null;

function populateDetailSetOptions(card) {
  detailSelectedCard = card;

  const setSelect = document.getElementById("detailCardSetSelect");
  const raritySelect = document.getElementById("detailCardRaritySelect");
  const setDisplay = document.getElementById("detailCardSet");

  if (!setSelect || !raritySelect) return;

  const printings = getCardPrintings(card);

  const sets = [...new Map(
    printings.map(printing => [
      `${printing.region}:${printing.set}`,
      printing
    ])
  ).values()];

  setSelect.innerHTML = sets.map(printing => `
        <option value="${escapeHtml(`${printing.region}|${printing.set}`)}"
          data-set="${escapeHtml(printing.set)}"
            data-region="${escapeHtml(printing.region)}">
      ${escapeHtml(printing.set)}
    </option>
  `).join("");

  setDisplay.innerHTML = sets.map(printing => `
    <div>
      ${escapeHtml(printing.setName || printing.set)}
      (${escapeHtml(printing.code)}) —
      ${escapeHtml(printing.region)}
    </div>
  `).join("");

  updateDetailRarityOptions();
}

function updateDetailRarityOptions() {
  const setSelect = document.getElementById("detailCardSetSelect");
  const raritySelect = document.getElementById("detailCardRaritySelect");

  if (!setSelect || !raritySelect || !detailSelectedCard) return;

  const selectedOption = setSelect.options[setSelect.selectedIndex];
  const selectedSet = selectedOption?.dataset.set || "";
  const selectedRegion = selectedOption?.dataset.region || "TCG";

  const rarities = [...new Set(
    getCardPrintings(detailSelectedCard)
      .filter(printing =>
        printing.set === selectedSet &&
        printing.region === selectedRegion
      )
      .map(printing => printing.rarity || "")
  )];

  raritySelect.innerHTML = rarities.length
    ? rarities.map(rarity => {
        const tcgCode = getTcgCornerRarity(rarity);

        return `
          <option value="${escapeHtml(rarity)}"
                  data-tcg-rarity="${escapeHtml(tcgCode)}"
                  title="${escapeHtml(rarity)}">
            ${escapeHtml(tcgCode || "Unknown rarity")}
          </option>`;
      }).join("")
    : `<option value="">No rarity available</option>`;
}

document
  .getElementById("detailCardSetSelect")
  ?.addEventListener("change", updateDetailRarityOptions);

document
  .getElementById("addDetailCardToDeck")
  ?.addEventListener("click", () => {
    if (!detailSelectedCard) return;

    const deckName = activeDeck || decks[0];
    if (!deckName) {
      alert("Create or select a deck first.");
      return;
    }

    const setSelect = document.getElementById("detailCardSetSelect");
    const raritySelect = document.getElementById("detailCardRaritySelect");
    const quantity = Number(
      document.getElementById("detailCardQuantity").value
    ) || 1;

    const selectedOption =
      setSelect.options[setSelect.selectedIndex];

    const region = selectedOption?.dataset.region || "TCG";
    const selectedSet = setSelect.value;
    const selectedRarity = raritySelect.value;

    const printing = getCardPrintings(detailSelectedCard).find(item =>
      item.set === selectedSet &&
      item.region === region &&
      item.rarity === selectedRarity
    );

    if (!printing) {
      alert("No matching card printing was found.");
      return;
    }

    addCardEntryToDeck(
      deckName,
      detailSelectedCard,
      quantity,
      selectedRarity,
      getTcgCornerRarity(selectedRarity),
      selectedSet,
      region
    );

    saveData();
    renderDecks();
  });

function getTcgCornerRarity(rarity) {
  const key = String(rarity || "").trim();
  return TCGC_RAR[key] || key;
}

function renderMarketplaceCards() {
  const grid = document.getElementById("marketCardGrid");
  const search = document.getElementById("marketCardSearch");

  if (!grid) return;

  const query = String(search?.value || "").trim().toLowerCase();
  const source = Array.isArray(localCardDatabase)
    ? localCardDatabase
    : Array.isArray(cards)
      ? cards
      : [];

  const results = source.filter(card => {
    const name = String(card.name || "").toLowerCase();
    const code = String(card.cardCode || "").toLowerCase();

    return !query || name.includes(query) || code.includes(query);
  });

  grid.innerHTML = results.map(card => {
    const image =
      card.image ||
      card.card_images?.[0]?.image_url_small || card.image || "" ;

    return `
      <article class="card marketplace-card">
        <img src="${escapeHtml(image)}"
             alt="${escapeHtml(card.name || "")}">

        <h3>${escapeHtml(card.name || "Unknown card")}</h3>

        <button type="button"
                class="btn primary"
                data-card-id="${escapeHtml(String(card.id))}">
          Add Listing
        </button>
      </article>
    `;
  }).join("") || "<p>No cards found.</p>";
}

document.getElementById("marketCardSearch")
  ?.addEventListener("input", renderMarketplaceCards);

document
  .getElementById("marketCardGrid")
  ?.addEventListener("click", event => {
    const button = event.target.closest("[data-card-id]");
    if (!button) return;

    openMarketplace(button.dataset.cardId);
  });

loadLocalCardDatabase()
  .then(() => {
    renderDashboard();
    renderCollection();
    renderSpending();
    renderDecks();
    refreshDeckPrices();
    renderCards();
    renderMarketplace();
    renderMarketplaceCards();
    renderMarketplaceListings();
  })
  .catch(error => console.error(error));

loadBanlists().then(() => {
  setActiveBanlist(activeBanlist || "AE");
});
