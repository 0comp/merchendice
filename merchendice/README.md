# Merchendice for Contabo

Independent deployment of the Merchendice homepage, storefront directory, and enquiry form. Runs on Node 24+ or Docker on your private server. The default deployment uses port 82 behind your existing reverse proxy, matching the reference repository. An optional Caddy overlay handles HTTPS on a fresh server.

Start with [DEPLOY.md](DEPLOY.md). Copy `.env.example` to a private `.env` on the VPS and enter mail settings there. Composio/Gmail is supported, along with the Gmail SMTP approach from the linked reference repository. This package contains no real API keys, app passwords, or OpenAI hosting configuration. The CREATOR storefront example is included and served at `https://merchendice.com/example-store/`.

```sh
npm ci
npm test
npm run build
npm start
```

Tests mock email delivery and never send messages. Every test file rebuilds `dist/` first, so a stale build can't hide a change. Several checks run the site in headless Chrome over the DevTools protocol, with no extra npm packages: the share image, the computed button corners, how the sent dialog closes (Esc, Close or a backdrop click), horizontal overflow on the guides and home pages, and the home page type sizes and weights. They find Chrome, Chromium or Edge in the usual places; set `CHROME_PATH` to point elsewhere. Without a browser they fail on purpose; `SKIP_BROWSER_TESTS=1` marks them as skipped instead. `/healthz` reports that the web server is running; it does not certify email delivery. Configure the provider and verify one enquiry before accepting visitors.

## Image slots

Every photo on the marketing pages is a plain file in `images/`. To use your own photos, save them as WebP with the same file name and the same shape (the sizes below), then rebuild. Files whose names end in a pixel width are listed in `srcset`, so a browser never draws them larger than the file. Today the photos are unedited product mockups from the example store, two unedited screenshots of `/example-store/`, and three free stock product photos from Pexels (see "Stock photo credits"). Nothing is AI-generated.

The stock photos show plain, unbranded products (jewellery, a blank tote, a crewneck) with no faces, logos or watermarks. They are there to show the kind of product, and are never captioned as Merchendice work, products or clients.

The colourful songbird (the small chest print on the tote) appears on one homepage photo: the natural tote, a desktop-only tile in the mosaic. It also shows on the crewneck inside the example-store screenshots. The hero shirt is a different design, the Dove Line Tee. The black hoodie in "A few good products" is a close detail of a store product, cropped clear of the print. The bird artwork's origin still needs confirming before these photos go live.

| File | Size (px) | Shape | Where it shows |
| --- | --- | --- | --- |
| `photo-jewellery-720.webp`, `photo-jewellery-360.webp` | 720 × 900, 360 × 450 | 4:5 | Homepage mosaic (also on phones), share image. Stock photo: gold jewellery on cream cloth. |
| `photo-tote-720.webp`, `photo-tote-360.webp` | 720 × 900, 360 × 450 | 4:5 | Homepage mosaic (also on phones), first photo loaded. Stock photo: a hand holding a plain cream tote. |
| `photo-crewneck-720.webp`, `photo-crewneck-360.webp` | 720 × 900, 360 × 450 | 4:5 | Homepage mosaic (desktop only). Stock photo: neckline of an off-white crewneck. |
| `about-knit-800.webp`, `-1200`, `-1900` | 800 × 400, 1200 × 600, 1900 × 950 | 2:1 | About band (listed in `srcset`). Folded knit sweaters, cropped to 2:1 from the 3500 px original and scaled down only (class `band-knit`). |
| `hero-tee.webp` | 720 × 900 | 4:5 | Homepage mosaic (the one tee in the hero, also on phones). Dove Line Tee, unedited. |
| `tote-natural.webp` | 720 × 960 | 3:4 | Homepage mosaic (desktop only), enquiry page (desktop), share image. Songbird Canvas Tote, unedited. |
| `knit-stack.webp` | 640 × 800 | 4:5 | Homepage mosaic (desktop only), share image. Folded knit sweaters, photo by Arina Krasnikova on Pexels (Pexels licence): https://www.pexels.com/photo/a-close-up-shot-of-stack-of-folded-knitted-fabrics-5710046/ |
| `hoodie-black-496.webp` | 496 × 620 | 4:5 | "A few good products" (shown at most 460 px wide). Sleeve and pocket of the black hoodie. |
| `store-phone-780.webp`, `store-phone-520.webp` | 780 × 1158, 520 × 772 | about 2:3 | Homepage example-store section (shown at most 380 px wide). Unedited 2× phone screenshot of `/example-store/`. |
| `store-desktop-1440.webp`, `store-desktop-960.webp` | 1440 × 900, 960 × 600 | 16:10 | `/examples/` card (shown at most about 720 px wide). Unedited 1440 × 900 desktop screenshot of the current `/example-store/` (960 is the same capture scaled down). |
| `store/<product>-<colour>.webp` | 900 × 900 | 1:1 | Example store product cards and quick view |

### Stock photo credits

All four are under the [Pexels License](https://www.pexels.com/license/) (checked 18 November 2026): free to use and modify, attribution not required. They are credited here anyway. Don't sell them unaltered or suggest the photographers endorse Merchendice. Each was downloaded from Pexels' own image server (the tote at 2000 px wide, the others at 1400 px), cropped to 4:5 and scaled down only.

| File | Photo page | Photographer | Licence |
| --- | --- | --- | --- |
| `about-knit-*.webp`, `knit-stack.webp` | https://www.pexels.com/photo/a-close-up-shot-of-stack-of-folded-knitted-fabrics-5710046/ | Arina Krasnikova | Pexels License |
| `photo-jewellery-*.webp` | https://www.pexels.com/photo/golden-jewelry-on-white-background-26791734/ | Zerin Takı | Pexels License |
| `photo-tote-*.webp` | https://www.pexels.com/photo/a-person-holding-a-tote-bag-6787035/ | Artem Podrez | Pexels License |
| `photo-crewneck-*.webp` | https://www.pexels.com/photo/white-crew-neck-t-shirt-9594089/ | Ron Lach | Pexels License |

Keep the subject near the middle of each photo, because tiles are cropped a little at different screen sizes. `og.png` (1200 × 630) is the picture shown when the site is shared and is a separate file (linked as `/og.png?v=2`; bump the number when the file changes). It shows the natural tote, the hero tee, the knit stack and the jewellery photo, as four 258 × 258 tiles on the right (no faces, nothing AI-generated). The knit tile is a square crop of `knit-stack.webp` (rows 80 to 720 of the 640 × 800 file), downscaled only. The file is saved as a 256-colour PNG to keep it near 150 KB.

## Home page layout and type

The home page follows the 23 November 2026 redesign brief, in this order: hero, Why Merchendice (the problem), How it works, What you get (with the products folded in), the example store, cost, FAQ and a closing call to action. Each section heading after the hero has a small uppercase eyebrow label above it, and the sections alternate between the cream background (`--bg`) and a slightly deeper tone (`--bg-alt`). The closing call to action sits on a terracotta band. A "Start a project" button appears in the hero, after How it works, in the cost section and in the closing band, never more than three sections apart. The one reassurance line beside a button ("Nothing to pay while we shape the idea and the designs.") is a sentence from the approved What you get text.

Every sentence on the home page is existing site wording or a plain rephrase of it. The cost section shows the approved cost answer word for word, and the Why Merchendice section ends with the approved "What do I need to do?" answer. Those two answers are therefore not repeated in the home FAQ, which shows the other eight approved answers. The FAQPage structured data carries exactly those eight visible answers. All ten stay approved and unchanged.

Headings use Cormorant Garamond at weight 600 (H3 and the FAQ questions at 700). Body text is DM Sans at 18 px on desktop and 17 px on phones, weight 500, in `--text` (#2E2C29). Contrast is checked in `tests/behaviour.test.mjs`. Both fonts are self-hosted woff2 files in `fonts/`, Latin subsets made with fontTools from the Google Fonts sources:

| File | Font | Weights | Source | Licence |
| --- | --- | --- | --- | --- |
| `cormorant-garamond.woff2` | Cormorant Garamond 4.001 (Christian Thalmann, Catharsis Fonts) | variable 400 to 700 | https://github.com/google/fonts/tree/main/ofl/cormorantgaramond | SIL Open Font License 1.1, `fonts/OFL-CormorantGaramond.txt` |
| `dm-sans.woff2` | DM Sans (Colophon Foundry) | variable 400 to 600 | https://github.com/google/fonts/tree/main/ofl/dmsans | SIL Open Font License 1.1, `fonts/OFL-DMSans.txt` |

## Icons

The site icon is a cream M on a charcoal (#2B2A28) rounded tile. `favicon.svg` is the source. `favicon.ico` holds 16, 32 and 48 px frames and `apple-touch-icon.png` is 180 px. Pages link them with `?v=3`; bump that number on every page when the icon changes, because browsers cache icons hard. The example store links `/favicon.ico` without a version and only picks up a new icon when the cache expires.

## Search and AI discovery

Each public page has its own title, description, canonical address on the apex domain (never www), Open Graph and Twitter tags and a robots tag that allows rich snippets. Titles are written as a descriptive phrase, kept under 60 characters, and must match the page's `og:title` and `twitter:title`. The home page title is "Custom Merch for Creators & Influencers | Merchendice". The home page carries Organization, WebSite and FAQPage data (the FAQ text is copied word for word from the visible answers, and `tests/seo.test.mjs` fails if they drift apart). The About page names the co-founders in its data and the other subpages carry a breadcrumb trail. No prices, ratings, reviews, addresses or phone numbers go into structured data.

`robots.txt` allows every crawler, the AI ones by name, and points at `sitemap.xml`. `llms.txt` is a short plain-text summary for AI assistants, written only from copy that is already on the site. When a page is added or its copy changes, set that URL's `lastmod` in `sitemap.xml` to the date of the commit that changed the page, update `llms.txt` if the facts change, and update the page list in `tests/helpers.mjs`. The example store at `/example-store/` stays `noindex` (the app sends `X-Robots-Tag: noindex`, and the Caddy overlay and `deploy/nginx-location.conf` repeat it) and out of the sitemap. Marketing links to the demo (header, footer and the homepage "See the example store" button) go to the indexed overview at `/examples/`, which then links through to `/example-store/`.

Needs the live site: verifying the domain in Google Search Console and Bing Webmaster Tools, submitting `sitemap.xml` to both, `http://merchendice.com` 301-redirecting to HTTPS, and `www.merchendice.com` 301-redirecting to the HTTPS apex. Those two redirects are applied in Nginx Proxy Manager; the exact steps are in [DEPLOY.md](DEPLOY.md#http-and-www-redirects-in-nginx-proxy-manager) and must not be applied until Oscar says to go live. The app also 301s www to the apex, and HTTP (when `X-Forwarded-Proto: http` is set) to HTTPS, as a safety net.
