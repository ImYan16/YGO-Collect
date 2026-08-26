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

The project uses JSON data so the application does not need to request card information from an external API every time you use it.

### Deck Builder

Create and manage Yu-Gi-Oh! decks from your card collection.

The deck system supports:

* Main Deck
* Extra Deck
* Side Deck
* Card quantities
* Card rarities and printings
* Copy limits
* Banlist restrictions
* Multiple decks

The application checks card limits against the selected banlist when cards are added to a deck.

### Spending and Purchase Tracking

Track purchases made for your collection.

Purchase records support card information, quantities, rarity, set information, source, and pricing.

The application is designed to support multiple pricing sources instead of relying on a single marketplace.

### Card Pricing

YGO-Collect supports card pricing data from external sources.

The project separates card catalog information from pricing information so price updates do not need to replace the underlying card database.

Supported or integrated sources include TCG Corner and Players Club data.

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
* Players Club (to be added further on the development)

Different sources serve different purposes. Card information, regional printings, set information, and pricing data are handled separately where possible.

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
