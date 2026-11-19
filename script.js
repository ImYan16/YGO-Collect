let userCurrency = "PHP";
let exchangeRates = { USD: 1, HKD: 7.8, PHP: 58 };
const EXCHANGE_RATE_CACHE_KEY = "ygoUsdExchangeRates";
 let localCardDatabase = [];
 let localCardDatabaseReady = false;
 let localCardDatabasePromise = null;
 let localCardDatabaseError = null;
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

function getCardImageUrl(card, preferSmall = true) {
  return preferSmall
    ? card?.card_images?.[0]?.image_url_small || card?.card_images?.[0]?.image_url || card?.image || ""
    : card?.card_images?.[0]?.image_url || card?.image || "";
}

function getCardCatalogMatch(card) {
  const cards = Array.isArray(localCardDatabase) ? localCardDatabase : [];
  const hasCatalogId = Array.isArray(card?.card_images) || card?.konami_id || card?.misc_info;
  if (hasCatalogId && card?.id != null) {
    const idMatch = cards.find(item => String(item.id) === String(card.id));
    if (idMatch) return idMatch;
  }

  const name = String(card?.name || "").trim();
  if (!name) return null;
  const nameKey = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const codeKey = String(card?.cardCode || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const codeMatch = codeKey && cards.find(item => {
    const codes = [
      item.cardCode,
      ...(Array.isArray(item.card_sets) ? item.card_sets.map(set => set.set_code) : []),
      ...(Array.isArray(item.asian_english_sets)
        ? item.asian_english_sets.flatMap(set => [set.card_code, set.set_code])
        : []),
      ...(Array.isArray(item.ocg_sets)
        ? item.ocg_sets.flatMap(set => [set.card_code, set.set_code])
        : [])
    ];
    return codes.some(value =>
      String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "") === codeKey
    );
  });
  if (codeMatch) return codeMatch;

  return cards.find(item =>
    String(item.name || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "") === nameKey
  ) || null;
}

function getCardCatalogImage(card) {
  const catalogCard = getCardCatalogMatch(card);
  return catalogCard ? getCardImageUrl(catalogCard, false) : "";
}

function getCardImageWithFallback(card, preferredImage = "") {
  return preferredImage ||
    getCardImageUrl(card) ||
    getCardCatalogImage(card) ||
    getStoredCardImage(card?.name) ||
    "";
}

function getCardImageFallback(card, primaryImage = "") {
  return [
    getCardCatalogImage(card),
    getStoredCardImage(card?.name)
  ].find(image => image && image !== primaryImage) || "";
}

function getCardImageMarkup(card, preferredImage = "", altText = "", className = "", tooltipAttributes = "") {
  const image = getCardImageWithFallback(card, preferredImage);
  if (!image) {
    const classes = ["card-image-unavailable", className].filter(Boolean).join(" ");
    return `<div class="${escapeHtml(classes)}">Image unavailable</div>`;
  }
  const fallback = getCardImageFallback(card, image);
  return `<img${className ? ` class="${escapeHtml(className)}"` : ""}
    src="${escapeHtml(image)}"
    data-image-fallback="${escapeHtml(fallback)}"
    alt="${escapeHtml(altText || card?.name || "Card image")}"
    loading="lazy"
    decoding="async"
    ${tooltipAttributes}>`;
}

function bindCardImageFallbacks(root = document) {
  root.querySelectorAll("img[data-image-fallback]").forEach(image => {
    if (image.dataset.fallbackBound) return;
    image.dataset.fallbackBound = "true";
    image.addEventListener("error", () => {
      const fallback = image.dataset.imageFallback || "";
      if (fallback) {
        image.dataset.imageFallback = "";
        image.src = fallback;
        return;
      }

      if (image.id === "detailCardImage") {
        image.removeAttribute("src");
        image.alt = "Image unavailable";
        image.classList.add("image-unavailable");
        return;
      }

      const placeholder = document.createElement("span");
      placeholder.className = "card-image-unavailable";
      placeholder.textContent = "Image unavailable";
      const parent = image.parentElement;
      image.replaceWith(placeholder);
      if (parent?.classList.contains("card-catalog-image")) {
        parent.classList.add("image-unavailable");
      }
    });
  });
}

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

        image: getCardImageUrl(card),

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

  localCardDatabaseError = null;
  return localCardDatabase;
}).catch(error => {
  console.error("Error loading local card database:", error);
  localCardDatabaseReady = false;
  localCardDatabaseError = error;
  localCardDatabasePromise = null;
  throw error;
});
  return localCardDatabasePromise;
}

function mergePrintings(existing, additions) {
  const merged = new Map();
  [
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(additions) ? additions : [])
  ].forEach((printing, index) => {
    const code = String(printing.card_code || printing.set_code || "").trim().toUpperCase();
    const key = code
      ? `${String(printing.set_name || "").trim().toLowerCase()}|${code}`
      : `unkeyed|${index}`;
    const incomingRarities = Array.isArray(printing.rarity)
      ? printing.rarity
      : [printing.rarity || ""];
    const current = merged.get(key);

    if (!current) {
      merged.set(key, {
        ...printing,
        rarity: [...new Set(incomingRarities.filter(Boolean))]
      });
      return;
    }

    const rarities = [...new Set([...current.rarity, ...incomingRarities.filter(Boolean)])];
    const hasPublishedRarity = rarities.some(rarity => rarity !== "Not Applicable");
    current.rarity = hasPublishedRarity
      ? rarities.filter(rarity => rarity !== "Not Applicable")
      : rarities;
  });

  return [...merged.values()];
}

function getPrimaryCardCode(card) {
  return (
    card?.asian_english_sets?.[0]?.card_code ||
    card?.ocg_sets?.[0]?.card_code ||
    card?.card_sets?.[0]?.set_code ||
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

    await loadExchangeRates();
    updateCurrencyDisplay();
}

async function loadExchangeRates() {
  try {
    const cached = JSON.parse(localStorage.getItem(EXCHANGE_RATE_CACHE_KEY) || "null");
    const age = cached?.savedAt ? Date.now() - new Date(cached.savedAt).getTime() : Infinity;
    if (cached?.rates && age < 12 * 60 * 60 * 1000) {
      exchangeRates = { ...exchangeRates, ...cached.rates };
      return;
    }

    const response = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!response.ok) throw new Error(`Exchange-rate service returned HTTP ${response.status}`);
    const data = await response.json();
    if (data?.result !== "success" || !data.rates) throw new Error("Exchange-rate data was unavailable");
    exchangeRates = { ...exchangeRates, ...data.rates };
    localStorage.setItem(EXCHANGE_RATE_CACHE_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      rates: exchangeRates
    }));
  } catch (error) {
    console.warn("Using fallback exchange rates:", error);
  }
}

function convertStorePrice(price, storeCurrency) {
  const sourceRate = Number(exchangeRates[storeCurrency]) || 1;
  const targetRate = Number(exchangeRates[userCurrency]) || 1;
  return (Number(price) || 0) / sourceRate * targetRate;
}

function formatStorePrice(price, currency) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || userCurrency
  }).format(Number(price) || 0);
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

  if (Array.isArray(cards) && cards.length) {
    cards = cards.map(card => ({
      ...card,
      price: card.storeCurrency
        ? convertStorePrice(card.storePrice ?? card.price, card.storeCurrency)
        : Number(card.price || 0)
    }));
  }

  refreshDeckPrices();
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
const TCG_CORNER_CACHE_KEY = "ygoTCGCornerCards";
const TCG_CORNER_CACHE_DB_NAME = "ygoCollectCache";
const TCG_CORNER_CACHE_STORE_NAME = "catalogs";
const BAKED_TCG_PRICES_FILE = "./tcgc-prices.json";
const MAX_TCG_FEED_PAGES = 24;
const PLAYERS_CLUB_PRICE_FILE = "./playersclub-prices.json";
const PLAYERS_CLUB_OCG_PRICE_FILE = "./playersclub-prices-ocg.json";
const PLAYERS_CLUB_PRODUCTS_URL = "https://playersclubhk.com/en/collections/ygoae1/products.json?limit=250&page=";
const PLAYERS_CLUB_OCG_PRODUCTS_URL = "https://playersclubhk.com/en/collections/ocg/products.json?limit=250&page=";
const PLAYERS_CLUB_CACHE_KEY = "ygoPlayersClubProducts";
const PLAYERS_CLUB_CACHE_TTL = 24 * 60 * 60 * 1000;
const MAX_PLAYERS_CLUB_PAGES = 24;
let bakedTCGPriceCatalogPromise = null;
let bakedPlayersClubPriceCatalogPromise = null;
let bakedPlayersClubOcgPriceCatalogPromise = null;
let tcgCornerCacheDatabasePromise = null;
let playersClubRefreshPromise = null;

const TCGC_RAR = {
  C: "C",
  N: "C", 
  NR: "C",
  "Normal Parallel Rare":"P-R",
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
  "Extended Art Prismatic Secret Rare": "PScR",
  "Extended Art Ultra Rare": "UR",
  "Extended Art Secret Rare": "ScR",
  "Extended Art Super Rare": "SR",
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
let cardVisibleCount = MAX_CARD_RESULTS;
let cardDetailsRenderToken = 0;
let cardRulingIndexPromise = null;
const YGORESOURCES_API = "https://db.ygoresources.com";
const YGORESOURCES_CARD_NAME_INDEX_URL = `${YGORESOURCES_API}/data/idx/card/name/en`;
const YGORESOURCES_CARD_URL = `${YGORESOURCES_API}/data/card/`;
const YGORESOURCES_QA_URL = `${YGORESOURCES_API}/data/qa/`;
const YGORESOURCES_CACHE = new Map();
const RULINGS_BATCH_SIZE = 8;
let selectedRulingCard = null;
let rulingCardSearchTimer = null;
let rulingPageToken = 0;
let rulingQaIds = [];
let rulingNextQaIndex = 0;
let rulingFailedQaIds = [];
let rulingIsLoading = false;

let purchases = JSON.parse(localStorage.getItem("ygoPurchases") || "[]");
let cardWishlist = JSON.parse(localStorage.getItem("ygoCardWishlist") || "[]");
let marketplaceListings = JSON.parse(
  localStorage.getItem("ygoMarketplaceListings") || "[]"
);
let cardDatabase = [];
let decks = JSON.parse(localStorage.getItem("ygoDecks") || "[]");
let deckCards = JSON.parse(localStorage.getItem("ygoDeckCards") || "{}");
let deckCardOrder = JSON.parse(localStorage.getItem("ygoDeckCardOrder") || "{}");
const DEFAULT_BINDER_ID = "default";
const DEFAULT_BINDER = {
  id: DEFAULT_BINDER_ID,
  name: "Binder Collection",
  description: "Your Yu-Gi-Oh! collection."
};
const savedBinderState = JSON.parse(localStorage.getItem("ygoBinders") || "null");
let binders = Array.isArray(savedBinderState?.binders)
  ? savedBinderState.binders
  : [];
if (!binders.some(binder => binder.id === DEFAULT_BINDER_ID)) {
  binders.unshift({ ...DEFAULT_BINDER });
}
let activeBinderId = binders.some(
  binder => binder.id === savedBinderState?.activeBinderId
)
  ? savedBinderState.activeBinderId
  : DEFAULT_BINDER_ID;
const binderCoverObjectUrls = new Map();
let binderPreviewObjectUrl = "";
let binderImageDatabasePromise = null;
let activeDeck = "";
let collectionPage = 1;
let collectionPageCount = 1;
const COLLECTION_PAGE_SIZE = 9;
let cardDetailsHistoryOpen = false;
let currentAppPage = document.querySelector(".page.active")?.id || "dashboard";
let selectedDeckCardId = "";
let deckCardSearchTerm = "";
let deckApiCards = [];
let deckApiLoading = false;
let deckApiError = "";
let deckSearchTimer;
const deckSearchCache = new Map();
const CARD_SEARCH_HISTORY_KEY = "ygoCardSearchHistory";
const MAX_CARD_SEARCH_HISTORY = 12;
let cardSearchHistoryTimer = null;
let cardSearchHistoryOpen = false;


function money(n) {
  return formatPrice(n);
}
function closeCardDetails(fromHistory = false) {
  cardDetailsRenderToken++;
  const panel = document.getElementById("cardDetailsPanel");
  const backdrop = document.getElementById("cardDetailsBackdrop");
  if (panel) panel.hidden = true;
  if (backdrop) backdrop.hidden = true;

  const shouldGoBack = cardDetailsHistoryOpen && !fromHistory;
  cardDetailsHistoryOpen = false;
  if (shouldGoBack && window.history.state?.ygoCollectCardDetails) {
    window.history.back();
  }
}

function pushCardDetailsHistoryState() {
  if (cardDetailsHistoryOpen) return;
  const currentState = window.history.state;
  const state = currentState && typeof currentState === "object"
    ? currentState
    : {};
  window.history.pushState(
    { ...state, ygoCollectCardDetails: true },
    "",
    window.location.href
  );
  cardDetailsHistoryOpen = true;
}

window.addEventListener("popstate", () => {
  if (cardDetailsHistoryOpen) closeCardDetails(true);
});

const closeCardDetailsButton = document.getElementById("closeCardDetails");
if (closeCardDetailsButton) closeCardDetailsButton.onclick = closeCardDetails;
document.getElementById("cardDetailsBackdrop")
  ?.addEventListener("click", closeCardDetails);
document.addEventListener("keydown", event => {
  const purchaseModalOpen =
    document.getElementById("purchaseModal")?.classList.contains("open");
  if (event.key === "Escape" && !purchaseModalOpen &&
      !document.getElementById("cardDetailsPanel")?.hidden) {
    closeCardDetails();
  }
});

document.addEventListener("keydown", event => {
  const activeModal = [...document.querySelectorAll('.modal.open[aria-modal="true"]')]
    .reverse()
    .find(dialog => dialog.getClientRects().length);
  const activeDialog = activeModal || [...document.querySelectorAll('[aria-modal="true"]')]
    .reverse()
    .find(dialog => !dialog.hidden && dialog.getClientRects().length);
  if (!activeDialog) return;

  if (event.key === "Escape" && activeDialog.classList.contains("modal")) {
    const cancelButton = activeDialog.querySelector(
      ".modal-actions .btn:not(.primary)"
    );
    if (cancelButton) cancelButton.click();
    return;
  }

  if (event.key !== "Tab") return;
  const focusable = [...activeDialog.querySelectorAll(
    'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
  )].filter(element => element.getClientRects().length);
  if (!focusable.length) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey &&
      (document.activeElement === first || !activeDialog.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey &&
      (document.activeElement === last || !activeDialog.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
});

function saveData() {
  localStorage.setItem("ygoPurchases", JSON.stringify(purchases));
  localStorage.setItem("ygoDecks", JSON.stringify(decks));
  localStorage.setItem("ygoDeckCards", JSON.stringify(deckCards));
  localStorage.setItem("ygoDeckCardOrder", JSON.stringify(deckCardOrder));
  localStorage.setItem("ygoBinders", JSON.stringify({ binders, activeBinderId }));
  getStoredCardImage.index = null;
}
function showPage(page, fromHistory = false) {
  const activePage = document.getElementById(page);
  if (!activePage || !activePage.classList.contains("page")) return;

  const pageChanged = currentAppPage !== page;
  const detailsPanel = document.getElementById("cardDetailsPanel");
  const hadDetailsHistory = cardDetailsHistoryOpen;
  if (pageChanged && currentAppPage === "decks" && page !== "decks") {
    activeDeck = "";
    renderDecks();
  }
  if (pageChanged && detailsPanel && !detailsPanel.hidden) {
    closeCardDetails(true);
  }
  if (pageChanged && !fromHistory) {
    const currentState = window.history.state;
    const nextState = currentState && typeof currentState === "object"
      ? { ...currentState }
      : {};
    delete nextState.ygoCollectCardDetails;
    nextState.ygoCollectPage = page;
    window.history[hadDetailsHistory ? "replaceState" : "pushState"](
      nextState,
      "",
      window.location.href
    );
  }

  currentAppPage = page;
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  activePage.classList.add("active");
  document.querySelectorAll("nav button[data-page]").forEach(button => {
    const isActive = button.dataset.page === page;
    button.classList.toggle("active", isActive);
    if (isActive) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if(page === "dashboard") renderDashboard();
  if(page === "collection") renderCollection();
  if(page === "wishlist") renderWishlist();
  if(page === "spending") {
    renderSpending();
    if (!cards.length && !tcgLoading) loadTCGProducts();
  }
  if(page === "cards") {
    renderCards();
  }
  if(page === "rulings") renderRulingCardMatches();
  if(page === "decks") renderDecks();
}
document.querySelectorAll("nav button").forEach(b => b.onclick = () => showPage(b.dataset.page));

const initialHistoryState = window.history.state;
const restoredPage = initialHistoryState?.ygoCollectPage;
if (restoredPage && document.getElementById(restoredPage)?.classList.contains("page")) {
  const cleanState = initialHistoryState && typeof initialHistoryState === "object"
    ? { ...initialHistoryState }
    : {};
  delete cleanState.ygoCollectCardDetails;
  cleanState.ygoCollectPage = restoredPage;
  window.history.replaceState(cleanState, "", window.location.href);
  if (restoredPage !== currentAppPage) showPage(restoredPage, true);
} else {
  const initialState = initialHistoryState && typeof initialHistoryState === "object"
    ? { ...initialHistoryState }
    : {};
  delete initialState.ygoCollectCardDetails;
  initialState.ygoCollectPage = currentAppPage;
  window.history.replaceState(initialState, "", window.location.href);
}

window.addEventListener("popstate", event => {
  if (cardDetailsHistoryOpen) closeCardDetails(true);

  const page = event.state?.ygoCollectPage;
  if (page && document.getElementById(page)?.classList.contains("page") &&
      page !== currentAppPage) {
    showPage(page, true);
  }
});

function populatePurchaseDestinations() {
  const select = document.getElementById("purchaseDestination");
  const current = select.value;
  select.innerHTML = [
    ...binders.map(binder =>
      `<option value="binder:${escapeHtml(binder.id)}">Binder: ${escapeHtml(binder.name)}</option>`
    )
  ].join("");
  if ([...select.options].some(option => option.value === current)) {
    select.value = current;
  } else {
    select.value = `binder:${activeBinderId}`;
  }
}

function getActiveBinder() {
  return binders.find(binder => binder.id === activeBinderId) || binders[0];
}

function getBinderDestination(binderId) {
  const binder = binders.find(item => item.id === binderId) || getActiveBinder();
  return binder.id === DEFAULT_BINDER_ID
    ? "Binder Collection"
    : `Binder: ${binder.name}`;
}

function createBinderId() {
  return window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `binder-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function openBinderImageDatabase() {
  if (!window.indexedDB) {
    return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
  }
  if (binderImageDatabasePromise) return binderImageDatabasePromise;

  binderImageDatabasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open("ygoCollectBinderImages", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("images")) {
        request.result.createObjectStore("images", { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        binderImageDatabasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      reject(request.error || new Error("Unable to open binder image storage."));
    };
  }).catch(error => {
    binderImageDatabasePromise = null;
    throw error;
  });
  return binderImageDatabasePromise;
}

async function storeBinderImage(id, image) {
  const database = await openBinderImageDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("images", "readwrite");
    transaction.objectStore("images").put({ id, image });
    transaction.oncomplete = resolve;
    transaction.onerror = () => {
      reject(transaction.error || new Error("Unable to save the binder cover photo."));
    };
    transaction.onabort = () => {
      reject(transaction.error || new Error("Saving the binder cover photo was aborted."));
    };
  });
}

async function readBinderImage(id) {
  const database = await openBinderImageDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction("images", "readonly")
      .objectStore("images")
      .get(id);
    request.onsuccess = () => resolve(request.result?.image || null);
    request.onerror = () => {
      reject(request.error || new Error("Unable to read the binder cover photo."));
    };
  });
}

async function deleteBinderImage(id) {
  const database = await openBinderImageDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("images", "readwrite");
    transaction.objectStore("images").delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => {
      reject(transaction.error || new Error("Unable to remove the saved binder cover."));
    };
    transaction.onabort = () => {
      reject(transaction.error || new Error("Removing the saved binder cover was aborted."));
    };
  });
}

function getBinderBackgroundUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function updateBinderCoverPreview() {
  const image = document.getElementById("binderCoverPreviewImage");
  const file = document.getElementById("binderBackgroundFile").files[0];
  if (binderPreviewObjectUrl) {
    URL.revokeObjectURL(binderPreviewObjectUrl);
    binderPreviewObjectUrl = "";
  }

  image.hidden = true;
  image.removeAttribute("src");
  if (file) {
    binderPreviewObjectUrl = URL.createObjectURL(file);
    image.src = binderPreviewObjectUrl;
    image.hidden = false;
    return;
  }

  const url = getBinderBackgroundUrl(
    document.getElementById("binderBackgroundUrl").value.trim()
  );
  if (url) {
    image.src = url;
    image.hidden = false;
  }
}

function openCreateBinder() {
  document.getElementById("createBinderForm").reset();
  document.getElementById("createBinderModal").classList.add("open");
  updateBinderCoverPreview();
  document.getElementById("binderNameInput").focus();
}

function closeCreateBinder() {
  document.getElementById("createBinderModal").classList.remove("open");
  document.getElementById("createBinderForm").reset();
  updateBinderCoverPreview();
}

async function saveBinder() {
  const nameInput = document.getElementById("binderNameInput");
  const name = nameInput.value.trim();
  const description = document.getElementById("binderDescriptionInput").value.trim();
  const file = document.getElementById("binderBackgroundFile").files[0];
  const typedUrl = document.getElementById("binderBackgroundUrl").value.trim();

  if (!name) {
    showAppAlert("Enter a name for this binder.");
    nameInput.focus();
    return;
  }
  if (binders.some(binder => binder.name.toLowerCase() === name.toLowerCase())) {
    showAppAlert("A binder with that name already exists.");
    nameInput.focus();
    return;
  }
  if (file && typedUrl) {
    showAppAlert("Choose either an uploaded photo or an image URL, not both.");
    return;
  }
  if (file && (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) ||
      file.size > 10 * 1024 * 1024)) {
    showAppAlert("Choose a JPEG, PNG, WebP, or GIF image under 10 MB.");
    return;
  }

  const backgroundUrl = getBinderBackgroundUrl(typedUrl);
  if (typedUrl && !backgroundUrl) {
    showAppAlert("Enter a valid HTTP or HTTPS image URL.");
    return;
  }

  const id = createBinderId();
  const binder = {
    id,
    name,
    description,
    backgroundUrl,
    coverImageId: file ? id : ""
  };
  if (file) {
    try {
      await storeBinderImage(id, file);
    } catch (error) {
      console.error("Unable to save the binder cover photo:", error);
      showAppAlert(`Unable to save the cover photo: ${error.message}`);
      return;
    }
  }

  const previousBinderId = activeBinderId;
  binders.push(binder);
  activeBinderId = binder.id;
  try {
    localStorage.setItem("ygoBinders", JSON.stringify({ binders, activeBinderId }));
  } catch (error) {
    binders = binders.filter(item => item.id !== binder.id);
    activeBinderId = previousBinderId;
    console.error("Unable to save binder details:", error);
    if (file) {
      try {
        await deleteBinderImage(id);
      } catch (cleanupError) {
        console.error("Unable to clean up the unsaved binder cover photo:", cleanupError);
      }
    }
    showAppAlert(`Unable to save this binder: ${error.message}`);
    return;
  }

  closeCreateBinder();
  populatePurchaseDestinations();
  renderCollection();
}

function selectCollectionBinder(binderId) {
  if (!binders.some(binder => binder.id === binderId)) return;
  const previousBinderId = activeBinderId;
  activeBinderId = binderId;
  try {
    localStorage.setItem("ygoBinders", JSON.stringify({ binders, activeBinderId }));
  } catch (error) {
    activeBinderId = previousBinderId;
    document.getElementById("collectionBinderSelect").value = previousBinderId;
    console.error("Unable to save the selected binder:", error);
    showAppAlert(`Unable to save the selected binder: ${error.message}`);
    return;
  }

  clearCollectionFilterControls();
  collectionPage = 1;
  renderCollection();
}

function renderBinderCover(binder) {
  const cover = document.getElementById("collectionBinderCover");
  const image = document.getElementById("collectionBinderCoverImage");
  document.getElementById("collectionBinderName").textContent = binder.name;
  document.getElementById("collectionBinderDescription").textContent =
    binder.description || "Your Yu-Gi-Oh! collection.";

  const coverKey = binder.backgroundUrl
    ? `${binder.id}|url:${binder.backgroundUrl}`
    : binder.coverImageId
      ? `${binder.id}|id:${binder.coverImageId}`
      : `${binder.id}|none`;
  if (cover.dataset.coverKey === coverKey) return;

  cover.dataset.binderId = binder.id;
  cover.dataset.coverKey = coverKey;
  image.onload = null;
  image.onerror = null;
  image.hidden = true;
  image.removeAttribute("src");

  if (binder.backgroundUrl) {
    image.onload = () => {
      if (cover.dataset.binderId === binder.id) image.hidden = false;
    };
    image.onerror = () => {
      if (cover.dataset.binderId === binder.id) image.hidden = true;
      console.error(`Unable to load the cover image for binder "${binder.name}".`);
    };
    image.src = binder.backgroundUrl;
    return;
  }

  if (binder.coverImageId) {
    void readBinderImage(binder.coverImageId)
      .then(blob => {
        if (!blob) throw new Error("The saved cover photo could not be found.");
        if (!binderCoverObjectUrls.has(binder.coverImageId)) {
          binderCoverObjectUrls.set(
            binder.coverImageId,
            URL.createObjectURL(blob)
          );
        }
        if (cover.dataset.binderId !== binder.id) return;
        image.src = binderCoverObjectUrls.get(binder.coverImageId);
        image.hidden = false;
      })
      .catch(error => {
        console.error(`Unable to load the cover image for binder "${binder.name}":`, error);
      });
  }
}

function populateCardDetailsBinderOptions() {
  const select = document.getElementById("cardDetailsBinderSelect");
  if (!select) return;

  const selectedBinderId = binders.some(binder => binder.id === activeBinderId)
    ? activeBinderId
    : DEFAULT_BINDER_ID;
  select.innerHTML = binders.map(binder =>
    `<option value="${escapeHtml(binder.id)}">${escapeHtml(binder.name)}</option>`
  ).join("");
  select.value = selectedBinderId;
}

function populateCardDetailsDeckOptions() {
  const select = document.getElementById("detailCardDeckSelect");
  if (!select) return;

  select.innerHTML = decks.map(deck =>
    `<option value="${escapeHtml(deck)}">${escapeHtml(deck)}</option>`
  ).join("");
  select.disabled = decks.length === 0;
  select.value = decks.includes(activeDeck) ? activeDeck : decks[0] || "";
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
  activeDeck = deckName;
  saveData();
  populatePurchaseDestinations();
  closeDeckModal();
  renderDecks();
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
  document.getElementById("closeCardDetails").onclick = closeCardDetails;
  if (!decks.length) {
    list.className = "section card empty";
    list.innerHTML = `
      <div class="deck-empty-state">
        <p>No decks yet. Create a deck to start building and check card limits against your selected banlist.</p>
        <button type="button" class="btn primary" onclick="addDeck()">Create your first deck</button>
      </div>
    `;
    profile.style.display = "none";
    return;
  }

  list.className = "deck-library-list";
  list.innerHTML = `
    <div class="deck-library-grid">
      ${decks.map(deck => {
        const copyCount = (deckCards[deck] || []).reduce(
          (sum, entry) => sum + (Number(entry.qty) || 0),
          0
        );
        const isActive = activeDeck === deck;
        return `
          <article class="deck-library-card${isActive ? " active" : ""}"${isActive ? ' aria-current="true"' : ""}>
            <div class="deck-library-card-icon" aria-hidden="true">${isActive ? "✓" : "▤"}</div>
            <div class="deck-library-card-content">
              <span class="deck-library-card-label">${isActive ? "Selected deck" : "Deck"}</span>
              <h2>${escapeHtml(deck)}</h2>
              <p>${copyCount} ${copyCount === 1 ? "card" : "cards"}</p>
            </div>
            <div class="deck-library-card-actions">
              <button type="button" class="deck-open-button" aria-label="${isActive ? "Close" : "Open"} ${escapeHtml(deck)}" aria-pressed="${isActive}">
                ${isActive ? "Close deck" : "Open deck"}
              </button>
              <button type="button" class="deck-edit-button" aria-label="Rename ${escapeHtml(deck)}" title="Rename deck">Rename</button>
              <button type="button" class="deck-delete-button" aria-label="Delete ${escapeHtml(deck)}" title="Delete deck">Delete</button>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;

  const deckRows = list.querySelectorAll(".deck-library-card");
  deckRows.forEach((row, index) => {
    const deckName = decks[index];
    row.querySelector(".deck-open-button").addEventListener("click", () => {
      if (activeDeck === deckName) {
        activeDeck = "";
        renderDecks();
      } else {
        openDeckProfile(deckName);
      }
      list.querySelectorAll(".deck-open-button")[index]?.focus();
    });
    row.querySelector(".deck-edit-button").addEventListener("click", () => {
      renameDeck(deckName);
    });
    row.querySelector(".deck-delete-button").addEventListener("click", () => {
      deleteDeck(deckName);
    });
  });

  profile.className = "section card deck-profile";
  if (activeDeck && decks.includes(activeDeck)) {
    renderDeckProfile();
  } else {
    activeDeck = "";
    profile.style.display = "none";
    profile.innerHTML = "";
  }

  function deleteDeck(deckName) {
    const existing = document.getElementById("deleteDeckModal");

    if (existing) {
        existing.remove();
    }

    const modal = document.createElement("div");
    modal.id = "deleteDeckModal";
    modal.className = "delete-deck-modal";

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
            activeDeck = "";
        }
        saveData();
        populatePurchaseDestinations();

        closeModal();

        renderDecks();
    });
  }
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
  renderDecks();
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
    <div class="deck-profile-header">
      <div>
        <p class="deck-library-card-label">Selected deck</p>
        <h2>${escapeHtml(activeDeck)}</h2>
        <p>Organize your list, check the selected banlist, and add cards from the database.</p>
      </div>
      <span class="deck-profile-count">${entries.reduce((sum, entry) => sum + (Number(entry.qty) || 0), 0)} cards</span>
    </div>
    <div class="deck-builder-layout">
      <section class="deck-list-panel" aria-label="Cards in ${escapeHtml(activeDeck)}">
        <div class="deck-workspace-heading">
          <div><h3>Deck cards</h3><p>Drag cards to reorder them. Remove copies with the × button.</p></div>
          <span>${copies.length} ${copies.length === 1 ? "copy" : "copies"}</span>
        </div>
        <div class="deck-list-grid" id="deckCardDropZone">${copies.map(({ entry, copyId }) => {
          const card = cards.find(item => String(item.id) === String(entry.cardId)) || entry;
          const name = card?.name || entry.card || "Unknown card";
          const rarity = entry.rarity || "";
          const image = card?.image ? `<img src="${escapeHtml(card.image)}" alt="${escapeHtml(name)}" draggable="false">` : `<div class="card-image">No image</div>`;
          const copyNumber = entry.copyIds.indexOf(copyId) + 1;
          const cardLimit = Math.max(1, Math.min(3, getCardLimit(name)));
          const price = Number(
            entry.tcgCornerPrice ||
            entry.price ||
            entry.purchasePrice ||
            card?.price ||
            0
          );
          const paidPrice = entry.purchasePrice == null
            ? Number.NaN
            : Number(entry.purchasePrice);
          const paidPriceMarkup = Number.isFinite(paidPrice)
            ? `<small>Paid: ${money(paidPrice)}</small>`
            : "";
          
          return `<div class="deck-list-card" data-deck-copy-id="${escapeHtml(copyId)}" draggable="true">
            ${image}
            <span class="deck-list-quantity">${copyNumber}/${cardLimit}</span>
            <button class="deck-list-remove" title="Remove one copy" onclick="removeCardFromDeck('${escapeHtml(copyId)}')">×</button>
            <div class="deck-list-tooltip">
              <strong>${escapeHtml(name)}</strong>
              <small>${escapeHtml(card?.cardCode || entry.setCode || "")} · ${escapeHtml(rarity)} · Price: ${money(price)}</small>
              ${paidPriceMarkup}
              <div class="deck-list-tooltip-label">Card text</div>
              <p>${escapeHtml(card?.cardText || entry.cardText || "Card text unavailable.")}</p>
            </div>
          </div>`;
        }).join("") || `<div class="empty" style="grid-column:1/-1;">No cards in this deck yet.</div>`}</div>
      </section>
      <section class="deck-picker-panel" aria-labelledby="deckPickerHeading">
        <div class="deck-workspace-heading">
          <div><h3 id="deckPickerHeading">Add cards</h3><p>Search official card data, then choose the number of copies.</p></div>
        </div>
        <div class="deck-picker-controls">
          <label for="deckCardSearch">Card name
            <input id="deckCardSearch" type="search" oninput="queueDeckCardSearch()" value="${escapeHtml(deckCardSearchTerm)}" placeholder="Search cards">
          </label>
          <label for="deckCardQty">Copies
            <input id="deckCardQty" type="number" min="1" max="3" value="1">
          </label>
          <button type="button" class="btn primary deck-add-card-button" onclick="addCardToDeck()">Add selected card</button>
        </div>
        <p class="deck-picker-hint">Enter at least 2 characters to search. You can also drag a result into the deck list.</p>
        <div class="deck-card-picker" id="deckCardPicker" aria-live="polite"></div>
      </section>
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
        image: getCardImageUrl(card),

        // Full image for large previews
        imageFull: getCardImageUrl(card, false),

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

    cardDatabase = localCardDatabase;

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
    <button
      type="button"
      class="deck-card-option ${String(card.id) === String(selectedDeckCardId) ? "selected" : ""}"
      data-card-id="${escapeHtml(card.id)}"
      aria-label="Select ${escapeHtml(card.name)}"
      aria-pressed="${String(card.id) === String(selectedDeckCardId)}"
      draggable="true"
    >
      ${
        card.image
          ? `<img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}">`
          : `<div class="card-image">No image</div>`
      }
      <strong>${escapeHtml(card.name)}</strong>
      <small>${escapeHtml(card.rarity || "")} · ${escapeHtml(card.cardCode || "")}</small>
    </button>
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



function normalizeRulingCardName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

async function fetchYGOResourcesJSON(url) {
  const requestUrl = /^https?:\/\//i.test(url)
    ? url
    : `${YGORESOURCES_API}${url}`;
  if (YGORESOURCES_CACHE.has(requestUrl)) {
    return YGORESOURCES_CACHE.get(requestUrl);
  }

  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(requestUrl, {
        cache: "default",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`YGOResources returned HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  })();

  YGORESOURCES_CACHE.set(requestUrl, request);
  try {
    return await request;
  } catch (error) {
    if (YGORESOURCES_CACHE.get(requestUrl) === request) {
      YGORESOURCES_CACHE.delete(requestUrl);
    }
    throw error;
  }
}

function loadCardRulingIndex() {
  if (!cardRulingIndexPromise) {
    cardRulingIndexPromise = fetchYGOResourcesJSON(YGORESOURCES_CARD_NAME_INDEX_URL)
      .then(data => {
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("The YGOResources card-name index has an invalid format.");
        }

        const byName = new Map();
        const byId = new Map();
        Object.entries(data).forEach(([name, rawIds]) => {
          const candidates = Array.isArray(rawIds) ? rawIds : [rawIds];
          candidates.forEach(candidate => {
            const id = candidate && typeof candidate === "object"
              ? candidate.id ?? candidate.card_id ?? candidate.cardId ?? candidate.konami_id
              : candidate;
            if (id == null || !/^\d+$/.test(String(id))) return;

            const key = normalizeRulingCardName(name);
            const stringId = String(id);
            if (key && !byName.has(key)) byName.set(key, stringId);
            if (!byId.has(stringId)) byId.set(stringId, name);
          });
        });

        if (!byName.size) {
          throw new Error("The YGOResources card-name index contains no card names.");
        }
        return { byName, byId };
      })
      .catch(error => {
        cardRulingIndexPromise = null;
        throw error;
      });
  }

  return cardRulingIndexPromise;
}

function getDirectRulingCardId(card) {
  const misc = Array.isArray(card?.misc_info) ? card.misc_info[0] : card?.misc_info;
  const id = card?.konami_id || card?.konamiId || misc?.konami_id || misc?.konamiId;
  return id != null && /^\d+$/.test(String(id)) ? String(id) : null;
}

function normalizeCardRulingText(value, rulingIndex) {
  const markup = String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li)>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "");
  const decoder = document.createElement("textarea");
  decoder.innerHTML = markup;

  return decoder.value.replace(/<<\s*(\d+)\s*>>/g, (match, id) =>
    rulingIndex.byId.get(String(id)) || match
  ).trim();
}

function setRulingStatus(message, retry) {
  const container = document.getElementById("rulingStatus");
  if (!container) return;
  container.textContent = "";

  const status = document.createElement("p");
  status.className = "ruling-status-message";
  status.textContent = message;
  container.appendChild(status);

  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = "Retry";
    button.addEventListener("click", retry);
    container.appendChild(button);
  }
}

function appendRulingRecord(qaId, data, rulingIndex) {
  const container = document.getElementById("rulingEntries");
  if (!container) return;

  const translations = data?.qaData || {};
  const qa = translations.en || translations.ja || {};
  const title = normalizeCardRulingText(
    qa.title || qa.question || `Ruling ${qaId}`,
    rulingIndex
  );
  const question = normalizeCardRulingText(qa.question || "", rulingIndex);
  const answer = normalizeCardRulingText(qa.answer || "", rulingIndex);
  const entry = document.createElement("details");
  entry.className = "card-ruling-entry";
  entry.dataset.searchText = `${title} ${question} ${answer}`.toLowerCase();

  const summary = document.createElement("summary");
  summary.textContent = title || `Ruling ${qaId}`;
  entry.appendChild(summary);

  if (question) {
    const questionElement = document.createElement("p");
    questionElement.className = "card-ruling-copy";
    const label = document.createElement("strong");
    label.textContent = "Q: ";
    questionElement.append(label, document.createTextNode(question));
    entry.appendChild(questionElement);
  }

  if (answer) {
    const answerElement = document.createElement("p");
    answerElement.className = "card-ruling-copy";
    const label = document.createElement("strong");
    label.textContent = "A: ";
    answerElement.append(label, document.createTextNode(answer));
    entry.appendChild(answerElement);
  }

  container.appendChild(entry);
}

function appendRulingFact(container, label, value) {
  if (value === undefined || value === null || value === "") return;
  const row = document.createElement("div");
  row.className = "ruling-card-fact";
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = String(value);
  row.append(term, detail);
  container.appendChild(row);
}

function renderRulingCardDetails(card, data = null) {
  const details = document.getElementById("rulingCardDetails");
  const title = document.getElementById("rulingCardTitle");
  const artwork = document.getElementById("rulingCardArtwork");
  const facts = document.getElementById("rulingCardFacts");
  const effectText = document.getElementById("rulingCardEffectText");
  if (!details || !title || !artwork || !facts || !effectText) return;

  const cardData = data?.cardData?.en || {};
  const cardName = cardData.name || card.name || "Selected card";
  title.textContent = cardName;
  details.hidden = false;
  artwork.innerHTML = getCardImageMarkup(
    card,
    getCardImageUrl(card, false),
    cardName
  );
  bindCardImageFallbacks(artwork);

  facts.textContent = "";
  appendRulingFact(facts, "Type", card.type || cardData.cardType);
  appendRulingFact(facts, "Attribute", cardData.attribute || card.attribute);
  appendRulingFact(
    facts,
    "Level / Rank",
    cardData.level ?? card.level ?? card.rank
  );
  appendRulingFact(facts, "Race", card.race);
  appendRulingFact(facts, "ATK", cardData.atk ?? card.atk);
  appendRulingFact(facts, "DEF", cardData.def ?? card.def);
  effectText.textContent = cardData.effectText || getCardDescription(card);
}

function renderRulingFaq(faqData, emptyMessage) {
  const panel = document.getElementById("rulingFaqPanel");
  const container = document.getElementById("rulingFaqEntries");
  if (!panel || !container) return;

  panel.hidden = false;
  container.textContent = "";
  const groups = faqData?.entries;
  if (!groups || typeof groups !== "object" || Array.isArray(groups)) {
    const message = document.createElement("p");
    message.textContent = emptyMessage;
    container.appendChild(message);
    return;
  }

  let renderedGroups = 0;
  Object.entries(groups).forEach(([effect, entries]) => {
    if (!Array.isArray(entries)) return;
    const lines = entries.map(entry =>
      typeof entry === "string" ? entry : entry?.en || entry?.ja || ""
    ).filter(Boolean);
    if (!lines.length) return;

    const group = document.createElement("details");
    group.className = "ruling-faq-entry";
    group.open = renderedGroups === 0;
    const summary = document.createElement("summary");
    summary.textContent = `Effect ${effect}`;
    group.appendChild(summary);

    const list = document.createElement("ul");
    lines.forEach(line => {
      const item = document.createElement("li");
      item.textContent = line;
      list.appendChild(item);
    });
    group.appendChild(list);
    container.appendChild(group);
    renderedGroups += 1;
  });

  if (!renderedGroups) {
    const message = document.createElement("p");
    message.textContent = emptyMessage;
    container.appendChild(message);
  }
}

function filterRulingEntries() {
  const query = String(document.getElementById("rulingTextSearch")?.value || "")
    .trim()
    .toLowerCase();
  document.querySelectorAll("#rulingEntries .card-ruling-entry").forEach(entry => {
    entry.hidden = Boolean(query) && !entry.dataset.searchText.includes(query);
  });
}

function renderRulingCardMatches() {
  const input = document.getElementById("rulingCardSearch");
  const container = document.getElementById("rulingCardMatches");
  if (!input || !container) return;

  const query = input.value.trim().toLowerCase();
  if (!query) {
    container.textContent = "Search for a card to view its rulings.";
    return;
  }
  if (!localCardDatabaseReady) {
    container.textContent = "Loading the card database...";
    loadLocalCardDatabase()
      .then(renderRulingCardMatches)
      .catch(error => {
        console.error("Unable to load cards for ruling search:", error);
        container.textContent = "The card database could not be loaded.";
      });
    return;
  }

  const normalizedQuery = normalizeRulingCardName(query);
  const matches = localCardDatabase.filter(card => {
    const name = String(card.name || "").toLowerCase();
    const code = getPrimaryCardCode(card).toLowerCase();
    return name.includes(query) || code.includes(query);
  }).sort((a, b) => {
    const score = card => {
      const name = normalizeRulingCardName(card.name);
      if (name === normalizedQuery) return 3;
      if (name.startsWith(normalizedQuery)) return 2;
      return name.includes(normalizedQuery) ? 1 : 0;
    };
    return score(b) - score(a) ||
      String(a.name || "").localeCompare(String(b.name || ""));
  }).slice(0, 30);

  if (!matches.length) {
    container.textContent = "No cards match that name or card code.";
    return;
  }

  container.innerHTML = matches.map(card => `
    <button type="button" class="ruling-card-match" data-card-id="${escapeHtml(card.id)}">
      <strong>${escapeHtml(card.name || "Unknown card")}</strong>
      <small>${escapeHtml(getPrimaryCardCode(card) || card.type || "Card")}</small>
    </button>
  `).join("");
  container.querySelectorAll(".ruling-card-match").forEach(button => {
    button.addEventListener("click", () => {
      const card = localCardDatabase.find(item =>
        String(item.id) === button.dataset.cardId
      );
      if (card) selectRulingCard(card);
    });
  });
}

function queueRulingCardSearch() {
  clearTimeout(rulingCardSearchTimer);
  rulingCardSearchTimer = setTimeout(renderRulingCardMatches, 180);
}

async function loadSelectedCardRulings(card, token) {
  const isCurrentSelection = () =>
    token === rulingPageToken && selectedRulingCard === card;
  setRulingStatus("Finding this card in the YGOResources database...");

  try {
    const index = await loadCardRulingIndex();
    if (!isCurrentSelection()) return;

    const cardId = getDirectRulingCardId(card) ||
      index.byName.get(normalizeRulingCardName(card.name));
    if (!cardId) {
      renderRulingFaq(
        null,
        "Related FAQ entries are unavailable because this card is not mapped in YGOResources."
      );
      const summary = document.getElementById("rulingCardSummary");
      if (summary) summary.textContent = "Local card details · no YGOResources record found.";
      setRulingStatus("This card is not mapped in the YGOResources database.");
      return;
    }

    const data = await fetchYGOResourcesJSON(
      `${YGORESOURCES_CARD_URL}${encodeURIComponent(cardId)}`
    );
    if (!isCurrentSelection()) return;
    if (!data || !Array.isArray(data.qaIndex)) {
      throw new Error("The YGOResources card response has an invalid format.");
    }

    renderRulingCardDetails(card, data);
    renderRulingFaq(data.faqData, "No related FAQ entries are available for this card.");
    rulingQaIds = [...new Set(data.qaIndex.map(item => {
      const id = item && typeof item === "object"
        ? item.id ?? item.qaId ?? item.qa_id
        : item;
      return String(id ?? "");
    }).filter(id => /^\d+$/.test(id)))];
    rulingNextQaIndex = 0;
    rulingFailedQaIds = [];

    const summary = document.getElementById("rulingCardSummary");
    if (summary) {
      const code = getPrimaryCardCode(card);
      summary.textContent = [
        code,
        `${rulingQaIds.length.toLocaleString()} available ruling${rulingQaIds.length === 1 ? "" : "s"}`
      ].filter(Boolean).join(" · ");
    }

    if (!rulingQaIds.length) {
      setRulingStatus("No rulings are currently listed for this card.");
      return;
    }
    await loadMoreRulings();
  } catch (error) {
    console.error(`Unable to load YGOResources rulings for ${card.name}:`, error);
    if (!isCurrentSelection()) return;
    renderRulingFaq(null, "Related FAQ entries could not be loaded.");
    const summary = document.getElementById("rulingCardSummary");
    if (summary) summary.textContent = "Local card details · YGOResources data unavailable.";
    setRulingStatus(
      `Rulings could not be loaded. ${error.message || "Check your connection and try again."}`,
      () => loadSelectedCardRulings(card, token)
    );
  }
}

function selectRulingCard(card) {
  if (!card) return;
  selectedRulingCard = card;
  const token = ++rulingPageToken;
  rulingIsLoading = false;
  rulingQaIds = [];
  rulingNextQaIndex = 0;
  rulingFailedQaIds = [];

  const search = document.getElementById("rulingCardSearch");
  const title = document.getElementById("rulingCardTitle");
  const summary = document.getElementById("rulingCardSummary");
  const entries = document.getElementById("rulingEntries");
  const textSearch = document.getElementById("rulingTextSearch");
  const loadMore = document.getElementById("loadMoreRulings");
  if (search) search.value = card.name || "";
  if (title) title.textContent = card.name || "Selected card";
  if (summary) summary.textContent = "Loading card details and related rulings...";
  if (entries) entries.textContent = "";
  if (textSearch) textSearch.value = "";
  if (loadMore) {
    loadMore.hidden = true;
    loadMore.disabled = false;
  }

  renderRulingCardDetails(card);
  renderRulingFaq(null, "Loading related FAQ entries...");
  renderRulingCardMatches();
  loadSelectedCardRulings(card, token);
}

async function loadMoreRulings() {
  if (!selectedRulingCard || rulingIsLoading) return;
  const token = rulingPageToken;
  const retrying = rulingFailedQaIds.length > 0;
  const batch = retrying
    ? rulingFailedQaIds.splice(0, RULINGS_BATCH_SIZE)
    : rulingQaIds.slice(rulingNextQaIndex, rulingNextQaIndex + RULINGS_BATCH_SIZE);
  if (!batch.length) return;
  if (!retrying) rulingNextQaIndex += batch.length;

  const button = document.getElementById("loadMoreRulings");
  rulingIsLoading = true;
  if (button) {
    button.disabled = true;
    button.textContent = "Loading rulings...";
  }

  try {
    const results = await Promise.allSettled(batch.map(id =>
      fetchYGOResourcesJSON(`${YGORESOURCES_QA_URL}${encodeURIComponent(id)}`)
    ));
    if (token !== rulingPageToken) return;

    const index = await loadCardRulingIndex();
    if (token !== rulingPageToken) return;
    results.forEach((result, position) => {
      if (result.status === "fulfilled" &&
          result.value &&
          result.value.qaData &&
          typeof result.value.qaData === "object") {
        appendRulingRecord(batch[position], result.value, index);
      } else {
        rulingFailedQaIds.push(batch[position]);
        if (result.status === "rejected") {
          console.error(`Unable to load YGOResources Q&A ${batch[position]}:`, result.reason);
        } else {
          console.error(`YGOResources returned an invalid response for Q&A ${batch[position]}.`);
        }
      }
    });

    filterRulingEntries();
    const totalLoaded = document.querySelectorAll("#rulingEntries .card-ruling-entry").length;
    const hasMore = rulingFailedQaIds.length > 0 || rulingNextQaIndex < rulingQaIds.length;
    const remaining = Math.max(0, rulingQaIds.length - rulingNextQaIndex);
    setRulingStatus(
      `Loaded ${totalLoaded.toLocaleString()} of ${rulingQaIds.length.toLocaleString()} rulings.` +
      (rulingFailedQaIds.length
        ? ` ${rulingFailedQaIds.length} could not be loaded; use the retry button.`
        : "")
    );
    if (button) {
      button.hidden = !hasMore;
      button.disabled = false;
      button.textContent = rulingFailedQaIds.length
        ? `Retry failed rulings (${rulingFailedQaIds.length})`
        : `Load more rulings (${remaining.toLocaleString()} remaining)`;
    }
  } catch (error) {
    console.error("Unable to load more YGOResources rulings:", error);
    if (token !== rulingPageToken) return;
    rulingFailedQaIds = [...new Set([...rulingFailedQaIds, ...batch])];
    setRulingStatus(
      `Rulings could not be loaded. ${error.message || "Check your connection and try again."}`
    );
    if (button) {
      button.hidden = false;
      button.disabled = false;
      button.textContent = `Retry failed rulings (${rulingFailedQaIds.length})`;
    }
  } finally {
    if (token === rulingPageToken) rulingIsLoading = false;
  }
}

function showRulingsForCard(card) {
  showPage("rulings");
  selectRulingCard(card);
}

async function showCardDetails(card) {
  const panel = document.getElementById("cardDetailsPanel");
  if (!panel || !card) return;

  const renderToken = ++cardDetailsRenderToken;
  try {
    await loadLocalCardDatabase();
  } catch (error) {
    console.error("Unable to load card details:", error);
    showAppAlert("Card details could not be loaded. Check the local card database and try again.");
    return;
  }
  if (renderToken !== cardDetailsRenderToken) return;

  populateCardDetailsBinderOptions();
  populateCardDetailsDeckOptions();
  const deckSection = document.getElementById("cardDetailsDeckSection");
  if (deckSection) {
    deckSection.hidden =
      currentAppPage !== "decks" || !decks.includes(activeDeck);
  }
  document.getElementById("cardDetailsBinderAddNote").textContent = "";
  const printings = getCardPrintings(card);
  const detailsDisclosure = document.querySelector(".card-details-slot");
  if (detailsDisclosure) detailsDisclosure.open = false;

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

  if (setSelect) {setSelect.onchange = updateRarityOptions;}
  updateRarityOptions();

  document.getElementById("detailCardName").textContent =
    card.name || "N/A";

  document.getElementById("detailCardHeaderName").textContent =
    card.name || "Card details";

  document.getElementById("detailCardType").textContent =
    [card.type, card.archetype ? `"${card.archetype}"` : ""]
      .filter(Boolean)
      .join(" · ") || "N/A";

  document.getElementById("detailCardAtk").textContent =
    card.atk ?? "N/A";

  document.getElementById("detailCardDef").textContent =
    card.def ?? "N/A";

  document.getElementById("detailCardLevel").textContent =
    card.level ?? "N/A";

  document.getElementById("detailCardAttribute").textContent =
    card.attribute || "N/A";

  document.getElementById("detailCardRace").textContent =
    card.race || "N/A";

  document.getElementById("detailCardDescription").textContent =
    getCardDescription(card);

  const image = document.getElementById("detailCardImage");
  const imageUrl = getCardImageWithFallback(card, getCardImageUrl(card, false));

  if (imageUrl) {
    image.classList.remove("image-unavailable");
    image.src = imageUrl;
    image.alt = card.name || "";
    image.dataset.imageFallback = getCardImageFallback(card, imageUrl);
    bindCardImageFallbacks(image.parentElement);
  } else {
    image.removeAttribute("src");
    delete image.dataset.imageFallback;
    image.alt = "No image";
  }

  panel.dataset.cardId = String(card.id);
  renderCardDetailsInventory(card);
  renderCardWishlist(card);
  if (panel.hidden) pushCardDetailsHistoryState();
  const viewRulingsButton = document.getElementById("viewCardRulings");
  if (viewRulingsButton) {
    viewRulingsButton.onclick = () => showRulingsForCard(card);
  }

  panel.hidden = false;
  document.getElementById("cardDetailsBackdrop").hidden = false;
  document.getElementById("closeCardDetails")?.focus({ preventScroll: true });
}

document
  .getElementById("addDetailCardToDeck")
  ?.addEventListener("click", event => {
    event.preventDefault();

    const panel = document.getElementById("cardDetailsPanel");
    const card = localCardDatabase.find(
      item => String(item.id) === String(panel?.dataset.cardId)
    );
    if (!card) {
      showAppAlert("Card details are not ready yet. Please try again.");
      return;
    }

    const deckName = document.getElementById("detailCardDeckSelect")?.value || "";
    if (currentAppPage !== "decks" || !decks.includes(deckName)) {
      showAppAlert("Select a deck in the Deck Builder before adding this card.");
      return;
    }

    const setSelect = document.getElementById("detailCardSetSelect");
    const raritySelect = document.getElementById("detailCardRaritySelect");
    const quantityInput = document.getElementById("detailCardQuantity");
    const selectedOption = setSelect?.selectedOptions?.[0];
    if (!selectedOption || !raritySelect?.value) {
      showAppAlert("Select a valid set and rarity.");
      return;
    }

    const quantity = Math.min(
      3,
      Math.max(1, Math.floor(Number(quantityInput?.value) || 1))
    );
    const region = selectedOption.dataset.region || "TCG";
    const selectedSet = selectedOption.dataset.set || "";
    const selectedRarity = raritySelect.value;
    const printing = getCardPrintings(card).find(item =>
      item.set === selectedSet &&
      item.region === region &&
      item.rarity === selectedRarity
    );
    if (!printing) {
      showAppAlert("No matching card printing was found.");
      return;
    }

    const added = addCardEntryToDeck(
      deckName,
      card,
      quantity,
      selectedRarity,
      getTcgCornerRarity(selectedRarity),
      selectedSet,
      region
    );
    if (!added) return;

    activeDeck = deckName;
    quantityInput.value = "1";
    saveData();
    closeCardDetails();
    renderDecks();
  });

async function showCardDetailsForImage(cardId, cardName) {
  try {
    await loadLocalCardDatabase();
  } catch (error) {
    console.error("Unable to load card details:", error);
    showAppAlert("Card details could not be loaded. Check the local card database and try again.");
    return;
  }

  const normalizedName = String(cardName || "").trim().toLowerCase();
  const card = localCardDatabase.find(item => String(item.id) === String(cardId)) ||
    localCardDatabase.find(item =>
      String(item.name || "").trim().toLowerCase() === normalizedName
    );
  if (card) {
    showCardDetails(card);
  } else {
    showAppAlert("Card details are not ready yet. Please try again.");
  }
}

document.addEventListener("click", event => {
  if (!(event.target instanceof Element)) return;

  const image = event.target.closest(
    ".card-catalog-image, .collection-card-tile img, .collection-card-tile .card-image-unavailable"
  );
  if (!image) return;

  const cardContainer = image.closest("[data-card-id]");
  if (cardContainer) {
    void showCardDetailsForImage(
      cardContainer.dataset.cardId,
      cardContainer.dataset.cardName
    );
  }
});


function selectDeckCard(cardId) {
  selectedDeckCardId = cardId;
  document.querySelectorAll(".deck-card-option").forEach(tile => {
    const isSelected = tile.dataset.cardId === cardId;
    tile.classList.toggle("selected", isSelected);
    tile.setAttribute("aria-pressed", String(isSelected));
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

      event.dataTransfer.setData("text/plain", draggedDeckCopyId);

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
      const sourceTile = [...tile.parentElement.querySelectorAll(
        ".deck-list-card[data-deck-copy-id]"
      )].find(card => card.dataset.deckCopyId === draggedDeckCopyId);
      const sameRow = sourceTile && sourceTile.offsetTop === tile.offsetTop;
      const dropBefore = sameRow
        ? event.clientX < targetRect.left + targetRect.width / 2
        : event.clientY < targetRect.top + targetRect.height / 2;

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
      document.getElementById("deckCardDropZone")?.classList.remove("drop-target");

      draggedDeckCopyId = null;
    };

  });

  const dropZone = document.getElementById("deckCardDropZone");
  if (dropZone) {
    dropZone.ondragover = event => {
      if (!draggedDeckCopyId ||
          (event.target instanceof Element &&
           event.target.closest(".deck-list-card[data-deck-copy-id]"))) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      dropZone.classList.add("drop-target");
    };

    dropZone.ondragleave = event => {
      if (!dropZone.contains(event.relatedTarget)) {
        dropZone.classList.remove("drop-target");
      }
    };

    dropZone.ondrop = event => {
      if (!draggedDeckCopyId ||
          (event.target instanceof Element &&
           event.target.closest(".deck-list-card[data-deck-copy-id]"))) return;
      event.preventDefault();
      dropZone.classList.remove("drop-target");
      const order = deckCardOrder[activeDeck] || [];
      const lastCopyId = order[order.length - 1];
      if (lastCopyId) {
        reorderDeckCardCopy(draggedDeckCopyId, lastCopyId, false);
      }
      draggedDeckCopyId = null;
    };
  }
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

function addPurchasedCardToDeck(deckName, card, qty, rarity, purchasePrice) {
  const localCard = resolveDeckCard(card);
  const cardId = getDeckCardId(localCard);
  const binderNote = "\n\nThe purchase will be recorded in Binder Collection instead.";

  if (!banlistsLoaded) {
    showBanlistPopup(
      "Banlist Unavailable",
      `The banlist has not loaded, so this card was not added to the deck.${binderNote}`
    );
    return "banlist";
  }

  const cardLimit = getCardLimit(localCard?.name);
  if (cardLimit === 0) {
    showBanlistPopup(
      "Card Forbidden",
      `${localCard.name} is forbidden on the selected banlist.${binderNote}`
    );
    return "banlist";
  }

  const entries = deckCards[deckName] || [];
  const existing = entries.find(entry =>
    deckEntryMatchesCard(entry, cardId, localCard?.name)
  );
  const price = Number(purchasePrice);

  if (existing) {
    if (Number.isFinite(price) && price >= 0) {
      existing.purchasePrice = price;
      existing.price = price;
    }
    return "updated";
  }

  if (!Number.isInteger(Number(qty)) || Number(qty) < 1) {
    return "invalid";
  }
  const currentCount = getCardCountInDeck(deckName, cardId, localCard?.name);
  if (currentCount + Number(qty) > cardLimit) {
    const remaining = Math.max(0, cardLimit - currentCount);
    showBanlistPopup(
      "Deck Limit Exceeded",
      `${localCard.name} is limited to ${cardLimit} copy/copies.\n\n` +
      `Already in deck: ${currentCount}\n` +
      `You selected: ${qty}\n` +
      `You can add: ${remaining}${binderNote}`
    );
    return "banlist";
  }

  const added = addCardEntryToDeck(
    deckName,
    card,
    qty,
    rarity,
    getTcgCornerRarity(rarity),
    "",
    "",
    purchasePrice,
    binderNote
  );

  return added ? "added" : "invalid";
}


function resolveDeckCard(card) {
  const sourceId = card?.ygoProId || card?.id;
  const name = normalizeRulingCardName(card?.name);
  return localCardDatabase.find(item =>
    String(item.id) === String(sourceId) ||
    String(item.ygoProId) === String(sourceId)
  ) || (name
    ? localCardDatabase.find(item =>
        normalizeRulingCardName(item.name) === name
      )
    : null) || card;
}

function getDeckCardId(card) {
  const localCard = resolveDeckCard(card);
  return localCard?.ygoProId || localCard?.id || card?.ygoProId || card?.id;
}

function deckEntryMatchesCard(entry, cardId, cardName) {
  if (String(entry.cardId) === String(cardId)) return true;
  const name = normalizeRulingCardName(cardName);
  if (!name) return false;
  const entryCard = localCardDatabase.find(item =>
    String(item.id) === String(entry.cardId) ||
    String(item.ygoProId) === String(entry.cardId)
  );
  return normalizeRulingCardName(entry.card || entryCard?.name) === name;
}

function getCardCountInDeck(deckName, cardId, cardName = "") {

  const entries = deckCards[deckName] || [];

  return entries
    .filter(
      entry => deckEntryMatchesCard(entry, cardId, cardName)
    )
    .reduce(
      (total, entry) =>
        total + Number(entry.qty || 0),
      0
    );
}



function addCardEntryToDeck(
  deckName,
  card,
  qty,
  asianEnglishRarity = "",
  tcgCornerRarity = "",
  selectedSet = "",
  selectedRegion = "",
  purchasePrice = null,
  banlistMessageSuffix = ""
) {
  qty = Number(qty);
  if (!Number.isInteger(qty) || qty < 1) return false;

  if (!banlistsLoaded) {
    showBanlistPopup(
      "Banlist Unavailable",
      "The banlist has not loaded, so this card cannot be added to a deck yet."
    );
    return false;
  }

  const localCard = resolveDeckCard(card);
  const cardId = getDeckCardId(localCard);

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
  const purchaseSet =
    selectedSet.includes("|")
      ? selectedSet.split("|")[1]
      : selectedSet || getSetCode(card.cardCode);
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

  const currentCount = getCardCountInDeck(deckName, cardId, localCard.name);
  const cardLimit = getCardLimit(localCard.name);

  if (cardLimit === 0) {
    showBanlistPopup(
      "Card Forbidden",
      `${localCard.name} is forbidden on the selected banlist.${banlistMessageSuffix}`
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
      `You can add: ${remaining}${banlistMessageSuffix}`
    );

    return false;
  }

  const existing = entries.find(entry =>
    deckEntryMatchesCard(entry, cardId, localCard.name) &&
    String(entry.setCode || "") === String(printing.code || "") &&
    String(entry.rarity || "") === String(printing.rarity || "")
  );

  const enteredPrice = purchasePrice === null || purchasePrice === undefined || purchasePrice === ""
    ? Number.NaN
    : Number(purchasePrice);

  const entry = existing || {
    cardId,
    card: localCard.name,
    set: printing.set,
    setCode: printing.code,
    region: printing.region,
    rarity: printing.rarity,
    price: Number.isFinite(enteredPrice) && enteredPrice >= 0
      ? enteredPrice
      : getDeckCardPrice(
          localCard,
          selectedRarity,
          printing.code,
          printing.region
        ),
    purchasePrice: Number.isFinite(enteredPrice) && enteredPrice >= 0
      ? enteredPrice
      : null,
    tcgCornerPrice: null,
    cardText: localCard.cardText || localCard.desc || "",
    image: getCardImageUrl(localCard, false),
    cardCode: printing.code,
    qty: 0,
    copyIds: []
  };

  if (!existing) entries.push(entry);

  if (existing && Number.isFinite(enteredPrice) && enteredPrice >= 0) {
    existing.purchasePrice = enteredPrice;
    existing.price = enteredPrice;
  }

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
  if (!banlistsLoaded) return;
  let changed = false;
  const handledCards = new Set();
  purchases.forEach(purchase => {
    if (!purchase.destination?.startsWith("Deck: ")) return;
    const deckName = purchase.destination.slice("Deck: ".length);
    const card = cards.find(item => String(item.id) === String(purchase.cardId));
    if (!card || !decks.includes(deckName)) return;
    const localCard = resolveDeckCard(card);
    const cardId = getDeckCardId(localCard);
    const key = `${deckName}|${normalizeRulingCardName(localCard?.name) || cardId}`;
    if (handledCards.has(key)) return;
    handledCards.add(key);

    const existing = deckCards[deckName]?.find(entry =>
      deckEntryMatchesCard(entry, cardId, localCard?.name)
    );
    const previousPurchasePrice = existing?.purchasePrice;
    const previousEntryPrice = existing?.price;
    const result = addPurchasedCardToDeck(
      deckName,
      card,
      purchase.qty,
      purchase.rarity || card.rarity,
      purchase.price
    );
    if (result !== "added" && result !== "updated") {
      purchase.destination = "Binder Collection";
      purchase.deckQuantityAdded = 0;
      changed = true;
    } else {
      if (result === "added" && purchase.deckQuantityAdded == null) {
        purchase.deckQuantityAdded = Number(purchase.qty) || 0;
        changed = true;
      }
      if (
        result === "added" ||
        !existing ||
        Number(previousPurchasePrice) !== Number(purchase.price) ||
        Number(previousEntryPrice) !== Number(purchase.price)
      ) {
        changed = true;
      }
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

function getPurchaseDeckQuantity(purchase) {
  if (purchase.deckQuantityAdded == null) return Number(purchase.qty) || 0;
  return Math.max(0, Number(purchase.deckQuantityAdded) || 0);
}

function removeQuantityFromDeck(deckName, cardId, qty, cardName = "") {
  if (qty <= 0) return;
  const entry = deckCards[deckName]?.find(item =>
    deckEntryMatchesCard(item, cardId, cardName)
  );
  if (!entry) return;
  ensureEntryCopyIds(entry);
  const removedCopyIds = entry.copyIds.splice(Math.max(0, entry.copyIds.length - qty));
  entry.qty = entry.copyIds.length;
  deckCards[deckName] = deckCards[deckName].filter(item => item.copyIds.length > 0);
  deckCardOrder[deckName] = (deckCardOrder[deckName] || []).filter(id => !removedCopyIds.includes(id));
}

async function deletePurchase(purchaseId) {
  const index = purchases.findIndex(purchase => String(purchase.id) === String(purchaseId));
  if (index < 0) return;
  const purchase = purchases[index];
  if (!await showAppConfirm(`Delete the purchase of ${purchase.card}?`)) return;
  purchases.splice(index, 1);
  if (purchase.destination?.startsWith("Deck: ")) {
    removeQuantityFromDeck(
      purchase.destination.slice("Deck: ".length),
      purchase.cardId,
      getPurchaseDeckQuantity(purchase),
      purchase.card
    );
  }
  saveData();
  renderDashboard();
  renderCollection();
  renderSpending();
  renderDecks();
  const detailsPanel = document.getElementById("cardDetailsPanel");
  if (detailsPanel && !detailsPanel.hidden) {
    const detailCard = localCardDatabase.find(
      card => String(card.id) === detailsPanel.dataset.cardId
    );
    if (detailCard) renderCardDetailsInventory(detailCard);
  }
}

async function deleteCollectionGroup(
  cardId,
  printing,
  destination,
  binderId = activeBinderId
) {
  const matching = [];
  let matchingCount = 0;
  purchases.forEach((purchase, purchaseIndex) => {
    if (
      String(purchase.cardId) !== String(cardId) ||
      getPurchasePrintingLabel(purchase) !== printing
    ) return;

    const binderIds = getPurchaseCopyBinderIds(purchase);
    const destinations = getPurchaseCopyDestinations(purchase);
    const copyIndexes = binderIds.reduce((indexes, copyBinderId, copyIndex) => {
      if (copyBinderId === binderId && destinations[copyIndex] === destination) {
        indexes.push(copyIndex);
      }
      return indexes;
    }, []);
    if (copyIndexes.length) {
      matching.push({ purchase, purchaseIndex, copyIndexes });
      matchingCount += copyIndexes.length;
    }
  });
  if (!matchingCount || !await showAppConfirm(`Delete all ${matchingCount} copies of this card?`)) return;

  matching.sort((a, b) => b.purchaseIndex - a.purchaseIndex);
  matching.forEach(({ purchase, purchaseIndex, copyIndexes }) => {
    const quantity = Math.max(0, Math.floor(Number(purchase.qty) || 0));
    const total = Number(purchase.total);
    const unitTotal = getPurchaseCopyTotal(purchase, quantity || 1);
    const binderIds = getPurchaseCopyBinderIds(purchase);
    const destinations = getPurchaseCopyDestinations(purchase);

    copyIndexes.sort((a, b) => b - a).forEach(copyIndex => {
      const copyDestination = destinations[copyIndex];
      if (copyDestination.startsWith("Deck: ")) {
        const deckQuantity = Math.min(
          1,
          Math.max(0, Math.floor(getPurchaseDeckQuantity(purchase)))
        );
        if (deckQuantity) {
          removeQuantityFromDeck(
            copyDestination.slice("Deck: ".length),
            purchase.cardId,
            deckQuantity,
            purchase.card
          );
          if (purchase.deckQuantityAdded != null) {
            purchase.deckQuantityAdded = Math.max(
              0,
              Number(purchase.deckQuantityAdded) - deckQuantity
            );
          }
        }
      }
      binderIds.splice(copyIndex, 1);
      destinations.splice(copyIndex, 1);
    });

    if (copyIndexes.length >= quantity) {
      purchases.splice(purchaseIndex, 1);
      return;
    }

    purchase.qty = quantity - copyIndexes.length;
    purchase.total = Number.isFinite(total)
      ? total - unitTotal * copyIndexes.length
      : purchase.qty * (Number(purchase.price) || 0);
    purchase.copyBinderIds = binderIds;
    purchase.copyDestinations = destinations;
  });

  saveData();
  renderDashboard();
  renderCollection();
  renderSpending();
  renderDecks();
  const detailsPanel = document.getElementById("cardDetailsPanel");
  if (detailsPanel && !detailsPanel.hidden) {
    const detailCard = localCardDatabase.find(
      card => String(card.id) === detailsPanel.dataset.cardId
    );
    if (detailCard) renderCardDetailsInventory(detailCard);
  }
}

function openPurchase() {
  const select = document.getElementById("purchaseCard");
  if (!cards.length) {
    if (!tcgLoading) loadTCGProducts();
    showAppAlert("Loading the TCG Corner catalog. Please try Add Purchase again in a moment.");
    return;
  }
  populatePurchaseDestinations();
  document.getElementById("purchaseDestination").value = `binder:${activeBinderId}`;
  const groups = new Map();
  cards.forEach(card => {
    const key = `${card.sourceName || "TCG Corner"}|${card.sourceLanguage}|${card.cardCode || card.productId}`;
    if (!groups.has(key)) groups.set(key, card);
  });
  select.innerHTML = [...groups.values()].map(card => `<option value="${escapeHtml(card.id)}">${escapeHtml(card.name)} · ${escapeHtml(card.cardCode)}</option>`).join("");
  const search = document.getElementById("purchaseCardName");
  search.value = "";
  updatePurchaseCardSuggestions([]);
  document.getElementById("purchaseDate").value = new Date().toISOString().slice(0,10);
  updatePurchaseFields();
  document.getElementById("purchaseModal").classList.add("open");
  search.focus();
}

function normalizePurchaseSearchValue(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function updatePurchaseCardSuggestions(matches, showNoResults = false) {
  const input = document.getElementById("purchaseCardName");
  const container = document.getElementById("purchaseCardSuggestions");
  if (!input || !container) return;

  container.innerHTML = matches.map(card => `
    <button type="button" class="purchase-card-suggestion" role="option" aria-selected="false" data-card-id="${escapeHtml(card.id)}">
      <strong>${escapeHtml(card.name)}</strong>
      <small>${escapeHtml(card.cardCode || "Card code unavailable")} · ${escapeHtml(card.sourceName || "TCG Corner")}${card.sourceLanguage ? ` · ${escapeHtml(card.sourceLanguage)}` : ""}</small>
    </button>
  `).join("") || (showNoResults ? `<div class="purchase-card-no-results">No cards match this name or card code.</div>` : "");
  const isVisible = matches.length > 0 || showNoResults;
  container.hidden = !isVisible;
  input.setAttribute("aria-expanded", String(isVisible));
}

function selectPurchaseCard(card) {
  const option = [...document.getElementById("purchaseCard").options].find(item => {
    const optionCard = cards.find(cardItem => String(cardItem.id) === String(item.value));
    return optionCard &&
      (optionCard.sourceName || "TCG Corner") === (card.sourceName || "TCG Corner") &&
      optionCard.sourceLanguage === card.sourceLanguage &&
      (optionCard.cardCode ? optionCard.cardCode === card.cardCode : optionCard.productId === card.productId);
  });
  if (!option) return;

  document.getElementById("purchaseCard").value = option.value;
  document.getElementById("purchaseCardName").value = card.name;
  updatePurchaseCardSuggestions([]);
  updatePurchaseFields();
}

function findPurchaseCard() {
  const query = normalizePurchaseSearchValue(document.getElementById("purchaseCardName").value);
  const raritySelect = document.getElementById("purchaseRarity");
  document.getElementById("purchaseCard").value = "";
  raritySelect.innerHTML = `<option value="">Select Rarity</option>`;
  document.getElementById("purchaseCardPreview").innerHTML = `<div class="card-image">No image</div>`;
  document.getElementById("purchasePriceSource").textContent = "Price source: —";
  if (!query) {
    updatePurchaseCardSuggestions([]);
    return;
  }

  const groups = new Map();
  cards.forEach(card => {
    const name = normalizePurchaseSearchValue(card.name);
    const code = normalizePurchaseSearchValue(card.cardCode);
    if (!name.includes(query) && !code.includes(query)) return;
    const key = `${card.sourceName || "TCG Corner"}|${card.sourceLanguage}|${card.cardCode || card.productId}`;
    if (!groups.has(key)) groups.set(key, card);
  });
  const matches = [...groups.values()];
  const exactMatch = matches.find(card =>
    normalizePurchaseSearchValue(card.name) === query ||
    normalizePurchaseSearchValue(card.cardCode) === query
  );
  if (exactMatch) {
    selectPurchaseCard(exactMatch);
    return;
  }
  updatePurchaseCardSuggestions(matches.slice(0, 12), matches.length === 0);
}

document.getElementById("purchaseCardSuggestions").addEventListener("click", event => {
  const button = event.target.closest("[data-card-id]");
  if (!button) return;
  const card = cards.find(item => String(item.id) === String(button.dataset.cardId));
  if (card) selectPurchaseCard(card);
});
function getRarityVariants(card) {
  return cards.filter(item =>
    (item.sourceName || "TCG Corner") === (card.sourceName || "TCG Corner") &&
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
  document.getElementById("purchasePriceSource").textContent =
    `Price source: ${card.sourceName || "TCG Corner"}`;
  renderPurchaseCardPreview(card);
}
function renderPurchaseCardPreview(card) {
  const preview = document.getElementById("purchaseCardPreview");
  if (!preview) return;
  preview.innerHTML = getCardImageMarkup(card, card?.image, card?.name, "purchase-preview-image");
  bindCardImageFallbacks(preview);
}
document.getElementById("purchaseCard").addEventListener("change", updatePurchaseFields);
document.getElementById("purchaseRarity").addEventListener("change", updatePurchaseRarity);
function closePurchase() {
  document.getElementById("purchaseModal").classList.remove("open");
  document.body.classList.remove("purchase-from-card-details");
  if (!document.getElementById("cardDetailsPanel")?.hidden) {
    document.getElementById("addCardDetailsPurchase")
      ?.focus({ preventScroll: true });
  }
}

function getPurchasePrintingLabel(purchase) {
  const card = cards.find(item => String(item.id) === String(purchase?.cardId));
  const set = purchase?.set || getSetCode(card?.cardCode) || card?.cardCode || "Unknown set";
  const rarity = purchase?.rarity || card?.rarity || purchase?.printing || "Unknown rarity";
  return `${set} · ${rarity}`;
}

function getPurchaseSourceName(purchase) {
  const savedSource = String(purchase?.sourceName || "").trim();
  if (savedSource) return savedSource;

  const card = cards.find(item => String(item.id) === String(purchase?.cardId));
  if (card?.sourceName) return card.sourceName;

  if (/players\s*club/i.test(String(purchase?.cardId || ""))) {
    return "Players Club";
  }
  return "Unknown source";
}

function getCardDetailsPurchaseGroups(card) {
  const cardName = normalizeRulingCardName(card?.name);
  const cardId = String(card?.id ?? "");
  const groups = new Map();

  purchases.forEach(purchase => {
    const storedCard = cards.find(
      item => String(item.id) === String(purchase.cardId)
    );
    const purchaseName = normalizeRulingCardName(
      purchase.card || storedCard?.name
    );
    if (String(purchase.cardId) !== cardId && purchaseName !== cardName) return;

    const printing = getPurchasePrintingLabel(purchase);
    const quantity = Math.max(0, Math.floor(Number(purchase.qty) || 0));
    if (!quantity) return;
    const binderIds = getPurchaseCopyBinderIds(purchase);
    const destinations = getPurchaseCopyDestinations(purchase);
    const unitTotal = getPurchaseCopyTotal(purchase, quantity);

    for (let copyIndex = 0; copyIndex < quantity; copyIndex += 1) {
      const binderId = binderIds[copyIndex];
      const destination = destinations[copyIndex];
      const key = `${binderId}|${purchase.cardId}|${printing}|${destination}`;
      if (!groups.has(key)) {
        groups.set(key, {
          cardId: String(purchase.cardId),
          binderId,
          printing,
          destination,
          quantity: 0,
          total: 0,
          sourceName: getPurchaseSourceName(purchase)
        });
      }

      const group = groups.get(key);
      group.quantity += 1;
      group.total += unitTotal;
    }
  });

  return [...groups.values()];
}

function renderCardDetailsInventory(card) {
  const container = document.getElementById("cardDetailsCopies");
  if (!container) return;

  const groups = getCardDetailsPurchaseGroups(card);
  container.innerHTML = groups.length
    ? groups.map(group => `
        <article class="card-copy-row">
          <div class="card-copy-row-heading">
            <strong>${escapeHtml(group.printing)}</strong>
            <span>×${group.quantity}</span>
          </div>
          <p>${escapeHtml(group.sourceName)} · ${escapeHtml(group.destination)} · ${money(group.quantity ? group.total / group.quantity : 0)} / copy</p>
          <button
            type="button"
            class="btn"
            data-remove-copy
            data-card-id="${escapeHtml(group.cardId)}"
            data-printing="${escapeHtml(group.printing)}"
            data-destination="${escapeHtml(group.destination)}"
            data-binder-id="${escapeHtml(group.binderId)}"
            aria-label="Remove all ${group.quantity} copies of ${escapeHtml(group.printing)}">
            Clear
          </button>
        </article>
      `).join("")
    : `<p class="card-details-empty">No copies recorded yet.</p>`;
}

function renderCardWishlist(card) {
  const button = document.getElementById("toggleCardWishlist");
  const note = document.getElementById("cardDetailsWishlistNote");
  const links = document.getElementById("cardDetailsShopLinks");
  if (!button || !note || !links) return;

  const cardId = String(card?.id ?? "");
  const cardName = normalizeRulingCardName(card?.name);
  const isSaved = cardWishlist.some(entry =>
    String(entry?.id ?? "") === cardId ||
    normalizeRulingCardName(entry?.name) === cardName
  );
  button.textContent = isSaved ? "Remove from wishlist" : "Add to wishlist";
  button.setAttribute("aria-pressed", String(isSaved));

  const listings = cards.filter(item =>
    normalizeRulingCardName(item.name) === cardName &&
    Number.isFinite(Number(item.price)) &&
    Number(item.price) > 0
  );
  if (listings.length) {
    const prices = listings.map(item => Number(item.price));
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    note.textContent = `Current listings range from ${money(minPrice)} to ${money(maxPrice)} across ${listings.length} printings.`;
  } else {
    note.textContent = "Save this card to your wishlist and check supported shops for current listings.";
  }

  const query = encodeURIComponent(card?.name || "");
  links.innerHTML = `
    <a href="https://tcg-corner.com/search?q=${query}" target="_blank" rel="noopener">TCG Corner ↗</a>
    <a href="https://playersclubhk.com/en/search?q=${query}" target="_blank" rel="noopener">Players Club ↗</a>
  `;
}

function toggleCardWishlist() {
  const panel = document.getElementById("cardDetailsPanel");
  const cardId = panel?.dataset.cardId || "";
  const card = localCardDatabase.find(item => String(item.id) === cardId);
  if (!card) {
    showAppAlert("Card details are not ready yet. Please try again.");
    return;
  }

  const cardName = normalizeRulingCardName(card.name);
  const isSaved = cardWishlist.some(entry =>
    String(entry?.id ?? "") === String(card.id) ||
    normalizeRulingCardName(entry?.name) === cardName
  );
  const updatedWishlist = isSaved
    ? cardWishlist.filter(entry =>
        String(entry?.id ?? "") !== String(card.id) &&
        normalizeRulingCardName(entry?.name) !== cardName
      )
    : [...cardWishlist, {
        id: String(card.id),
        name: card.name,
        image: getCardImageWithFallback(card)
      }];

  try {
    localStorage.setItem("ygoCardWishlist", JSON.stringify(updatedWishlist));
  } catch (error) {
    console.error("Unable to save the card wishlist:", error);
    showAppAlert("Your wishlist could not be saved. Check available browser storage and try again.");
    return;
  }

  cardWishlist = updatedWishlist;
  renderCardWishlist(card);
  renderWishlist();
}

function renderWishlist() {
  const table = document.getElementById("wishlistTable");
  const count = document.getElementById("wishlistCardCount");
  const downloadButton = document.getElementById("downloadWishlistImage");
  if (!table || !count || !downloadButton) return;

  const wishlist = cardWishlist.map(entry => {
    const card = localCardDatabase.find(item =>
      String(item.id) === String(entry?.id ?? "")
    ) || localCardDatabase.find(item =>
      normalizeRulingCardName(item.name) ===
        normalizeRulingCardName(entry?.name)
    ) || {
      id: entry?.id || "",
      name: entry?.name || "Unknown card"
    };
    return { entry, card };
  }).filter(({ entry }) => entry?.name);

  count.textContent = wishlist.length.toLocaleString();
  downloadButton.disabled = wishlist.length === 0;
  table.innerHTML = wishlist.length
    ? wishlist.map(({ entry, card }) => `
        <article class="collection-card-tile wishlist-card"
                 data-card-id="${escapeHtml(String(card.id || entry.id || ""))}"
                 data-card-name="${escapeHtml(card.name)}">
          ${getCardImageMarkup(
            card,
            entry.image,
            card.name,
            "wishlist-card-image"
          )}
          <div class="collection-card-details">
            <strong>${escapeHtml(card.name)}</strong>
            <button type="button" class="btn wishlist-card-remove"
                    data-wishlist-card-id="${escapeHtml(String(entry.id || card.id || ""))}"
                    data-wishlist-card-name="${escapeHtml(entry.name)}"
                    aria-label="Remove ${escapeHtml(card.name)} from wishlist">
              Remove
            </button>
          </div>
        </article>
      `).join("")
    : `<div class="collection-empty-pocket collection-empty-message">
         <strong>Your wishlist is empty.</strong>
         <span>Open a card and choose Add to wishlist to save it here.</span>
         <button type="button" class="btn" onclick="showPage('cards')">Browse cards</button>
       </div>`;
  bindCardImageFallbacks(table);
}

document.getElementById("wishlistTable")
  ?.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("[data-wishlist-card-id]");
    if (!button) return;

    const cardId = button.dataset.wishlistCardId;
    const cardName = normalizeRulingCardName(button.dataset.wishlistCardName);
    const updatedWishlist = cardWishlist.filter(entry =>
      String(entry?.id ?? "") !== cardId &&
      normalizeRulingCardName(entry?.name) !== cardName
    );
    try {
      localStorage.setItem("ygoCardWishlist", JSON.stringify(updatedWishlist));
    } catch (error) {
      console.error("Unable to save the card wishlist:", error);
      showAppAlert("Your wishlist could not be saved. Check available browser storage and try again.");
      return;
    }

    cardWishlist = updatedWishlist;
    renderWishlist();
    const detailCard = localCardDatabase.find(item =>
      String(item.id) === cardId
    );
    if (detailCard && !document.getElementById("cardDetailsPanel")?.hidden) {
      renderCardWishlist(detailCard);
    }
  });

function addCardDetailsPurchase() {
  const cardId = document.getElementById("cardDetailsPanel")?.dataset.cardId || "";
  const card = localCardDatabase.find(item => String(item.id) === cardId);
  if (!card) {
    showAppAlert("Card details are not ready yet. Please try again.");
    return;
  }

  const name = normalizeRulingCardName(card.name);
  const purchaseCard = cards.find(
    item => normalizeRulingCardName(item.name) === name
  );
  if (!purchaseCard) {
    showAppAlert("This card is not currently listed in the purchase catalog.");
    return;
  }

  const keepCardDetailsOpen = currentAppPage === "decks";
  if (!keepCardDetailsOpen) closeCardDetails();
  openPurchaseFor(purchaseCard.id);
  if (keepCardDetailsOpen &&
      document.getElementById("purchaseModal").classList.contains("open")) {
    document.body.classList.add("purchase-from-card-details");
  }
}

function addCardDetailsToBinder() {
  const panel = document.getElementById("cardDetailsPanel");
  const card = localCardDatabase.find(
    item => String(item.id) === String(panel?.dataset.cardId || "")
  );
  if (!card) {
    showAppAlert("Card details are not ready yet. Please try again.");
    return;
  }

  const binderId = document.getElementById("cardDetailsBinderSelect")?.value;
  const binder = binders.find(item => item.id === binderId);
  if (!binder) {
    showAppAlert("Select a valid binder before adding this card.");
    return;
  }

  const setOption = document.getElementById("detailCardSetSelect")?.selectedOptions?.[0];
  const set = setOption?.dataset.set ||
    getSetCode(card.cardCode) ||
    card.cardCode ||
    "Unknown set";
  const rarity = document.getElementById("detailCardRaritySelect")?.value ||
    card.rarity ||
    "Unknown rarity";
  const destination = getBinderDestination(binder.id);
  const now = new Date();
  const date = new Date(
    now.getTime() - now.getTimezoneOffset() * 60000
  ).toISOString().slice(0, 10);
  const purchase = {
    id: Date.now(),
    cardId: card.id,
    card: card.name,
    image: getCardImageWithFallback(card),
    sourceName: "Card details",
    acquisitionType: "binder",
    printing: `${set} · ${rarity}`,
    set,
    rarity,
    destination,
    binderId: binder.id,
    copyBinderIds: [binder.id],
    copyDestinations: [destination],
    deckQuantityAdded: 0,
    qty: 1,
    price: 0,
    total: 0,
    date,
    seller: "—"
  };
  const savedPurchases = localStorage.getItem("ygoPurchases");
  purchases.unshift(purchase);
  try {
    saveData();
  } catch (error) {
    purchases.shift();
    try {
      if (savedPurchases === null) {
        localStorage.removeItem("ygoPurchases");
      } else {
        localStorage.setItem("ygoPurchases", savedPurchases);
      }
    } catch (restoreError) {
      console.error("Unable to restore collection storage after a failed binder add:", restoreError);
    }
    console.error("Unable to add a card to a binder:", error);
    showAppAlert("The card could not be added to the binder. Check available browser storage and try again.");
    return;
  }

  renderDashboard();
  renderCollection();
  renderSpending();
  renderDecks();
  renderCardDetailsInventory(card);
  document.getElementById("cardDetailsBinderAddNote").textContent =
    `Added one copy to ${binder.name}. No purchase cost was recorded.`;
}

document.getElementById("cardDetailsCopies")
  ?.addEventListener("click", event => {
    const button = event.target.closest("[data-remove-copy]");
    if (!button) return;
    void deleteCollectionGroup(
      button.dataset.cardId,
      button.dataset.printing,
      button.dataset.destination,
      button.dataset.binderId || DEFAULT_BINDER_ID
    );
  });

function savePurchase() {
  const card = cards.find(c => c.id == document.getElementById("purchaseRarity").value);
  const qty = Number(document.getElementById("purchaseQty").value);
  const price = Number(document.getElementById("purchasePrice").value);
  const destinationChoice = document.getElementById("purchaseDestination").value;
  if (!card || !Number.isInteger(qty) || qty < 1 || !Number.isFinite(price) || price < 0) {
    showAppAlert("Enter a valid card, whole-number quantity, and non-negative price.");
    return;
  }
  const selectedBinderId = destinationChoice.startsWith("binder:")
    ? destinationChoice.slice("binder:".length)
    : "";
  const binderId = binders.some(binder => binder.id === selectedBinderId)
    ? selectedBinderId
    : activeBinderId;
  const destination = getBinderDestination(binderId);
  purchases.unshift({
    id: Date.now(),
    cardId: card.id,
    card: card.name,
    image: getCardImageWithFallback(card),
    sourceName: card.sourceName || "TCG Corner",
    printing: getPurchasePrintingLabel({
      cardId: card.id,
      set: getSetCode(card.cardCode) || card.cardCode,
      rarity: card.rarity
    }),
    set: getSetCode(card.cardCode) || card.cardCode || "Unknown set",
    rarity: card.rarity || "Unknown rarity",
    destination,
    binderId,
    copyBinderIds: Array(qty).fill(binderId),
    copyDestinations: Array(qty).fill(destination),
    deckQuantityAdded: 0,
    qty,
    price,
    total: qty * price,
    date: document.getElementById("purchaseDate").value,
    seller: document.getElementById("purchaseSeller").value || "—"
  });
  saveData();
  closePurchase();
  renderDashboard();
  renderCollection();
  renderSpending();
  if (currentAppPage === "decks") {
    renderDecks();
    const detailsPanel = document.getElementById("cardDetailsPanel");
    if (detailsPanel && !detailsPanel.hidden) {
      const detailCard = localCardDatabase.find(
        item => String(item.id) === detailsPanel.dataset.cardId
      );
      if (detailCard) renderCardDetailsInventory(detailCard);
    }
  } else {
    showPage("collection");
  }
}

function collectionRows() {
  const map = {};
  purchases.forEach((p, purchaseIndex) => {
    const quantity = Math.max(0, Math.floor(Number(p.qty) || 0));
    if (!quantity) return;
    const copyBinderIds = getPurchaseCopyBinderIds(p);
    const copyDestinations = getPurchaseCopyDestinations(p);
    const unitPaid = getPurchaseCopyTotal(p, quantity);
    const printing = getPurchasePrintingLabel(p);
    const cardRecord = cards.find(
      card => String(card.id) === String(p.cardId)
    ) || localCardDatabase.find(
      card => String(card.name || "").trim().toLowerCase() ===
        String(p.card || "").trim().toLowerCase()
    );
    const set = p.set || getSetCode(cardRecord?.cardCode) ||
      cardRecord?.cardCode || "Unknown set";
    const rarity = p.rarity || cardRecord?.rarity || "Unknown rarity";

    for (let copyIndex = 0; copyIndex < quantity; copyIndex += 1) {
      const binderId = copyBinderIds[copyIndex];
      const destination = copyDestinations[copyIndex];
      const key = binderId + "|" + p.cardId + "|" + printing + "|" + destination;
      if (!map[key]) {
        map[key] = {
          binderId,
          cardId: p.cardId,
          card: p.card,
          image: p.image || "",
          printing,
          set,
          rarity,
          destination,
          qty: 0,
          paid: 0,
          latestDate: p.date || "",
          sourceCopies: []
        };
      }
      map[key].qty += 1;
      map[key].paid += unitPaid;
      map[key].sourceCopies.push({ purchaseIndex, copyIndex });
      if (String(p.date || "") > String(map[key].latestDate || "")) {
        map[key].latestDate = p.date || "";
      }
    }
  });
  return Object.values(map);
}

function getPurchaseCopyBinderIds(purchase) {
  const quantity = Math.max(0, Math.floor(Number(purchase.qty) || 0));
  const defaultBinderId = binders.some(binder => binder.id === purchase.binderId)
    ? purchase.binderId
    : DEFAULT_BINDER_ID;
  const savedBinderIds = Array.isArray(purchase.copyBinderIds)
    ? purchase.copyBinderIds
    : [];

  return Array.from({ length: quantity }, (_, index) => {
    const binderId = savedBinderIds[index];
    return binders.some(binder => binder.id === binderId)
      ? binderId
      : defaultBinderId;
  });
}

function getPurchaseCopyDestinations(purchase) {
  const quantity = Math.max(0, Math.floor(Number(purchase.qty) || 0));
  const defaultBinderId = binders.some(binder => binder.id === purchase.binderId)
    ? purchase.binderId
    : DEFAULT_BINDER_ID;
  const defaultDestination = purchase.destination || getBinderDestination(defaultBinderId);
  const savedDestinations = Array.isArray(purchase.copyDestinations)
    ? purchase.copyDestinations
    : [];

  return Array.from({ length: quantity }, (_, index) => {
    const destination = savedDestinations[index];
    return typeof destination === "string" && destination
      ? destination
      : defaultDestination;
  });
}

function getCollectionCardType(card) {
  const type = String(card?.type || "").toLowerCase();
  if (type.includes("monster")) return "Monster";
  if (type.includes("spell")) return "Spell";
  if (type.includes("trap")) return "Trap";
  return type ? "Other" : "Unknown";
}

function getSpendingPurchases() {
  return purchases.filter(purchase => purchase.acquisitionType !== "binder");
}

function renderDashboard() {
  const rows = collectionRows();
  const value = rows.reduce((s,r) => s + r.qty * (cards.find(c=>String(c.id)===String(r.cardId))?.price || 0),0);
  const spendingPurchases = getSpendingPurchases();
  const spent = spendingPurchases.reduce((s,p)=>s+p.total,0);
  document.getElementById("dashValue").textContent = money(value);
  document.getElementById("dashSpent").textContent = money(spent);
  document.getElementById("dashGain").textContent = money(value-spent);
  document.getElementById("dashCards").textContent = rows.reduce((s,r)=>s + Number(r.qty || 0), 0);
  const now = new Date();
  const month = spendingPurchases.filter(p => {
    const d = new Date(p.date);
    return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
  }).reduce((s,p)=>s+p.total,0);
  document.getElementById("monthSpent").textContent = money(month);
  document.getElementById("avgPurchase").textContent =
    money(spendingPurchases.length ? spent / spendingPurchases.length : 0);
  document.getElementById("recentPurchases").innerHTML = spendingPurchases.slice(0,5).map(p =>
    (() => {
      const marketPrice = cards.find(card => String(card.id) === String(p.cardId))?.price || 0;
      const gain = marketPrice * Number(p.qty || 0) - p.total;
      return `<tr><td>${p.date}</td><td>${p.card}</td><td>${p.qty}</td><td>${money(p.price)}</td><td>${money(marketPrice)}</td><td>${money(p.total)}</td><td class="${gain >= 0 ? "green" : "red"}">${gain >= 0 ? "+" : ""}${money(gain)}</td></tr>`;
    })()
  ).join("") || `<tr><td colspan="7" class="empty">No purchases yet.</td></tr>`;
}

function changeCollectionView() {
  collectionPage = 1;
  renderCollection();
}

function clearCollectionFilterControls() {
  const search = document.getElementById("collectionSearch");
  if (search) search.value = "";
  [
    "collectionTypeFilter",
    "collectionSetFilter",
    "collectionRarityFilter"
  ].forEach(id => {
    const select = document.getElementById(id);
    if (select) select.value = "all";
  });
}

function changeCollectionPage(offset) {
  collectionPage = Math.max(1, Math.min(collectionPageCount, collectionPage + offset));
  renderCollection();
}

function clearCollectionFilters() {
  clearCollectionFilterControls();
  changeCollectionView();
}

function renderCollection() {
  const search = document.getElementById("collectionSearch");
  const typeFilter = document.getElementById("collectionTypeFilter");
  const setFilter = document.getElementById("collectionSetFilter");
  const rarityFilter = document.getElementById("collectionRarityFilter");
  const sort = document.getElementById("collectionSort");
  const binderSelect = document.getElementById("collectionBinderSelect");
  const table = document.getElementById("collectionTable");
  const activeBinder = getActiveBinder();
  activeBinderId = activeBinder.id;
  binderSelect.innerHTML = binders.map(binder =>
    `<option value="${escapeHtml(binder.id)}">${escapeHtml(binder.name)}</option>`
  ).join("");
  binderSelect.value = activeBinder.id;
  renderBinderCover(activeBinder);

  const q = search.value.trim().toLowerCase();
  const allRows = collectionRows()
    .filter(row => row.binderId === activeBinder.id);

  const rowsWithCardData = allRows.map(row => {
    const localCard = localCardDatabase.find(
      item => String(item.name || "").trim().toLowerCase() ===
        String(row.card || "").trim().toLowerCase()
    );
    const card = cards.find(
      item => String(item.id) === String(row.cardId)
    ) || localCard;
    return {
      ...row,
      cardRecord: card,
      filterCardRecord: localCard || card,
      cardType: getCollectionCardType(localCard || card),
      market: (Number(card?.price) || 0) * row.qty
    };
  });
  populateCardFilter(
    "collectionTypeFilter",
    rowsWithCardData.map(row => row.cardType),
    "All types"
  );
  populateCardFilter(
    "collectionSetFilter",
    rowsWithCardData.map(row => row.set),
    "All sets"
  );
  populateCardFilter(
    "collectionRarityFilter",
    rowsWithCardData.map(row => row.rarity),
    "All rarities"
  );

  const selectedType = typeFilter.value;
  const selectedSet = setFilter.value;
  const selectedRarity = rarityFilter.value;
  document.getElementById("collectionClearFilters").disabled =
    !q && selectedType === "all" && selectedSet === "all" && selectedRarity === "all";
  let rows = rowsWithCardData.filter(row => {
    const searchableText = [
      row.card,
      row.printing,
      row.set,
      row.rarity,
      row.filterCardRecord?.type,
      row.filterCardRecord?.attribute,
      row.filterCardRecord?.race
    ].join(" ").toLowerCase();
    return (!q || searchableText.includes(q)) &&
      (selectedType === "all" || row.cardType === selectedType) &&
      (selectedSet === "all" || row.set === selectedSet) &&
      (selectedRarity === "all" || row.rarity === selectedRarity);
  });

  if (sort.value === "copies") {
    rows.sort((a, b) => b.qty - a.qty || a.card.localeCompare(b.card));
  } else if (sort.value === "value") {
    rows.sort((a, b) => b.market - a.market || a.card.localeCompare(b.card));
  } else if (sort.value === "recent") {
    rows.sort((a, b) =>
      String(b.latestDate || "").localeCompare(String(a.latestDate || "")) ||
      a.card.localeCompare(b.card)
    );
  } else {
    rows.sort((a, b) =>
      a.card.localeCompare(b.card) ||
      a.printing.localeCompare(b.printing) ||
      a.destination.localeCompare(b.destination)
    );
  }

  const copies = rows.flatMap(row =>
    row.sourceCopies.map(copy => ({
      ...row,
      qty: 1,
      market: Number(row.cardRecord?.price) || 0,
      ...copy
    }))
  );

  document.getElementById("collectionEntryCount").textContent =
    rows.length.toLocaleString();
  document.getElementById("collectionCopyCount").textContent =
    rows.reduce((sum, row) => sum + row.qty, 0).toLocaleString();
  document.getElementById("collectionMarketValue").textContent =
    money(rows.reduce((sum, row) => sum + row.market, 0));

  collectionPageCount = Math.max(1, Math.ceil(copies.length / COLLECTION_PAGE_SIZE));
  collectionPage = Math.min(collectionPage, collectionPageCount);
  const start = (collectionPage - 1) * COLLECTION_PAGE_SIZE;
  const visibleCopies = copies.slice(start, start + COLLECTION_PAGE_SIZE);
  const emptyLabel = allRows.length
    ? "No cards match these filters."
    : "This binder is empty.";
  const cardMarkup = visibleCopies.map(row => {
    const moveOptions = binders
      .filter(binder => binder.id !== row.binderId)
      .map(binder =>
        `<option value="${escapeHtml(binder.id)}">${escapeHtml(binder.name)}</option>`
      )
      .join("");
    return `
    <div
      class="collection-card-tile"
      data-card-id="${escapeHtml(row.cardRecord?.id || row.cardId)}"
      data-card-name="${escapeHtml(row.card)}"
    >
      ${getCardImageMarkup(
        row.cardRecord,
        row.image,
        row.card,
        "",
        cardTooltipAttributes(row.cardRecord, row.cardRecord?.rarity)
      )}
      <button
        class="collection-card-delete"
        title="Remove one copy"
        aria-label="Remove one copy of ${escapeHtml(row.card)} from collection"
        data-purchase-index="${row.purchaseIndex}"
        data-copy-index="${row.copyIndex}"
        onclick="deleteCollectionCopyFromControl(this)"
      >×</button>
      <div class="collection-card-details">
        <strong>${escapeHtml(row.card)}</strong>
        <small>${escapeHtml(row.printing)} · ${escapeHtml(row.destination)} · ${money(row.market)}</small>
        ${moveOptions ? `
          <select
            class="collection-card-move"
            aria-label="Move one copy of ${escapeHtml(row.card)} to another binder"
            data-purchase-index="${row.purchaseIndex}"
            data-copy-index="${row.copyIndex}"
            onchange="moveCollectionCopyFromControl(this)"
          >
            <option value="">Move to binder...</option>
            ${moveOptions}
          </select>
        ` : ""}
      </div>
    </div>
    `;
  });
  const emptySlots = Array.from(
    { length: COLLECTION_PAGE_SIZE - visibleCopies.length },
    (_, index) => {
      if (!rows.length && collectionPage === 1 && index === 0) {
        return `<div class="collection-empty-pocket collection-empty-message">
          <strong>${emptyLabel}</strong>
          <span>${allRows.length ? "Try a different search or location." : "Cards you add will appear here."}</span>
          ${allRows.length ? '<button type="button" class="btn" onclick="clearCollectionFilters()">Clear filters</button>' : ""}
        </div>`;
      }
      return '<div class="collection-empty-pocket" aria-hidden="true"></div>';
    }
  );
  table.innerHTML = [...cardMarkup, ...emptySlots].join("");
  bindCardImageFallbacks(table);

  const shownStart = copies.length ? start + 1 : 0;
  const shownEnd = Math.min(start + visibleCopies.length, copies.length);
  document.getElementById("collectionPageStatus").textContent =
    `Page ${collectionPage} of ${collectionPageCount} · ${shownStart}-${shownEnd} of ${copies.length}`;
  document.getElementById("collectionPreviousPage").disabled = collectionPage <= 1;
  document.getElementById("collectionNextPage").disabled =
    collectionPage >= collectionPageCount;
}

function getPurchaseCopyTotal(purchase, quantity) {
  const total = Number(purchase.total);
  return Number.isFinite(total)
    ? total / quantity
    : Number(purchase.price) || 0;
}

async function deleteCollectionCopyFromControl(button) {
  const purchaseIndex = Number(button.dataset.purchaseIndex);
  const copyIndex = Number(button.dataset.copyIndex);
  if (!Number.isInteger(purchaseIndex) || !purchases[purchaseIndex]) return;

  const purchase = purchases[purchaseIndex];
  const quantity = Math.max(0, Math.floor(Number(purchase.qty) || 0));
  if (!Number.isInteger(copyIndex) || copyIndex < 0 || copyIndex >= quantity) return;
  if (!await showAppConfirm(`Remove one copy of ${purchase.card} from this binder?`)) return;

  const total = Number(purchase.total);
  const copyTotal = getPurchaseCopyTotal(purchase, quantity);
  const copyBinderIds = getPurchaseCopyBinderIds(purchase);
  const copyDestinations = getPurchaseCopyDestinations(purchase);
  const destination = copyDestinations[copyIndex];
  const deckQuantity = destination.startsWith("Deck: ")
    ? Math.min(1, Math.max(0, Math.floor(getPurchaseDeckQuantity(purchase))))
    : 0;

  if (deckQuantity) {
    removeQuantityFromDeck(
      destination.slice("Deck: ".length),
      purchase.cardId,
      deckQuantity,
      purchase.card
    );
  }

  copyBinderIds.splice(copyIndex, 1);
  copyDestinations.splice(copyIndex, 1);
  if (quantity > 1) {
    purchase.qty = quantity - 1;
    purchase.total = Number.isFinite(total)
      ? total - copyTotal
      : purchase.qty * (Number(purchase.price) || 0);
    purchase.copyBinderIds = copyBinderIds;
    purchase.copyDestinations = copyDestinations;
    if (purchase.deckQuantityAdded != null && deckQuantity) {
      purchase.deckQuantityAdded = Math.max(
        0,
        Number(purchase.deckQuantityAdded) - deckQuantity
      );
    }
  } else {
    purchases.splice(purchaseIndex, 1);
  }

  saveData();
  renderDashboard();
  renderCollection();
  renderSpending();
  renderDecks();
  const detailsPanel = document.getElementById("cardDetailsPanel");
  if (detailsPanel && !detailsPanel.hidden) {
    const detailCard = localCardDatabase.find(
      card => String(card.id) === detailsPanel.dataset.cardId
    );
    if (detailCard) renderCardDetailsInventory(detailCard);
  }
}

function moveCollectionCopyFromControl(select) {
  const targetBinderId = select.value;
  if (!binders.some(binder => binder.id === targetBinderId)) return;
  const purchaseIndex = Number(select.dataset.purchaseIndex);
  if (!Number.isInteger(purchaseIndex) || !purchases[purchaseIndex]) return;
  const copyIndex = Number(select.dataset.copyIndex);

  const purchase = purchases[purchaseIndex];
  const quantity = Math.max(0, Math.floor(Number(purchase.qty) || 0));
  if (!Number.isInteger(copyIndex) || copyIndex < 0 || copyIndex >= quantity) return;
  const copyBinderIds = getPurchaseCopyBinderIds(purchase);
  const copyDestinations = getPurchaseCopyDestinations(purchase);
  const sourceBinderId = copyBinderIds[copyIndex];
  if (sourceBinderId === targetBinderId) return;

  copyBinderIds[copyIndex] = targetBinderId;
  if (!copyDestinations[copyIndex].startsWith("Deck: ")) {
    copyDestinations[copyIndex] = getBinderDestination(targetBinderId);
  }
  purchase.copyBinderIds = copyBinderIds;
  purchase.copyDestinations = copyDestinations;

  saveData();
  renderDashboard();
  renderCollection();
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
    bindCardImageFallbacks(matchesContainer);
    return;
  }

  const groups = new Map();
  cards.forEach(card => {
    if (!card.name.toLowerCase().includes(query) && !card.cardCode.toLowerCase().includes(query)) return;
    const key = `${card.sourceName || "TCG Corner"}|${card.sourceLanguage}|${card.cardCode || card.productId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  });
  const visibleGroups = [...groups.values()].slice(0, 30);
  const resultCards = visibleGroups.map(variants => {
    const card = variants[0];
    const rarityOptions = [...new Map(variants.map(variant => [variant.rarity, variant])).values()];
    return `<div class="spending-card-match">
      <div class="spending-card-match-identity">
        ${getCardImageMarkup(card, card.image, card.name, "spending-card-match-image")}
        <div><strong>${escapeHtml(card.name)}</strong><small>${escapeHtml(card.cardCode)} · ${escapeHtml(card.sourceLanguage || "Catalog")} · ${escapeHtml(card.sourceName || "TCG Corner")}</small></div>
      </div>
      <select onchange="updateSpendingPurchase(this)">
        ${rarityOptions.map(variant => `<option value="${escapeHtml(variant.id)}">${escapeHtml(variant.rarity)} · ${money(variant.price)}</option>`).join("")}
      </select>
      <button class="btn primary spending-add-purchase" data-card-id="${escapeHtml(card.id)}" onclick="openPurchaseFor(this.dataset.cardId)">Add Purchase</button>
    </div>`;
  }).join("");

  const resultMarkup = resultCards
    ? `<div class="spending-card-match-list">${resultCards}</div>`
    : `<div class="empty">No cards match this name or card code.</div>`;
  purchaseSearchCache.set(cacheKey, resultMarkup);
  matchesContainer.innerHTML = resultMarkup;
  bindCardImageFallbacks(matchesContainer);
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
  const spendingPurchases = getSpendingPurchases();
  const total = spendingPurchases.reduce((s,p)=>s+p.total,0);
  const now = new Date();
  const month = spendingPurchases.filter(p => {
    const d = new Date(p.date);
    return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
  }).reduce((s,p)=>s+p.total,0);
  document.getElementById("spentTotal").textContent = money(total);
  document.getElementById("spentMonth").textContent = money(month);
  document.getElementById("purchaseCount").textContent = spendingPurchases.length;
  document.getElementById("purchaseAverage").textContent =
    money(spendingPurchases.length ? total / spendingPurchases.length : 0);
  document.getElementById("purchaseTable").innerHTML = spendingPurchases.map(p =>
    (() => {
      const marketPrice = cards.find(card => String(card.id) === String(p.cardId))?.price || 0;
      const card = cards.find(item => String(item.id) === String(p.cardId)) ||
        getCardCatalogMatch({ name: p.card });
      const gain = marketPrice * Number(p.qty || 0) - p.total;
      return `<tr>
        <td>${escapeHtml(p.date || "")}</td>
        <td><div class="spending-history-card">${getCardImageMarkup(card, p.image, p.card, "spending-history-card-image")}<span>${escapeHtml(p.card)}</span></div></td>
        <td>${escapeHtml(getPurchasePrintingLabel(p))}</td>
        <td><span class="price-source-badge">${escapeHtml(getPurchaseSourceName(p))}</span></td>
        <td>${escapeHtml(p.destination || "Binder Collection")}</td>
        <td>${Number(p.qty || 0)}</td>
        <td>${money(p.price)}</td>
        <td>${money(marketPrice)}</td>
        <td>${money(p.total)}</td>
        <td class="${gain >= 0 ? "green" : "red"}">${gain >= 0 ? "+" : ""}${money(gain)}</td>
        <td>${escapeHtml(p.seller || "—")}</td>
        <td><button class="btn" onclick="deletePurchase('${escapeHtml(p.id)}')">Delete</button></td>
      </tr>`;
    })()
  ).join("") || `<tr><td colspan="12" class="empty">No purchases recorded.</td></tr>`;
  bindCardImageFallbacks(document.getElementById("purchaseTable"));
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

function getCardDescription(card) {
  return String(card?.cardText || card?.desc || "Card text unavailable.").trim();
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
  cardVisibleCount = MAX_CARD_RESULTS;
  cardRenderTimer = setTimeout(renderCards, 180);
}

function getCardSearchHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(CARD_SEARCH_HISTORY_KEY) || "[]");
    return Array.isArray(history)
      ? history.filter(term => typeof term === "string" && term.trim())
      : [];
  } catch (error) {
    console.warn("Unable to read card search history:", error);
    return [];
  }
}

function renderCardSearchHistory() {
  const historyList = document.getElementById("cardSearchHistory");
  const input = document.getElementById("cardSearch");
  if (!historyList || !input) return;
  if (!cardSearchHistoryOpen) {
    historyList.hidden = true;
    input.setAttribute("aria-expanded", "false");
    return;
  }

  const query = input.value.trim().toLowerCase();
  const savedHistory = getCardSearchHistory();
  const history = savedHistory
    .filter(term => !query || term.toLowerCase().includes(query))
    .slice(0, 6);

  if (!savedHistory.length) {
    historyList.innerHTML = "";
    historyList.hidden = true;
    input.setAttribute("aria-expanded", "false");
    return;
  }

  historyList.innerHTML = `
    <div class="card-search-history-header">
      <span class="card-search-history-heading">Recent searches</span>
      <button type="button" class="card-search-history-clear">Clear history</button>
    </div>
    ${history.length ? history.map(term => `
      <button
        type="button"
        class="card-search-history-item"
        data-search-term="${escapeHtml(term)}"
      >
        <span>${escapeHtml(term)}</span>
        <span class="card-search-history-action" aria-hidden="true">Use</span>
      </button>
    `).join("") : `<div class="card-search-history-empty">No matching searches.</div>`}
  `;
  historyList.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function clearCardSearchHistory() {
  clearTimeout(cardSearchHistoryTimer);
  try {
    localStorage.removeItem(CARD_SEARCH_HISTORY_KEY);
  } catch (error) {
    console.warn("Unable to clear card search history:", error);
    return;
  }
  renderCardSearchHistory();
}

function saveCardSearchHistory() {
  clearTimeout(cardSearchHistoryTimer);
  const input = document.getElementById("cardSearch");
  const term = String(input?.value || "").trim().replace(/\s+/g, " ");
  if (!term) return;

  const history = getCardSearchHistory().filter(
    savedTerm => savedTerm.toLowerCase() !== term.toLowerCase()
  );
  history.unshift(term);

  try {
    localStorage.setItem(
      CARD_SEARCH_HISTORY_KEY,
      JSON.stringify(history.slice(0, MAX_CARD_SEARCH_HISTORY))
    );
    if (cardSearchHistoryOpen && document.activeElement === input) {
      renderCardSearchHistory();
    }
  } catch (error) {
    console.warn("Unable to save card search history:", error);
  }
}

function queueCardSearchHistorySave() {
  clearTimeout(cardSearchHistoryTimer);
  cardSearchHistoryTimer = setTimeout(saveCardSearchHistory, 650);
}

const cardSearchInput = document.getElementById("cardSearch");
const cardSearchHistoryList = document.getElementById("cardSearchHistory");
if (cardSearchInput) {
  renderCardSearchHistory();
  cardSearchInput.addEventListener("change", saveCardSearchHistory);
  cardSearchInput.addEventListener("search", saveCardSearchHistory);
  cardSearchInput.addEventListener("blur", () => {
    saveCardSearchHistory();
    setTimeout(() => {
      cardSearchHistoryOpen = false;
      renderCardSearchHistory();
    }, 150);
  });
  cardSearchInput.addEventListener("focus", () => {
    cardSearchHistoryOpen = true;
    renderCardSearchHistory();
  });
  cardSearchInput.addEventListener("click", () => {
    cardSearchHistoryOpen = true;
    renderCardSearchHistory();
  });
  cardSearchInput.addEventListener("keydown", event => {
    if (event.key === "Enter") saveCardSearchHistory();
  });
  cardSearchInput.addEventListener("input", () => {
    cardSearchHistoryOpen = true;
    renderCardSearchHistory();
    queueCardSearchHistorySave();
  });
}
if (cardSearchHistoryList) {
  cardSearchHistoryList.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(".card-search-history-clear")) {
      clearCardSearchHistory();
      return;
    }

    const option = event.target.closest("[data-search-term]");
    if (!option || !cardSearchInput) return;

    cardSearchInput.value = option.dataset.searchTerm || "";
    cardSearchHistoryOpen = false;
    queueCardRender();
    saveCardSearchHistory();
    cardSearchInput.focus();
    cardSearchHistoryOpen = false;
    renderCardSearchHistory();
  });
}
document.addEventListener("click", event => {
  if (!(event.target instanceof Element) ||
      event.target.closest(".card-search-wrap")) return;
  cardSearchHistoryOpen = false;
  renderCardSearchHistory();
});

function populateCardFilter(selectId, values, allLabel) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const previousValue = select.value;
  const options = [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  select.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>${options
    .map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join("")}`;

  if (options.includes(previousValue)) select.value = previousValue;
}

function populateCardFilters() {
  populateCardFilter(
    "cardAttributeFilter",
    localCardDatabase.map(card => card.attribute),
    "All attributes"
  );
  populateCardFilter(
    "cardRaceFilter",
    localCardDatabase
      .filter(card => String(card.type || "").toLowerCase().includes("monster"))
      .map(card => card.race),
    "All monster types"
  );
}

function clearCardFilters() {
  const search = document.getElementById("cardSearch");
  if (search) search.value = "";
  ["cardTypeFilter", "cardAttributeFilter", "cardRaceFilter"].forEach(id => {
    const select = document.getElementById(id);
    if (select) select.value = "all";
  });
  clearTimeout(cardRenderTimer);
  cardVisibleCount = MAX_CARD_RESULTS;
  renderCards();
}

async function retryCardDatabase() {
  const grid = document.getElementById("cardGrid");
  if (grid) grid.innerHTML = `<div class="card empty" style="grid-column:1/-1;">Loading the local card database...</div>`;

  try {
    await loadLocalCardDatabase();
    populateCardFilters();
    renderCards();
  } catch (error) {
    console.error("Unable to reload the local card database:", error);
    localCardDatabaseError = error;
    renderCards();
  }
}

function loadMoreCards() {
  cardVisibleCount += MAX_CARD_RESULTS;
  renderCards();
}

function renderCards() {
  const search = document.getElementById("cardSearch");
  const grid = document.getElementById("cardGrid");
  const summary = document.getElementById("cardResultSummary");
  const loadMore = document.getElementById("loadMoreCards");
  if (!grid) return;

  if (!localCardDatabaseReady) {
    if (summary) summary.textContent = "";
    if (loadMore) loadMore.hidden = true;
    if (localCardDatabaseError) {
      grid.innerHTML = `<div class="card empty" style="grid-column:1/-1;">
        <strong>Unable to load the local card database.</strong><br><br>
        ${escapeHtml(localCardDatabaseError.message || "An unexpected error occurred.")}
        <br><br><button type="button" class="btn primary" onclick="retryCardDatabase()">Retry</button>
      </div>`;
    } else {
      grid.innerHTML = `<div class="card empty" style="grid-column:1/-1;">Loading the local card database...</div>`;
    }
    return;
  }

  const query = String(search?.value || "").trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const normalizedQuery = query.replace(/[^a-z0-9]/g, "");
  const selectedType = String(document.getElementById("cardTypeFilter")?.value || "all").toLowerCase();
  const selectedAttribute = String(document.getElementById("cardAttributeFilter")?.value || "all").toLowerCase();
  const selectedRace = String(document.getElementById("cardRaceFilter")?.value || "all").toLowerCase();

  const matchingCards = localCardDatabase.filter(card => {
    const type = String(card.type || "").toLowerCase();
    if (selectedType !== "all" && !type.includes(selectedType)) return false;
    if (selectedAttribute !== "all" && String(card.attribute || "").toLowerCase() !== selectedAttribute) return false;
    if (selectedRace !== "all" &&
        (!type.includes("monster") || String(card.race || "").toLowerCase() !== selectedRace)) return false;

    if (!terms.length) return true;

    const cardSets = Array.isArray(card.card_sets) ? card.card_sets : [];
    const printings = [
      ...cardSets,
      ...(Array.isArray(card.asian_english_sets) ? card.asian_english_sets : []),
      ...(Array.isArray(card.ocg_sets) ? card.ocg_sets : [])
    ];
    const searchableText = [
      card.name,
      card.desc,
      card.type,
      card.race,
      card.attribute,
      card.archetype,
      card.id,
      card.konami_id,
      getPrimaryCardCode(card),
      ...printings.flatMap(printing => [
        printing.set_name,
        printing.set_code,
        printing.card_code,
        printing.setName,
        printing.code,
        printing.rarity
      ])
    ].filter(Boolean).join(" ").toLowerCase();

    return terms.every(term => searchableText.includes(term));
  }).sort((a, b) => {
    const getNameMatchScore = card => {
      if (!normalizedQuery) return 0;
      const name = String(card.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (name === normalizedQuery) return 3;
      if (name.startsWith(normalizedQuery)) return 2;
      return name.includes(normalizedQuery) ? 1 : 0;
    };

    return getNameMatchScore(b) - getNameMatchScore(a) ||
      String(a.name || "").localeCompare(String(b.name || ""));
  });

  const visibleCards = matchingCards.slice(0, cardVisibleCount);
  if (summary) {
    summary.textContent = matchingCards.length
      ? `Showing ${visibleCards.length.toLocaleString()} of ${matchingCards.length.toLocaleString()} cards`
      : "No cards match the selected search and filters.";
  }

  grid.innerHTML = visibleCards.map(card => {
    const imageUrl = getCardImageUrl(card);
    const cardCode = getPrimaryCardCode(card);
    const metadata = [card.type, card.attribute, card.race]
      .filter(Boolean)
      .join(" · ");

    return `<article class="card card-catalog-item">
      <div
        class="card-image card-catalog-image"
        data-card-id="${escapeHtml(card.id)}"
        data-card-name="${escapeHtml(card.name)}"
      >
        ${getCardImageMarkup(
          card,
          imageUrl,
          card.name
        )}
      </div>
      <div class="deck-list-tooltip card-catalog-tooltip">
        <strong>${escapeHtml(card.name || "Unknown card")}</strong>
        <small>${escapeHtml([cardCode, card.rarity].filter(Boolean).join(" · ") || card.type || "Card")}</small>
        <div class="deck-list-tooltip-label">Card text</div>
        <p>${escapeHtml(getCardDescription(card))}</p>
      </div>
      <div class="card-catalog-info">
        <strong>${escapeHtml(card.name)}</strong>
        <small>${escapeHtml(metadata || "Card details unavailable")}</small>
        ${cardCode ? `<small class="card-catalog-code">${escapeHtml(cardCode)}</small>` : ""}
        <button type="button" class="btn primary card-catalog-details" data-card-id="${escapeHtml(card.id)}">View details</button>
      </div>
    </article>`;
  }).join("") || `<div class="card empty" style="grid-column:1/-1;">No cards match the selected search and filters.</div>`;

  grid.querySelectorAll(".card-catalog-details").forEach(button => {
    button.addEventListener("click", () => {
      const card = localCardDatabase.find(item => String(item.id) === button.dataset.cardId);
      if (card) showCardDetails(card);
    });
  });
  bindCardImageFallbacks(grid);

  if (loadMore) {
    loadMore.hidden = visibleCards.length >= matchingCards.length;
    loadMore.textContent = `Show more cards (${Math.min(MAX_CARD_RESULTS, matchingCards.length - visibleCards.length).toLocaleString()})`;
  }
}

function updateCardSource(select) {
  const selectedCard = cards.find(
    item => String(item.id) === String(select.value)
  );
  if (!selectedCard) return;

  const sourceId = select.dataset.source;
  const cardItem = select.closest(".card-item");
  const priceElement = cardItem.querySelector(`[data-source-price="${sourceId}"]`);
  const purchaseButton = cardItem.querySelector(`.card-purchase[data-source="${sourceId}"]`);

  if (priceElement) priceElement.textContent = money(selectedCard.price);
  if (purchaseButton) purchaseButton.dataset.cardId = selectedCard.id;
}

function getCardCatalogGroupKey(card) {
  const code = String(card?.cardCode || "").trim().toLowerCase();
  if (code) return `code|${code}`;
  return `name|${String(card?.name || card?.productId || "").trim().toLowerCase()}`;
}

function updateCardRarity(select) {
  const card = cards.find(
    item => String(item.id) === String(select.value)
  );

  if (!card) return;

  const cardItem = select.closest(".card-item");

  cardItem.querySelector(".card-price").textContent = money(card.price);
  cardItem.querySelector(".card-stock").textContent =
    `${card.available ? "In stock" : "Out of stock"} · ${escapeHtml(card.sourceName || "TCG Corner")}`;

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
    return optionCard &&
      (optionCard.sourceName || "TCG Corner") === (selectedCard.sourceName || "TCG Corner") &&
      optionCard.sourceLanguage === selectedCard.sourceLanguage &&
      (optionCard.cardCode ? optionCard.cardCode === selectedCard.cardCode : optionCard.productId === selectedCard.productId);
  });
  if (cardOption) document.getElementById("purchaseCard").value = cardOption.value;
  document.getElementById("purchaseCardName").value = selectedCard.name;
  updatePurchaseFields();
  document.getElementById("purchaseRarity").value = selectedCard.id;
  updatePurchaseRarity();
}

async function loadCollectionProducts(feed) {
  const pages = new Array(MAX_TCG_FEED_PAGES);
  let nextPage = 1;
  const worker = async () => {
    while (nextPage <= MAX_TCG_FEED_PAGES) {
      const page = nextPage++;
      let response;
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
          response = await fetch(`${feed.url}&page=${page}&_=${Date.now()}`, {
            headers: { "Accept": "application/json" },
            cache: "no-store",
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeout);
        }
        if (response.status !== 429 || attempt === 1) break;
        const retryAfter = Number(response.headers.get("Retry-After")) || 1;
        await new Promise(resolve => setTimeout(resolve, Math.min(retryAfter * 1000, 5000)));
      }
      if (!response?.ok) {
        if (page === 1) throw new Error(`TCG Corner returned HTTP ${response?.status || "a network error"} for the ${feed.language} collection.`);
        continue;
      }
      const data = await response.json();
      pages[page - 1] = Array.isArray(data.products) ? data.products : [];
    }
  };

  await Promise.all(Array.from({ length: 4 }, worker));
  const products = [];
  const seen = new Set();
  for (const pageProducts of pages) {
    if (!pageProducts?.length) break;
    pageProducts.forEach(product => {
      if (!seen.has(String(product.id))) {
        seen.add(String(product.id));
        products.push(product);
      }
    });
    if (pageProducts.length < 250) break;
  }
  return products.map(product => ({ ...product, sourceLanguage: feed.language }));
}

async function loadTCGProducts(forceRefresh = false, backgroundRefresh = false, japaneseOnly = false) {
  const hadCatalog = cards.length > 0;
  tcgLoading = !hadCatalog;
  tcgError = "";
  if (!hadCatalog) renderCards();

  if (!forceRefresh) {
    const bakedProducts = await loadBakedTCGPriceCatalog();
    const playersClubProducts = await loadPlayersClubProducts(false);
    const cachedProducts = bakedProducts ? null : await getCachedTCGProducts();
    const tcgProducts = bakedProducts || cachedProducts;
    if (tcgProducts || playersClubProducts) {
      finishTCGProductLoad(
        [...(tcgProducts || []), ...(playersClubProducts || [])],
        false
      );
      if (isPlayersClubCacheStale()) void refreshPlayersClubProducts(true);
      if (!bakedProducts && await isTCGCacheStale()) void loadTCGProducts(true, true);
      if (bakedProducts) void loadTCGProducts(true, true, true);
      return;
    }
  }

  if (!forceRefresh) {
    const cachedProducts = await getCachedTCGProducts();
    if (cachedProducts) {
      finishTCGProductLoad(cachedProducts, false);
      if (await isTCGCacheStale()) void loadTCGProducts(true, true);
      return;
    }
  }

  try {
    let products;
    let playersClubProducts;
    const bakedTCGProducts = await loadBakedTCGPriceCatalog();
    try {
      [products, playersClubProducts] = await Promise.all([
        Promise.all((japaneseOnly
          ? TCG_FEEDS.filter(feed => feed.language === "Japanese")
          : TCG_FEEDS).map(loadCollectionProducts)).then(items => items.flat()),
        loadPlayersClubProducts(true)
      ]);
    } catch (collectionError) {
      const response = await fetch(TCG_GLOBAL_FEED, { headers: { "Accept": "application/json" } });
      if (!response.ok) throw collectionError;
      const data = await response.json();
      products = (Array.isArray(data.products) ? data.products : []).map(product => ({
        ...product,
        sourceLanguage: ""
      }));
      playersClubProducts = await loadPlayersClubProducts(false) || [];
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

    const nextCards = ygoProducts.flatMap(product => {
      const variants = Array.isArray(product.variants) && product.variants.length
        ? product.variants
        : [{ id: `${product.id}-default`, title: "Default", price: "0", available: false }];

      const image = product.images?.[0]?.src || "";

      return variants.filter(variant => {
        const listingText = [product.title, variant.title || "", product.body_html || ""].join(" ");
        return isAllowedLanguage(product, variant) && !/\(\s*Status\s*[A-Za-z]\s*\)/i.test(listingText);
      }).map(variant => ({
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
        storePrice: Number(variant.price || 0),
        storeCurrency: product.sourceLanguage === "Japanese" ? "PHP" : "USD",
        sourceName: "TCG Corner",
        available: Boolean(variant.available),
        image,
        sourceLanguage: product.sourceLanguage,
        tags: Array.isArray(product.tags) ? product.tags.join(" ") : "",
        url: product.handle ? `https://tcg-corner.com/products/${product.handle}` : ""
      }));
    });
    const previousCards = await getCachedTCGProducts();
    let completeTCGCards = nextCards;
    if (!japaneseOnly && previousCards && previousCards.length >= 100 &&
        nextCards.length < previousCards.length * 0.85) {
      console.warn(
        `Sync returned only ${nextCards.length} cards; keeping the previous complete catalog.`
      );
      completeTCGCards = previousCards;
    }

    finishTCGProductLoad([
      ...(bakedTCGProducts || []),
      ...(completeTCGCards || []),
      ...(playersClubProducts || [])
    ]);
  } catch (error) {
    const bakedProducts = await loadBakedTCGPriceCatalog();
    const playersClubProducts = await loadPlayersClubProducts(false);
    if (bakedProducts || playersClubProducts) {
      finishTCGProductLoad(
        [...(bakedProducts || []), ...(playersClubProducts || [])],
        false
      );
      console.warn("Live TCG Corner sync failed; static catalog retained.", error);
      return;
    }
    tcgLoading = false;
    tcgError = backgroundRefresh ? "" : error.message || "The browser could not fetch the feed.";
    if (backgroundRefresh) console.warn("Background TCG Corner refresh failed:", error);
    renderCards();
  }
}

function getPlayersClubRarity(value) {
  const normalized = String(value || "").trim().toUpperCase();
  const rarityMap = {
    UTR: "UtR",
    UT: "UtR",
    UL: "UtR",
    SER: "ScR",
    SE: "ScR",
    PSER: "PScR",
    PSE: "PScR",
    QSER: "QCSR",
    QSE: "QCSR",
    QCSER: "QCSR",
    QCSE: "QCSR",
    SR: "SR",
    UR: "UR",
    R: "R",
    C: "C",
    CR: "CR",
    ESR: "ExSR",
    ESER: "ExSR",
    ESE: "ExSR",
    EXSER: "ExSR",
    OSER: "OSER"
  };
  return rarityMap[normalized] || TCGC_RAR[normalized] ||
    TCGC_RAR[String(value || "").trim()] || (normalized ? "" : "C");
}

function parsePlayersClubTitle(rawTitle, region = "AE") {
  const codeRegion = region === "OCG" ? "JP" : "AE";
  const match = String(rawTitle || "").match(new RegExp(`^\\s*([A-Z0-9]{2,8}-${codeRegion}[A-Z0-9]{2,4})\\s*(.*)$`, "i"));
  if (!match) return null;

  const code = match[1].toUpperCase();
  const unsupportedRarity = /\(\s*(?:[A-Z]{1,5}\s*\/\s*)+[A-Z]{1,5}\s*\)|\(\s*(?:NPR|AA)\s*\)/i;
  if (unsupportedRarity.test(match[2])) return null;
  const rarityMatch = match[2].match(/\(\s*(UTR|UT|UL|SER|SE|PSER|PSE|QSER|QSE|QCSER|QCSE|SR|UR|R|C)\s*\)/i);
  const rarity = rarityMatch ? getPlayersClubRarity(rarityMatch[1]) : "";
  const name = match[2].replace(/\(\s*(?:UTR|UT|UL|SER|SE|PSER|PSE|QSER|QSE|QCSER|QCSE|SR|UR|R|C)\s*\)/ig, "")
    .replace(/\s+/g, " ").trim();

  return { code, name, rarity };
}

async function loadLivePlayersClubProducts(feed) {
  const products = [];
  const seen = new Set();

  for (let page = 1; page <= MAX_PLAYERS_CLUB_PAGES; page++) {
    const response = await fetch(`${feed.url}${page}&_=${Date.now()}`, {
      headers: { "Accept": "application/json" },
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Players Club ${feed.region} returned HTTP ${response.status}.`);

    const data = await response.json();
    const pageProducts = Array.isArray(data.products) ? data.products : [];
    const newProducts = pageProducts.filter(product => !seen.has(String(product.id)));
    newProducts.forEach(product => seen.add(String(product.id)));
    products.push(...newProducts);
    if (pageProducts.length < 250 || newProducts.length === 0) break;
  }

  const normalized = products.flatMap((product, index) => {
    const parsed = parsePlayersClubTitle(product.title, feed.region);
    if (!parsed) return [];
    const variants = Array.isArray(product.variants) && product.variants.length
      ? product.variants
      : [{ id: `${product.id}-default`, title: "Default Title", price: "0", available: false }];

    return variants.flatMap(variant => {
      const variantTitle = String(variant.title || "").trim();
      const isBaseVariant = !variantTitle || /^default title$/i.test(variantTitle);
      const hasMultipleRarities = /\b[A-Z]{1,5}\s*\/\s*[A-Z]{1,5}\b/i.test(variantTitle);
      const rarity = isBaseVariant ? parsed.rarity : getPlayersClubRarity(variantTitle);
      const price = Number(variant.price);
      if (hasMultipleRarities || !Number.isFinite(price) || price <= 0) return [];

      return [{
        id: `playersclub-live-${product.id}-${variant.id || index}`,
        productId: `playersclub-live-${product.id}`,
        sourceName: "Players Club",
        sourceLanguage: feed.region === "OCG" ? "Japanese" : "Asian English",
        cardCode: parsed.code,
        name: parsed.name || parsed.code,
        variantTitle: rarity || "Unspecified rarity",
        rarity,
        storePrice: price,
        storeCurrency: "HKD",
        available: variant.available !== false,
        image: product.images?.[0]?.src || "",
        tags: `${feed.region} Players Club`,
        url: product.handle ? `https://playersclubhk.com/en/products/${product.handle}` : ""
      }];
    });
  }).filter(Boolean);

  return normalized;
}

function getCachedPlayersClubProducts() {
  try {
    const cached = JSON.parse(localStorage.getItem(PLAYERS_CLUB_CACHE_KEY) || "null");
    return Array.isArray(cached?.cards) && cached.cards.length ? cached.cards : null;
  } catch (error) {
    console.warn("Unable to read Players Club cache:", error);
    return null;
  }
}

function isPlayersClubCacheStale() {
  try {
    const cached = JSON.parse(localStorage.getItem(PLAYERS_CLUB_CACHE_KEY) || "null");
    if (!Array.isArray(cached?.cards) || !cached.cards.some(card => card.sourceLanguage === "Japanese")) {
      return true;
    }
    return !cached?.savedAt || Date.now() - Date.parse(cached.savedAt) >= PLAYERS_CLUB_CACHE_TTL;
  } catch (error) {
    return true;
  }
}

async function refreshPlayersClubProducts(backgroundRefresh = false) {
  if (playersClubRefreshPromise) return playersClubRefreshPromise;
  const feeds = [
    { url: PLAYERS_CLUB_PRODUCTS_URL, region: "AE" },
    { url: PLAYERS_CLUB_OCG_PRODUCTS_URL, region: "OCG" }
  ];
  playersClubRefreshPromise = Promise.allSettled(feeds.map(loadLivePlayersClubProducts))
    .then(results => {
      const products = results
        .filter(result => result.status === "fulfilled")
        .flatMap(result => result.value);
      if (!products.length) {
        const failure = results.find(result => result.status === "rejected");
        throw failure?.reason || new Error("Players Club returned no usable listings.");
      }
      return products;
    })
    .then(products => {
      localStorage.setItem(PLAYERS_CLUB_CACHE_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        cards: products
      }));
      return products;
    })
    .then(products => {
      if (backgroundRefresh && Array.isArray(products)) {
        const currentTCGProducts = cards.filter(card => card.sourceName !== "Players Club");
        return loadPlayersClubProducts(false).then(catalogProducts => {
          finishTCGProductLoad([
            ...currentTCGProducts,
            ...mergePlayersClubPriceProducts(catalogProducts || [], products)
          ], false);
          return products;
        });
      }
      return products;
    })
    .catch(error => {
      if (!backgroundRefresh) console.warn("Live Players Club sync failed:", error);
      const cached = getCachedPlayersClubProducts();
      if (cached) return cached;
      return Promise.all([
        loadBakedPlayersClubPriceCatalog("AE"),
        loadBakedPlayersClubPriceCatalog("OCG")
      ]).then(catalogs => catalogs.flatMap(catalog => catalog || []));
    })
    .finally(() => { playersClubRefreshPromise = null; });
  return playersClubRefreshPromise;
}

async function loadPlayersClubProducts(forceRefresh = false) {
  const products = [];
  const [aeBaked, ocgBaked] = await Promise.all([
    loadBakedPlayersClubPriceCatalog("AE"),
    loadBakedPlayersClubPriceCatalog("OCG")
  ]);
  products.push(...(aeBaked || []), ...(ocgBaked || []));

  const cached = forceRefresh ? null : getCachedPlayersClubProducts();
  const liveProducts = forceRefresh
    ? await refreshPlayersClubProducts(false)
    : (cached || []);
  products.push(...liveProducts);

  return mergePlayersClubPriceProducts(products);
}

function mergePlayersClubPriceProducts(...groups) {
  const seen = new Set();
  return groups.flat().filter(product => {
    const key = [
      getDeckPriceProductRegion(product),
      String(product.cardCode || "").trim().toUpperCase(),
      normalizeDeckPriceRarity(product.rarity || product.variantTitle)
    ].join("|");
    if (!product.cardCode || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadBakedPlayersClubPriceCatalog(region = "AE") {
  const isOcg = region === "OCG";
  if (isOcg && bakedPlayersClubOcgPriceCatalogPromise) return bakedPlayersClubOcgPriceCatalogPromise;
  if (!isOcg && bakedPlayersClubPriceCatalogPromise) return bakedPlayersClubPriceCatalogPromise;

  const priceFile = isOcg ? PLAYERS_CLUB_OCG_PRICE_FILE : PLAYERS_CLUB_PRICE_FILE;
  const catalogPromise = fetch(priceFile, {
    headers: { "Accept": "application/json" }
  })
    .then(response => {
      if (!response.ok) return null;
      return response.json();
    })
    .then(data => {
      if (!Array.isArray(data?.rows) || !data.rows.length) return null;

      const cardsByCode = new Map();
      localCardDatabase.forEach(card => {
        getCardPrintings(card).forEach(printing => {
          cardsByCode.set(String(printing.code || "").toUpperCase(), card);
        });
      });

      return data.rows.map((row, index) => {
        const code = String(row[0] || "").toUpperCase();
        const parsed = parsePlayersClubTitle(`${code} ${row[2] || ""}`, region);
        const card = cardsByCode.get(code);
        const price = Number(row[1]);
        const condition = String(row[4] || "").trim();
        if (!code || !row[2] || !Number.isFinite(price) || condition) return null;
        const sourceRarity = String(row[3] || "").trim();
        const rarity = /^default title$/i.test(sourceRarity)
          ? ""
          : (getPlayersClubRarity(sourceRarity) || parsed?.rarity || "");
        const displayName = card?.name || parsed?.name || String(row[2]);

        return {
          id: `playersclub-baked-${region}-${index}-${code}`,
          productId: `playersclub-baked-${region}-${code}`,
          sourceName: "Players Club",
          sourceLanguage: isOcg ? "Japanese" : "Asian English",
          priceRegion: region,
          cardCode: code,
          name: displayName,
          variantTitle: rarity || "Unspecified rarity",
          rarity,
          cardText: card?.cardText || card?.desc || "",
          storePrice: price,
          storeCurrency: data.currency || "HKD",
          available: Boolean(row[5]),
          image: card?.image || "",
          tags: `${region} Players Club`,
          url: ""
        };
      }).filter(Boolean);
    })
    .catch(error => {
      console.info("No baked Players Club price file available; using live catalog.", error);
      return null;
    });

  if (isOcg) bakedPlayersClubOcgPriceCatalogPromise = catalogPromise;
  else bakedPlayersClubPriceCatalogPromise = catalogPromise;
  return catalogPromise;
}

function openTCGCornerCacheDatabase() {
  if (!window.indexedDB) {
    return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
  }
  if (tcgCornerCacheDatabasePromise) return tcgCornerCacheDatabasePromise;

  tcgCornerCacheDatabasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(TCG_CORNER_CACHE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(TCG_CORNER_CACHE_STORE_NAME)) {
        database.createObjectStore(TCG_CORNER_CACHE_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => {
      reject(request.error || new Error("Unable to open the TCG Corner cache."));
    };
  }).catch(error => {
    tcgCornerCacheDatabasePromise = null;
    throw error;
  });

  return tcgCornerCacheDatabasePromise;
}

function readTCGCornerCacheRecord(database) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(TCG_CORNER_CACHE_STORE_NAME, "readonly");
    const request = transaction.objectStore(TCG_CORNER_CACHE_STORE_NAME)
      .get(TCG_CORNER_CACHE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => {
      reject(request.error || new Error("Unable to read the TCG Corner cache."));
    };
  });
}

function writeTCGCornerCacheRecord(database, cacheData) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(TCG_CORNER_CACHE_STORE_NAME, "readwrite");
    transaction.objectStore(TCG_CORNER_CACHE_STORE_NAME).put({
      ...cacheData,
      key: TCG_CORNER_CACHE_KEY
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      reject(transaction.error || new Error("Unable to write the TCG Corner cache."));
    };
    transaction.onabort = () => {
      reject(transaction.error || new Error("The TCG Corner cache write was aborted."));
    };
  });
}

async function getTCGCornerCacheData() {
  let database = null;
  try {
    database = await openTCGCornerCacheDatabase();
    const cached = await readTCGCornerCacheRecord(database);
    if (Array.isArray(cached?.cards) && cached.cards.length) return cached;
  } catch (error) {
    console.warn("Unable to read the TCG Corner IndexedDB cache:", error);
  }

  let legacyCache = null;
  try {
    legacyCache = JSON.parse(localStorage.getItem(TCG_CORNER_CACHE_KEY) || "null");
  } catch (error) {
    console.warn("Unable to read the legacy TCG Corner cache:", error);
  }

  if (Array.isArray(legacyCache?.cards) && legacyCache.cards.length && database) {
    try {
      await writeTCGCornerCacheRecord(database, legacyCache);
      localStorage.removeItem(TCG_CORNER_CACHE_KEY);
    } catch (error) {
      console.warn("Unable to migrate the TCG Corner cache to IndexedDB:", error);
    }
  }

  return Array.isArray(legacyCache?.cards) && legacyCache.cards.length
    ? legacyCache
    : null;
}

async function getCachedTCGProducts() {
  const cached = await getTCGCornerCacheData();
  return Array.isArray(cached?.cards) && cached.cards.length
    ? cached.cards.map(card => ({
        ...card,
        sourceName: card.sourceName || "TCG Corner",
        tags: card.tags || "",
        cardText: card.cardText || "",
        price: card.storeCurrency
          ? convertStorePrice(card.storePrice ?? card.price, card.storeCurrency)
          : Number(card.price || 0)
      }))
    : null;
}

async function loadBakedTCGPriceCatalog() {
  if (bakedTCGPriceCatalogPromise) return bakedTCGPriceCatalogPromise;

  bakedTCGPriceCatalogPromise = fetch(BAKED_TCG_PRICES_FILE, {
    headers: { "Accept": "application/json" }
  })
    .then(response => {
      if (!response.ok) return null;
      return response.json();
    })
    .then(data => {
      if (!Array.isArray(data?.rows) || !data.rows.length) return null;

      const cardsByCode = new Map();
      localCardDatabase.forEach(card => {
        getCardPrintings(card).forEach(printing => {
          cardsByCode.set(String(printing.code || "").toUpperCase(), card);
        });
      });

      const products = data.rows.map((row, index) => {
        const code = String(row[0] || "").toUpperCase();
        const card = cardsByCode.get(code);
        const price = Number(row[1]);
        const condition = String(row[4] || "").trim();
        if (!code || !row[2] || !Number.isFinite(price) || condition) return null;

        return {
          id: `baked-${index}-${code}`,
          productId: `baked-${code}`,
          cardCode: code,
          name: String(row[2]),
          variantTitle: String(row[3] || "Default"),
          rarity: String(row[3] || "Other"),
          cardText: card?.cardText || card?.desc || "",
          sourceName: "TCG Corner",
          sourceLanguage: "Asian English",
          priceRegion: "AE",
          storePrice: price,
          storeCurrency: data.currency || "USD",
          available: Boolean(row[5]),
          image: card?.image || "",
          tags: "Asian English TCG Corner",
          url: ""
        };
      }).filter(Boolean);

      return products.length ? products : null;
    })
    .catch(error => {
      console.info("No baked TCG Corner price file available; using live catalog.", error);
      return null;
    });

  return bakedTCGPriceCatalogPromise;
}

async function isTCGCacheStale() {
  const cached = await getTCGCornerCacheData();
  const savedAt = Date.parse(cached?.savedAt || "");
  return !Number.isFinite(savedAt) || Date.now() - savedAt >= 30 * 24 * 60 * 60 * 1000;
}

async function cacheTCGProducts(products) {
  try {
    const compactProducts = products.map(product => ({
      id: product.id,
      productId: product.productId,
      sourceName: product.sourceName || "TCG Corner",
      cardCode: product.cardCode,
      name: product.name,
      variantTitle: product.variantTitle,
      rarity: product.rarity,
      price: product.price,
      storePrice: product.storePrice,
      storeCurrency: product.storeCurrency,
      available: product.available,
      image: product.image,
      tags: product.tags || "",
      url: product.url
    }));

    const cacheData = {
      savedAt: new Date().toISOString(),
      cards: compactProducts
    };

    const json = JSON.stringify(cacheData);

    console.log(
      `TCG Corner cache size: ${(json.length / 1024 / 1024).toFixed(2)} MB`
    );

    const database = await openTCGCornerCacheDatabase();
    await writeTCGCornerCacheRecord(database, cacheData);
    try {
      localStorage.removeItem(TCG_CORNER_CACHE_KEY);
    } catch (error) {
      console.warn("Unable to remove the legacy TCG Corner cache:", error);
    }
  } catch (error) {
    console.warn("Unable to save the TCG Corner cache to IndexedDB:", error);
  }
}

function finishTCGProductLoad(products, shouldCache = true) {
  const bakedTCGCards = products.filter(card =>
    (card.sourceName || "TCG Corner") === "TCG Corner" &&
    String(card.id || "").startsWith("baked-")
  );
  if (bakedTCGCards.length > 100) {
    const liveTCGCards = products.filter(card =>
      (card.sourceName || "TCG Corner") === "TCG Corner" &&
      !String(card.id || "").startsWith("baked-") &&
      card.sourceLanguage !== "Japanese"
    );
    const liveByPrinting = new Map(liveTCGCards.map(card => [
      `${String(card.cardCode || "").toLowerCase()}|${String(card.rarity || "").toLowerCase()}`,
      card
    ]));
    const mergedTCGCards = bakedTCGCards.map(bakedCard => {
      const liveCard = liveByPrinting.get(
        `${String(bakedCard.cardCode || "").toLowerCase()}|${String(bakedCard.rarity || "").toLowerCase()}`
      );
      return liveCard
        ? { ...bakedCard, ...liveCard, image: liveCard.image || bakedCard.image }
        : bakedCard;
    });
    const playersClubCards = products.filter(card => card.sourceName === "Players Club");
    const japaneseCards = products.filter(card =>
      card.sourceLanguage === "Japanese" && card.sourceName !== "Players Club"
    );
    products = [...mergedTCGCards, ...playersClubCards, ...japaneseCards];
  }

  cards = products.map(card => {
    const storedImage = getStoredCardImage(card.name);
    return {
    ...card,
    sourceName: card.sourceName || "TCG Corner",
    image: card.image || storedImage || "",
    price: card.storeCurrency
      ? convertStorePrice(card.storePrice ?? card.price, card.storeCurrency)
      : Number(card.price || 0)
    };
  });

  if (shouldCache) {
    void cacheTCGProducts(cards);
  }

  purchaseSearchCache.clear();
  tcgLoading = false;

  syncPurchasesToDecks();
  refreshDeckPrices();
  renderCards();
  populatePurchaseSelector();
  renderDecks();
  renderDashboard();
  renderSpending();
  renderSpendingCardMatches();
  renderCollectionCardMatches();
  renderMarketplaceCards();
  renderMarketplaceListings();
}

async function syncTCGCorner() {
  const button = document.getElementById("syncTCGButton");
  const label = button?.querySelector("span");
  if (button) {
    button.disabled = true;
    if (label) label.textContent = "Sync started";
  }

  const refresh = loadTCGProducts(true, true);
  const handoff = new Promise(resolve => setTimeout(resolve, 1200));
  void Promise.race([refresh, handoff]).finally(() => {
    if (button) {
      button.disabled = false;
      if (label) label.textContent = "Sync TCG Corner";
    }
  });
}

window.syncTCGCorner = syncTCGCorner;

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
  const code = String(setCode || card.cardCode || "").trim().toUpperCase();
  if (!code) return 0;

  const wantedRegion = String(region || "").trim().toUpperCase();
  const wantedRarity = normalizeDeckPriceRarity(rarity);
  const matches = cards.filter(item =>
    String(item.cardCode || "").trim().toUpperCase() === code &&
    (!wantedRegion || getDeckPriceProductRegion(item) === wantedRegion)
  );
  const exactMatch = wantedRarity
    ? matches.find(item =>
        normalizeDeckPriceRarity(item.rarity || item.variantTitle) === wantedRarity
      )
    : matches[0];
  const match = exactMatch || matches.find(item =>
    !normalizeDeckPriceRarity(item.rarity || item.variantTitle)
  );

  return Number(match?.price || 0);
}

function getDeckPriceProductRegion(product) {
  const region = String(product.priceRegion || product.region || "").trim().toUpperCase();
  if (region === "AE" || region === "OCG" || region === "TCG") return region;

  const language = String(product.sourceLanguage || "").trim().toLowerCase();
  if (language === "japanese" || language === "ocg") return "OCG";
  if (language === "asian english" || language === "ae") return "AE";

  const code = String(product.cardCode || "").trim().toUpperCase();
  if (/-AE[A-Z0-9]*\d+$/.test(code)) return "AE";
  if (/-JP[A-Z0-9]*\d+$/.test(code)) return "OCG";
  return "TCG";
}

function normalizeDeckPriceRarity(value) {
  const rarity = String(value || "").trim();
  if (!rarity || /^(?:default(?: title)?|other|unknown|unspecified rarity)$/i.test(rarity)) return "";
  if (rarity.includes("/")) return "";

  const canonical = getPlayersClubRarity(rarity) || getTcgCornerRarity(rarity);
  return String(canonical || rarity).toLowerCase().replace(/[^a-z0-9]/g, "");
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
    banlistsLoaded = true;

    console.log("Loaded banlists:", {
      TCG: Object.keys(banlists.TCG).length,
      AE: Object.keys(banlists.AE).length,
      OCG: Object.keys(banlists.OCG).length
    });
  } catch (error) {
    console.error("Banlist loading failed:", error);
    banlists = { TCG: {}, AE: {}, OCG: {} };
    banlistsLoaded = false;
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

  const requestedName = String(cardName || "").trim().toLowerCase();
  let entry = banlist[requestedName];
  if (entry === undefined || entry === null) {
    const normalizedName = normalizeRulingCardName(requestedName);
    if (normalizedName) {
      const matchingKey = Object.keys(banlist).find(
        name => normalizeRulingCardName(name) === normalizedName
      );
      if (matchingKey) entry = banlist[matchingKey];
    }
  }

  if (entry === undefined || entry === null) return 3;

  if (typeof entry === "number") return entry;

  return Number(entry.limit ?? entry.status ?? 3);
}



function showBanlistPopup(title, message) {
  const popup = document.getElementById("banlistPopup");
  const popupTitle = document.getElementById("banlistPopupTitle");
  const popupMessage = document.getElementById("banlistPopupMessage");

  if (!popup || !popupTitle || !popupMessage) {
    showAppAlert(message);
    return;
  }

  popupTitle.textContent = title;
  popupMessage.textContent = message;

  popup.classList.add("show");
  document.getElementById("banlistPopupClose")?.focus();
}


function closeBanlistPopup() {
  const popup = document.getElementById("banlistPopup");

  if (popup) {
    popup.classList.remove("show");
  }
}

function showAppAlert(message, title = "Notice") {
  const alertDialog = document.getElementById("appAlert");
  const alertTitle = document.getElementById("appAlertTitle");
  const alertMessage = document.getElementById("appAlertMessage");

  if (!alertDialog || !alertTitle || !alertMessage) return;

  alertTitle.textContent = title;
  alertMessage.textContent = message;
  alertDialog.classList.add("show");
  document.getElementById("appAlertClose")?.focus();
}

function closeAppAlert() {
  document.getElementById("appAlert")?.classList.remove("show");
}

let appConfirmResolve = null;

function showAppConfirm(message, title = "Confirm") {
  const dialog = document.getElementById("appConfirm");
  const dialogTitle = document.getElementById("appConfirmTitle");
  const dialogMessage = document.getElementById("appConfirmMessage");

  if (!dialog || !dialogTitle || !dialogMessage) return Promise.resolve(false);

  dialogTitle.textContent = title;
  dialogMessage.textContent = message;
  dialog.classList.add("show");
  document.getElementById("appConfirmCancel")?.focus();

  return new Promise(resolve => {
    appConfirmResolve = resolve;
  });
}

function closeAppConfirm(accepted = false) {
  document.getElementById("appConfirm")?.classList.remove("show");
  if (appConfirmResolve) {
    appConfirmResolve(accepted);
    appConfirmResolve = null;
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

function cardTooltipAttributes(card, rarity = "", code = "", price) {
  const tooltipPrice = price === undefined ? card?.price || 0 : price;
  return `
    data-tooltip-name="${escapeHtml(card?.name || "")}"
    data-tooltip-code="${escapeHtml(code || card?.cardCode || getPrimaryCardCode(card) || "")}"
    data-tooltip-rarity="${escapeHtml(rarity || card?.rarity || "")}"
    data-tooltip-price="${escapeHtml(tooltipPrice === null ? "" : String(tooltipPrice))}"
    data-tooltip-text="${escapeHtml(getCardDescription(card))}"
  `;
}

let activeCardTooltip = null;
let activeCardTooltipImage = null;

function showCardTooltip(image) {
  if (activeCardTooltipImage === image) return;
  activeCardTooltip?.remove();

  const tooltip = document.createElement("div");
  tooltip.className = "card-hover-tooltip";
  const tooltipMetadata = [
    image.dataset.tooltipCode,
    image.dataset.tooltipRarity,
    image.dataset.tooltipPrice
      ? formatPrice(image.dataset.tooltipPrice)
      : ""
  ].filter(Boolean).join(" · ");
  const title = document.createElement("strong");
  title.textContent = image.dataset.tooltipName || "";
  tooltip.appendChild(title);

  if (tooltipMetadata) {
    const metadata = document.createElement("small");
    metadata.textContent = tooltipMetadata;
    tooltip.appendChild(metadata);
  }

  const description = document.createElement("p");
  const label = document.createElement("strong");
  label.textContent = "Card Text:";
  description.append(label, document.createTextNode(
    `\n${image.dataset.tooltipText || ""}`
  ));
  tooltip.appendChild(description);

  document.body.appendChild(tooltip);
  activeCardTooltip = tooltip;
  activeCardTooltipImage = image;

  const rect = image.getBoundingClientRect();
  const maxLeft = Math.max(10, window.innerWidth - tooltip.offsetWidth - 10);
  const maxTop = Math.max(10, window.innerHeight - tooltip.offsetHeight - 10);
  const rightSide = rect.right + 10;
  const requestedLeft = rightSide + tooltip.offsetWidth <= window.innerWidth - 10
    ? rightSide
    : rect.left - tooltip.offsetWidth - 10;
  tooltip.style.left = `${Math.max(10, Math.min(requestedLeft, maxLeft))}px`;
  tooltip.style.top = `${Math.max(10, Math.min(rect.top, maxTop))}px`;
}

function hideCardTooltip() {
  activeCardTooltip?.remove();
  activeCardTooltip = null;
  activeCardTooltipImage = null;
}

document.addEventListener("pointerover", event => {
  if (event.pointerType === "touch" || !(event.target instanceof Element)) return;
  const image = event.target.closest("img[data-tooltip-name]");
  if (!image) return;
  showCardTooltip(image);
});

document.addEventListener("pointerout", event => {
  if (event.pointerType === "touch" || !(event.target instanceof Element)) return;
  const image = event.target.closest("img[data-tooltip-name]");
  if (image && !image.contains(event.relatedTarget) && activeCardTooltipImage === image) {
    hideCardTooltip();
  }
});

document.addEventListener("click", event => {
  const isTouch = event.pointerType === "touch" ||
    window.matchMedia("(hover: none)").matches;
  if (!isTouch || !(event.target instanceof Element)) return;

  const image = event.target.closest("img[data-tooltip-name]");
  if (!image) {
    hideCardTooltip();
    return;
  }
  if (activeCardTooltipImage === image) hideCardTooltip();
  else showCardTooltip(image);
});



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

function getMarketplaceImage(card, listingImage = "") {
  return listingImage ||
    getCardImageUrl(card, false) ||
    getCardImageUrl(card) ||
    getCardCatalogImage(card) ||
    getStoredCardImage(card?.name) ||
    "";
}

function getStoredCardImage(cardName) {
  const nameKey = String(cardName || "").trim().toLowerCase();
  if (!nameKey) return "";

  if (!getStoredCardImage.index) {
    const index = new Map();
    marketplaceListings.forEach(item => {
      const key = String(item.card || "").trim().toLowerCase();
      if (key && item.image && !index.has(key)) index.set(key, item.image);
    });
    Object.values(deckCards || {}).flat().forEach(item => {
      const key = String(item.card || "").trim().toLowerCase();
      if (key && item.image && !index.has(key)) index.set(key, item.image);
    });
    getStoredCardImage.index = index;
  }

  return getStoredCardImage.index.get(nameKey) || "";
}

function getMarketplaceListingsData() {
  return marketplaceListings.map(listing => {
    const card = localCardDatabase.find(
      item => String(item.id) === String(listing.cardId)
    );
    return card ? { listing, card } : null;
  }).filter(Boolean);
}

function getMarketplaceListingsText(listings = getMarketplaceListingsData()) {
  if (!listings.length) return "";
  const totalCopies = listings.reduce(
    (total, { listing }) =>
      total + Number(listing.quantity ?? listing.qty ?? 1),
    0
  );
  return [
    "Yu-Gi-Oh! Marketplace",
    `${listings.length} ${listings.length === 1 ? "listing" : "listings"} · ${totalCopies} total copies`,
    "",
    ...listings.map(({ listing, card }, index) => {
      const quantity = Number(listing.quantity ?? listing.qty ?? 1);
      return [
        `${index + 1}. ${card.name}`,
        `   ${listing.set || "Unknown set"} · ${listing.rarity || "Unknown rarity"} · ${listing.region || "TCG"}`,
        `   Quantity: ${quantity} · ${formatPrice(Number(listing.price || 0))} each`
      ].join("\n");
    })
  ].join("\n");
}

async function copyMarketplaceListingsText() {
  const listings = getMarketplaceListingsData();
  if (!listings.length) {
    showAppAlert("Add a marketplace listing before copying the list.");
    return;
  }

  const text = getMarketplaceListingsText(listings);
  try {
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch (error) {
        console.info("Clipboard API failed; trying the compatibility copy method.", error);
      }
    }
    if (!copied) {
      const input = document.createElement("textarea");
      input.value = text;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      let copied;
      try {
        input.select();
        copied = document.execCommand("copy");
      } finally {
        input.remove();
      }
      if (!copied) throw new Error("The browser did not allow clipboard access.");
    }
    showAppAlert("Marketplace listing copied to the clipboard.");
  } catch (error) {
    console.error("Unable to copy marketplace listings:", error);
    showAppAlert("Could not copy the listings. Check clipboard permissions and try again.");
  }
}

function drawMarketplaceShareText(context, text, x, y, maxWidth, lineHeight, maxLines) {
  const lines = [];
  let line = "";
  String(text || "").split(/\s+/).forEach(word => {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((value, index) => {
    const truncated = index === maxLines - 1 && lines.length > maxLines
      ? `${value.slice(0, Math.max(0, value.length - 3))}...`
      : value;
    context.fillText(truncated, x, y + index * lineHeight, maxWidth);
  });
}

function getShareImageProxyUrl(source) {
  try {
    const url = new URL(source, window.location.href);
    if (url.hostname.toLowerCase() !== "images.ygoprodeck.com") return "";
    return `https://images.weserv.nl/?url=${encodeURIComponent(
      `${url.host}${url.pathname}${url.search}`
    )}`;
  } catch {
    return "";
  }
}

function loadShareImage(source) {
  return new Promise(resolve => {
    if (!source) {
      resolve(null);
      return;
    }

    const proxyUrl = getShareImageProxyUrl(source);
    let finished = false;
    const timeout = setTimeout(() => finish(null), 12000);
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(result);
    };
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.src = proxyUrl || source;
  });
}

async function downloadMarketplaceListingsImage() {
  const listings = getMarketplaceListingsData();
  if (!listings.length) {
    showAppAlert("Add a marketplace listing before downloading the list image.");
    return;
  }

  const images = await Promise.all(listings.map(({ listing, card }) =>
    loadShareImage(getMarketplaceImage(card, listing.image))
  ));
  const headerHeight = 248;
  const rowHeight = 112;
  const footerHeight = 52;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = headerHeight + listings.length * rowHeight + footerHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    showAppAlert("Your browser could not create the marketplace list image.");
    return;
  }

  const background = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  background.addColorStop(0, "#101722");
  background.addColorStop(1, "#1c2a3a");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#182331";
  context.fillRect(40, 40, 1120, canvas.height - 80);
  context.strokeStyle = "#344357";
  context.lineWidth = 2;
  context.strokeRect(40, 40, 1120, canvas.height - 80);

  context.fillStyle = "#9fb4cb";
  context.font = "700 22px Segoe UI, sans-serif";
  context.fillText("YGO COLLECT  /  MARKETPLACE", 76, 94);
  context.fillStyle = "#f4f7fb";
  context.font = "700 42px Segoe UI, sans-serif";
  context.fillText("Your card listings", 76, 154);
  const totalCopies = listings.reduce(
    (total, { listing }) =>
      total + Number(listing.quantity ?? listing.qty ?? 1),
    0
  );
  context.fillStyle = "#aab7c6";
  context.font = "18px Segoe UI, sans-serif";
  context.fillText(
    `${listings.length} ${listings.length === 1 ? "listing" : "listings"} · ${totalCopies} total copies`,
    76,
    184
  );
  context.fillStyle = "#72849a";
  context.font = "700 14px Segoe UI, sans-serif";
  context.fillText("CARD / PRINTING", 170, headerHeight - 22);
  context.fillText("QTY", 850, headerHeight - 22);
  context.fillText("PRICE EACH", 960, headerHeight - 22);

  listings.forEach(({ listing, card }, index) => {
    const top = headerHeight + index * rowHeight;
    const quantity = Number(listing.quantity ?? listing.qty ?? 1);
    const image = images[index];
    context.fillStyle = index % 2 === 0 ? "#202d3b" : "#182331";
    context.fillRect(60, top, 1080, rowHeight);
    context.strokeStyle = "#344357";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(60, top + rowHeight);
    context.lineTo(1140, top + rowHeight);
    context.stroke();

    const art = { x: 86, y: top + 6, width: 68, height: 100 };
    context.fillStyle = "#111a25";
    context.fillRect(art.x, art.y, art.width, art.height);
    context.strokeStyle = "#56657a";
    context.lineWidth = 1;
    context.strokeRect(art.x, art.y, art.width, art.height);
    if (image) {
      const scale = Math.min(art.width / image.naturalWidth, art.height / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(
        image,
        art.x + (art.width - width) / 2,
        art.y + (art.height - height) / 2,
        width,
        height
      );
    } else {
      context.fillStyle = "#aab7c6";
      context.font = "10px Segoe UI, sans-serif";
      context.fillText("No image", art.x + 8, art.y + 52, art.width - 16);
    }

    context.fillStyle = "#7de0b0";
    context.font = "700 17px Segoe UI, sans-serif";
    context.fillText(String(index + 1).padStart(2, "0"), 64, top + 44);
    context.fillStyle = "#f4f7fb";
    context.font = "700 22px Segoe UI, sans-serif";
    drawMarketplaceShareText(context, card.name, 170, top + 37, 634, 27, 1);
    context.fillStyle = "#aab7c6";
    context.font = "15px Segoe UI, sans-serif";
    drawMarketplaceShareText(
      context,
      `${listing.set || "Unknown set"} · ${listing.rarity || "Unknown rarity"} · ${listing.region || "TCG"}`,
      170,
      top + 68,
      634,
      20,
      1
    );
    context.fillStyle = "#f4f7fb";
    context.font = "700 20px Segoe UI, sans-serif";
    context.fillText(String(quantity), 850, top + 58);
    context.fillStyle = "#7de0b0";
    context.font = "700 20px Segoe UI, sans-serif";
    context.fillText(formatPrice(Number(listing.price || 0)), 960, top + 58);
  });

  let blob;
  try {
    blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  } catch (error) {
    console.error("Unable to export marketplace listings image:", error);
    showAppAlert("Could not export the marketplace list image. Please try again.");
    return;
  }
  if (!blob) {
    showAppAlert("Your browser could not export the marketplace list image.");
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ygo-marketplace-listings.png";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadWishlistImage() {
  const wishlist = cardWishlist.map(entry => {
    const card = localCardDatabase.find(item =>
      String(item.id) === String(entry?.id ?? "")
    ) || localCardDatabase.find(item =>
      normalizeRulingCardName(item.name) ===
        normalizeRulingCardName(entry?.name)
    ) || {
      id: entry?.id || "",
      name: entry?.name || "Unknown card"
    };
    return { entry, card };
  }).filter(({ entry }) => entry?.name);

  if (!wishlist.length) {
    showAppAlert("Add a card to your wishlist before downloading its image.");
    return;
  }

  const images = await Promise.all(wishlist.map(({ entry, card }) =>
    loadShareImage(getMarketplaceImage(card, entry.image))
  ));
  const headerHeight = 208;
  const rowHeight = 112;
  const footerHeight = 48;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = headerHeight + wishlist.length * rowHeight + footerHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    showAppAlert("Your browser could not create the wishlist image.");
    return;
  }

  const background = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  background.addColorStop(0, "#101722");
  background.addColorStop(1, "#1c2a3a");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#182331";
  context.fillRect(40, 40, 1120, canvas.height - 80);
  context.strokeStyle = "#344357";
  context.lineWidth = 2;
  context.strokeRect(40, 40, 1120, canvas.height - 80);

  context.fillStyle = "#9fb4cb";
  context.font = "700 22px Segoe UI, sans-serif";
  context.fillText("YGO COLLECT  /  WISHLIST", 76, 94);
  context.fillStyle = "#f4f7fb";
  context.font = "700 42px Segoe UI, sans-serif";
  context.fillText("Cards to collect", 76, 154);
  context.fillStyle = "#aab7c6";
  context.font = "18px Segoe UI, sans-serif";
  context.fillText(
    `${wishlist.length} ${wishlist.length === 1 ? "card" : "cards"} wanted`,
    76,
    184
  );
  context.fillStyle = "#72849a";
  context.font = "700 14px Segoe UI, sans-serif";
  context.fillText("CARD", 170, headerHeight - 22);

  wishlist.forEach(({ card }, index) => {
    const top = headerHeight + index * rowHeight;
    const image = images[index];
    context.fillStyle = index % 2 === 0 ? "#202d3b" : "#182331";
    context.fillRect(60, top, 1080, rowHeight);
    context.strokeStyle = "#344357";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(60, top + rowHeight);
    context.lineTo(1140, top + rowHeight);
    context.stroke();

    const art = { x: 86, y: top + 6, width: 68, height: 100 };
    context.fillStyle = "#111a25";
    context.fillRect(art.x, art.y, art.width, art.height);
    context.strokeStyle = "#56657a";
    context.lineWidth = 1;
    context.strokeRect(art.x, art.y, art.width, art.height);
    if (image) {
      const scale = Math.min(art.width / image.naturalWidth, art.height / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(
        image,
        art.x + (art.width - width) / 2,
        art.y + (art.height - height) / 2,
        width,
        height
      );
    } else {
      context.fillStyle = "#aab7c6";
      context.font = "10px Segoe UI, sans-serif";
      context.fillText("No image", art.x + 8, art.y + 52, art.width - 16);
    }

    context.fillStyle = "#7de0b0";
    context.font = "700 17px Segoe UI, sans-serif";
    context.fillText(String(index + 1).padStart(2, "0"), 64, top + 58);
    context.fillStyle = "#f4f7fb";
    context.font = "700 22px Segoe UI, sans-serif";
    drawMarketplaceShareText(context, card.name, 170, top + 58, 900, 27, 1);
  });

  let blob;
  try {
    blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  } catch (error) {
    console.error("Unable to export wishlist image:", error);
    showAppAlert("Could not export the wishlist image. Please try again.");
    return;
  }
  if (!blob) {
    showAppAlert("Your browser could not export the wishlist image.");
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ygo-wishlist.png";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderMarketplaceListings() {
  const container = document.getElementById("marketplaceListings");
  if (!container) return;
  const listings = getMarketplaceListingsData();
  const count = document.getElementById("marketplaceListingCount");
  const copyButton = document.getElementById("copyMarketplaceListings");
  const imageButton = document.getElementById("downloadMarketplaceListingsImage");
  if (count) {
    count.textContent = `${listings.length} ${listings.length === 1 ? "listing" : "listings"}`;
  }
  if (copyButton) copyButton.disabled = listings.length === 0;
  if (imageButton) imageButton.disabled = listings.length === 0;

  if (!listings.length) {
    container.innerHTML = `
      <div class="marketplace-empty-state">
        <span class="marketplace-empty-icon" aria-hidden="true">+</span>
        <div>
          <strong>No active listings yet</strong>
          <p>Search the catalog above and choose <b>List this card</b> to create your first listing.</p>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = listings.map(({ listing, card }) => {
    const quantity = Number(listing.quantity ?? listing.qty ?? 1);
    const price = Number(listing.price || 0);

    return `
      <article class="marketplace-listing" role="listitem">
        <div class="marketplace-listing-product">
          <div class="marketplace-listing-art">
            ${getCardImageMarkup(
              card,
              listing.image || getMarketplaceImage(card),
              card.name,
              "marketplace-listing-image",
              cardTooltipAttributes(card, listing.rarity)
            )}
          </div>
          <div class="marketplace-listing-card">
            <strong>${escapeHtml(card.name)}</strong>
            <span>${escapeHtml(listing.set || "Unknown set")} · ${escapeHtml(listing.rarity || "Unknown rarity")} · ${escapeHtml(listing.region || "TCG")}</span>
          </div>
        </div>
        <div class="marketplace-listing-facts">
          <div class="marketplace-listing-stock">
            <span>Quantity</span>
            <strong>${quantity} ${quantity === 1 ? "copy" : "copies"}</strong>
          </div>
          <div class="marketplace-listing-price">
            <span>Price each</span>
            <strong>${formatPrice(price)}</strong>
          </div>
        </div>
        <div class="marketplace-listing-actions">
          <button class="btn marketplace-edit-listing" type="button"
                  aria-label="Edit listing for ${escapeHtml(card.name)}"
                  data-listing-id="${escapeHtml(String(listing.id))}">
            Edit
          </button>
          <button class="btn remove-listing" type="button"
                  aria-label="Remove listing for ${escapeHtml(card.name)}"
                  data-listing-id="${escapeHtml(String(listing.id))}">
            Remove
          </button>
        </div>
      </article>
    `;
  }).join("") || `<p class="empty">No cards listed for sale.</p>`;
  bindCardImageFallbacks(container);
}

document
  .getElementById("marketplaceListings")
  ?.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button[data-listing-id]");
    if (!button) return;

    const listingId = button.dataset.listingId;
    if (button.classList.contains("marketplace-edit-listing")) {
      openMarketplaceListingEdit(listingId);
      return;
    }
    if (!button.classList.contains("remove-listing")) return;

    marketplaceListings = marketplaceListings.filter(
      listing => String(listing.id) !== String(listingId)
    );

    saveMarketplaceListings();
    renderMarketplaceListings();
  });

document
  .getElementById("copyMarketplaceListings")
  ?.addEventListener("click", () => void copyMarketplaceListingsText());

document
  .getElementById("downloadMarketplaceListingsImage")
  ?.addEventListener("click", () => void downloadMarketplaceListingsImage());

document
  .getElementById("downloadWishlistImage")
  ?.addEventListener("click", () => void downloadWishlistImage());

function openMarketplaceListingEdit(listingId) {
  const listing = marketplaceListings.find(
    item => String(item.id) === String(listingId)
  );
  const modal = document.getElementById("marketplaceEditModal");
  if (!listing || !modal) {
    showAppAlert("This marketplace listing could not be found.");
    return;
  }

  document.getElementById("marketplaceEditListingId").value = String(listing.id);
  document.getElementById("marketplaceEditQty").value =
    Number(listing.quantity ?? listing.qty ?? 1);
  document.getElementById("marketplaceEditPrice").value =
    Number(listing.price || 0);
  modal.classList.add("open");
  document.getElementById("marketplaceEditQty").focus();
}

function closeMarketplaceListingEdit() {
  document.getElementById("marketplaceEditModal")?.classList.remove("open");
}

function saveMarketplaceListingEdit() {
  const listingId = document.getElementById("marketplaceEditListingId").value;
  const listing = marketplaceListings.find(
    item => String(item.id) === String(listingId)
  );
  const quantity = Number(document.getElementById("marketplaceEditQty").value);
  const price = Number(document.getElementById("marketplaceEditPrice").value);
  if (!listing) {
    showAppAlert("This marketplace listing could not be found.");
    return;
  }
  if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(price) || price < 0) {
    showAppAlert("Enter a whole-number quantity and a non-negative price.");
    return;
  }

  listing.quantity = quantity;
  listing.price = price;
  saveMarketplaceListings();
  closeMarketplaceListingEdit();
  renderMarketplaceListings();
}

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
          data-set-name="${escapeHtml(printing.setName || printing.set)}"
            data-region="${escapeHtml(printing.region)}">
      ${escapeHtml(printing.setName || printing.set)} (${escapeHtml(printing.set)}) — ${escapeHtml(printing.region)}
    </option>
  `).join("");
  const preferredOption = [...setSelect.options].find(option =>
    option.dataset.region === "AE" || option.dataset.region === "OCG"
  );
  if (preferredOption) setSelect.value = preferredOption.value;

  updateMarketplaceRarities(card);

  modal.classList.add("open");
  setTimeout(() => document.getElementById("marketplaceSet")?.focus(), 0);
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
        ${escapeHtml(rarity || "Unknown rarity")}
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
  getStoredCardImage.index = null;
}

function saveMarketplaceListing() {
  const cardId = document.getElementById("marketplaceCardId").value;
  const card = localCardDatabase.find(
    item => String(item.id) === String(cardId)
  );

  if (!card) {
    console.error("Marketplace card not found:", cardId);
    showAppAlert("This card could not be found in the catalog.");
    return;
  }

  const quantity = Number(
    document.getElementById("marketplaceQty").value
  );

  const price = Number(
    document.getElementById("marketplacePrice").value
  );

  if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(price) || price < 0) {
    showAppAlert("Enter a whole-number quantity and a non-negative price.");
    return;
  }

  marketplaceListings.unshift({
    id: crypto.randomUUID(),
    cardId: String(card.id),
    card: card.name,
    image: getMarketplaceImage(card),
    set: document.getElementById("marketplaceSet").selectedOptions[0]?.dataset.setName ||
      document.getElementById("marketplaceSet").selectedOptions[0]?.dataset.set || "",
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

function refreshDeckPrices() {
  let changed = false;

  for (const deckName of Object.keys(deckCards || {})) {
    for (const entry of deckCards[deckName] || []) {
      const card = localCardDatabase.find(
        item => String(item.id) === String(entry.cardId)
      );
      if (!card) continue;

      const price = getDeckCardPrice(
        card,
        entry.rarity,
        entry.setCode,
        entry.region
      );
      if (price > 0) {
        changed ||= Number(entry.tcgCornerPrice) !== price ||
          Number(entry.price) !== price;
        entry.tcgCornerPrice = price;
        entry.price = price;
      }
    }
  }

  if (changed) {
    saveData();
    renderDecks();
  }
}

function getTcgCornerRarity(rarity) {
  const key = String(rarity || "").trim();
  return TCGC_RAR[key] || key;
}

function renderMarketplaceCards() {
  const grid = document.getElementById("marketCardGrid");
  const search = document.getElementById("marketCardSearch");
  const status = document.getElementById("marketSearchStatus");
  const resultCount = document.getElementById("marketSearchResultCount");

  if (!grid) return;

  const query = String(search?.value || "").trim().toLowerCase();
  const setStatus = (message, count) => {
    if (status) status.textContent = message;
    if (resultCount) resultCount.textContent = count;
  };

  if (query.length < 2) {
    grid.innerHTML = "";
    setStatus(
      query
        ? "Type at least 2 characters to search the catalog."
        : "Enter at least 2 characters to search the catalog.",
      query ? "Keep typing" : "Search to begin"
    );
    return;
  }

  const source = Array.isArray(localCardDatabase)
    ? localCardDatabase
    : Array.isArray(cards)
      ? cards
      : [];

  const results = source.filter(card => {
    const name = String(card.name || "").toLowerCase();
    const codes = [
      card.cardCode,
      ...(Array.isArray(card.card_sets) ? card.card_sets.map(set => set.set_code) : []),
      ...(Array.isArray(card.asian_english_sets)
        ? card.asian_english_sets.flatMap(set => [set.card_code, set.set_code])
        : []),
      ...(Array.isArray(card.ocg_sets)
        ? card.ocg_sets.flatMap(set => [set.card_code, set.set_code])
        : [])
    ];

    return name.includes(query) || codes.some(code =>
      String(code || "").toLowerCase().includes(query)
    );
  });

  const visibleResults = results.slice(0, 60);
  setStatus(
    results.length
      ? `Showing ${visibleResults.length} of ${results.length} matching ${results.length === 1 ? "card" : "cards"}.`
      : `No cards found for "${search.value.trim()}". Try another name or set code.`,
    `${results.length} ${results.length === 1 ? "result" : "results"}`
  );

  grid.innerHTML = visibleResults.map(card => {
    const image = getMarketplaceImage(card);
    const code = getPrimaryCardCode(card);

    return `
      <article class="marketplace-card">
        <div class="marketplace-card-art">
          ${getCardImageMarkup(card, image, card.name || "Unknown card", "marketplace-card-image")}
        </div>
        <div class="marketplace-card-info">
          <h3>${escapeHtml(card.name || "Unknown card")}</h3>
          <p>${escapeHtml(code || "Card catalog entry")}</p>
          <button type="button"
                  class="btn primary"
                  data-card-id="${escapeHtml(String(card.id))}">
            List this card
          </button>
        </div>
      </article>
    `;
  }).join("") || '<p class="marketplace-no-results">No matching cards.</p>';
  bindCardImageFallbacks(grid);
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

document.getElementById("appAlertClose")
  ?.addEventListener("click", closeAppAlert);

document.getElementById("appAlert")
  ?.addEventListener("click", event => {
    if (event.target.id === "appAlert") closeAppAlert();
  });

document.getElementById("appConfirmAccept")
  ?.addEventListener("click", () => closeAppConfirm(true));

document.getElementById("appConfirmCancel")
  ?.addEventListener("click", () => closeAppConfirm(false));

document.getElementById("appConfirm")
  ?.addEventListener("click", event => {
    if (event.target.id === "appConfirm") closeAppConfirm(false);
  });

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  closeAppAlert();
  closeAppConfirm(false);
});

const banlistsReady = loadBanlists().then(() => {
  setActiveBanlist(activeBanlist || "AE");
});

loadLocalCardDatabase()
  .then(() => banlistsReady)
  .then(() => {
    populateCardFilters();
    renderDashboard();
    renderCollection();
    renderWishlist();
    renderSpending();
    renderDecks();
    renderCards();
    loadTCGProducts();
  })
  .catch(error => {
    console.error(error);
    renderCards();
  });

if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" })
      .catch(error => console.warn("Offline cache unavailable:", error));
  });
}

const savedTheme = localStorage.getItem("ygoTheme") || "dark";
document.documentElement.dataset.theme = savedTheme;
document.body.dataset.theme = savedTheme;
const themeToggle = document.getElementById("theme");
if (themeToggle) {
  themeToggle.checked = savedTheme === "dark";
  document.documentElement.dataset.theme = savedTheme;
  document.body.dataset.theme = savedTheme;
  themeToggle.addEventListener("change", () => {
  const nextTheme = themeToggle.checked ? "dark" : "light";

  document.body.dataset.theme = nextTheme;
  document.documentElement.dataset.theme = nextTheme;

  localStorage.setItem("ygoTheme", nextTheme);
  });
}
