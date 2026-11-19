# YGO-Collect

YGO-Collect is a web-based Yu-Gi-Oh! collection and portfolio manager designed for players and collectors.

It helps you organize your Yu-Gi-Oh! card collection, track card quantities and values, manage decks, record spending, and browse card information from a local card database.

The project runs as a client-side web application using HTML, CSS, JavaScript, and JSON. No backend server is required.

## Features

### Collection Management

Track the cards in your collection and manage the number of copies you own.

You can organize cards by their individual printings, sets, rarities, languages, and other card information.

### Card Database

Browse and search a local Yu-Gi-Oh! card database.

Card information includes:

* Card name
* Card type
* Card text
* Attribute
* Type
* Level or Rank
* ATK and DEF
* Set information
* Card codes
* Rarities
* Language and region information
* Card images

The Cards page searches card names, effects, codes, archetypes, and set details. It also filters by card type, attribute, and monster type. Open a card to view its text and printings. Card rulings have a separate page and are fetched from the YGOResources API only after selecting a card; additional Q&A records load in small batches. Ruling lookup requires an internet connection, while the local card catalog remains available without it.

The Rulings page presents the selected card's details and artwork alongside its related FAQ and Q&A entries. Card catalog hover previews use the enlarged tile and card-text tooltip used by active deck cards.

Spending, collection, and marketplace card thumbnails reuse images from the local card catalog when a product image is missing or fails to load.

The Wishlist Binder keeps saved cards in one place and can download a shareable PNG of the wishlist.

The project uses JSON data so the application does not need to request card information from an external API every time you use it.

### Deck Builder

Create and manage Yu-Gi-Oh! decks independently in the Deck Builder.

The deck system supports:

* Main Deck
* Extra Deck
* Side Deck
* Card quantities
* Card rarities and printings
* Copy limits
* Banlist restrictions
* Multiple decks
* Drag-and-drop ordering of deck copies

The application checks card limits against the selected banlist when cards are added from the Deck Builder. Card browsing, spending, and collection management do not add cards to decks.

Marketplace listings are shown as a compact list with card thumbnails. You can edit each listing's quantity and per-card price, copy the complete list as formatted text, or download one share-ready PNG containing every listing and its thumbnail. PNG exports load YGOPRODeck artwork through images.weserv.nl, a CORS-enabled image transform, so the browser can draw it into the image.

### Spending and Purchase Tracking

Track purchases made for your collection.

Purchase records support card information, quantities, rarity, set information, source, and pricing. Spending history identifies whether each recorded price came from TCG Corner or Players Club.

The application is designed to support multiple pricing sources instead of relying on a single marketplace.

### Card Pricing

YGO-Collect supports card pricing data from external sources.

The project separates card catalog information from pricing information so price updates do not need to replace the underlying card database.

Supported or integrated sources include TCG Corner and Players Club data.
Deck prices match the full printing code, region, and rarity. Snapshot data is read from `tcgc-prices.json`, `playersclub-prices.json` (Asian English), and `playersclub-prices-ocg.json` (OCG); rows without a usable rarity are only used as exact-code fallbacks.

### TCG and Asian-English Support

The project is designed around multiple Yu-Gi-Oh! regions and card markets.

Current development includes support for:

* TCG
* Asian-English
* OCG

The database structure allows the same card to be associated with different regional printings and rarities.

### Banlist Support

YGO-Collect supports banlist-based deck restrictions.

Cards are assigned a copy limit based on their status:

* Forbidden: 0 copies
* Limited: 1 copy
* Semi-Limited: 2 copies
* Unlimited: 3 copies

The selected banlist determines the limits used by the deck builder.

The `Update Official Banlists` GitHub Actions workflow refreshes TCG, Asian-English, and OCG restrictions from the official Neuron pages each day and can also be run manually. OCG's Japanese card IDs are matched to English catalog names before updating `data/banlists.json`.

The `Update Card Data` workflow checks the current year's Yugipedia release calendar daily, imports released TCG-EN, OCG-AE, and OCG-JP set-list metadata, and enriches matching card records from the YGOPRODeck API. It replaces stale OCG/AE rarity arrays for refreshed printings, unions duplicate scraped rows so all published variants are retained, refreshes TCG rarities, and records extended-art versions as distinct `Extended Art <rarity>` variants of the same card. It updates `data/cards.json`, `data/tcg.json`, `data/ae.json`, and `data/ocg.json`; future-dated releases are skipped, and unmatched cards are reported for the next scheduled retry rather than being added with incomplete card data. Generated catalogs are written compactly and checked against GitHub's 100 MiB per-file limit.

## Project Structure

```text
YGO-Collect/
├── data/
│   └── ...
├── index.html
├── script.js
└── style.css
```

`index.html` contains the main application interface.

`script.js` contains the application logic, including card loading, collection management, deck management, pricing, banlist handling, and UI interactions.

`style.css` contains the application styling and responsive layout.

The `data` directory contains supporting JSON data and application resources.

## Running the Application

YGO-Collect is a client-side application.

You do not need Node.js, a database, or a backend server to run the basic application.

Clone the repository:

```bash
git clone https://github.com/ImYan16/YGO-Collect.git
```

Open the project directory:

```bash
cd YGO-Collect
```

Then open `index.html` in your browser.

For the best experience, serve the project through a local HTTP server because the application loads JSON files using JavaScript.

For Python:

```bash
python -m http.server 8000
```

Open:

```text
http://localhost:8000
```

## GitHub Pages

YGO-Collect is suitable for deployment through GitHub Pages because the application uses client-side HTML, CSS, JavaScript, and JSON.

To deploy it:

1. Open the repository on GitHub.
2. Go to Settings.
3. Open Pages.
4. Select the `main` branch.
5. Select the repository root as the deployment directory.
6. Save the configuration.
7. Open the generated GitHub Pages URL.

## Data Sources

YGO-Collect uses data gathered from multiple Yu-Gi-Oh! sources.

These include:

* YGOPRODeck
* Yugipedia
* TCG Corner
* Players Club
* YGOResources (card rulings)

Different sources serve different purposes. Card information, regional printings, set information, and pricing data are handled separately where possible.

Card rulings are retrieved on demand from the [YGOResources API](https://db.ygoresources.com/about/api). The app loads the card-name index on the first ruling lookup, then fetches the selected card and its Q&A entries as needed.

The project does not claim ownership of Yu-Gi-Oh! card names, artwork, trademarks, or other copyrighted material belonging to their respective owners.

## Data Updates

The card database is stored locally in JSON.

When card data is updated, the JSON files need to be replaced or regenerated before the application will show the new information.

Pricing data follows a separate update process so pricing changes do not overwrite collection or card metadata.

## Privacy

YGO-Collect is designed as a client-side application.

Your collection and deck information are stored by the application in the browser unless you add an external storage or synchronization system.

No user account is required for the basic application.

## Technology

YGO-Collect currently uses:

* HTML5
* CSS3
* JavaScript
* JSON
* GitHub Pages

The application does not require a frontend framework or backend server.

## Project Status

YGO-Collect is an actively developed personal project.

The application is still being improved, particularly around:

* Card database organization
* Regional card support
* Collection management
* Deck building
* Card printing and rarity handling
* Marketplace pricing
* Purchase tracking
* Data synchronization
* Mobile and responsive layouts

Features and data structures may change as development continues.

## Contributing

Suggestions, bug reports, and improvements are welcome.

Before submitting a change, please make sure it does not break existing collection, deck, card database, or pricing functionality.

For larger changes, open an issue first so the proposed implementation can be discussed.

## Disclaimer

YGO-Collect is an independent fan-made project.

Yu-Gi-Oh! is a trademark of Konami, Shueisha, and their respective owners. YGO-Collect is not affiliated with, sponsored by, or endorsed by Konami or any other Yu-Gi-Oh! rights holder.

Card images, names, artwork, set information, and other game-related content remain the property of their respective owners.

## License

This repository is provided for personal and educational use unless otherwise specified by the repository owner.

Third-party data and assets remain subject to their respective licenses and terms of use.

## Repository

Source code and development history are available on GitHub:

https://github.com/ImYan16/YGO-Collect
