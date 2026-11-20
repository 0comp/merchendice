# Merchendice for Contabo

Independent deployment of the Merchendice homepage, storefront directory, and enquiry form. Runs on Node 24+ or Docker on your private server. The default deployment uses port 82 behind your existing reverse proxy, matching the reference repository. An optional Caddy overlay handles HTTPS on a fresh server.

Start with [DEPLOY.md](DEPLOY.md). Copy `.env.example` to a private `.env` on the VPS and enter mail settings there. Composio/Gmail is supported, along with the Gmail SMTP approach from the linked reference repository. This package contains no real API keys, app passwords, or OpenAI hosting configuration. The CREATOR storefront example is included and served at `https://merchendice.com/example-store/`.

```sh
npm ci
npm test
npm run build
npm start
```

Tests mock email delivery and never send messages. Every test file rebuilds `dist/` first, so a stale build can't hide a change. Three checks run the site in headless Chrome over the DevTools protocol, with no extra npm packages: the share image, the computed button corners and how the sent dialog closes (Esc, Close or a backdrop click). They find Chrome, Chromium or Edge in the usual places; set `CHROME_PATH` to point elsewhere. Without a browser they fail on purpose; `SKIP_BROWSER_TESTS=1` marks them as skipped instead. `/healthz` reports that the web server is running; it does not certify email delivery. Configure the provider and verify one enquiry before accepting visitors.

## Image slots

Every photo on the marketing pages is a plain file in `images/`. To use your own photos, save them as WebP with the same file name and the same shape (the sizes below), then rebuild. Files whose names end in a pixel width are listed in `srcset`, so a browser never draws them larger than the file. Today the photos are product mockups of the bird designs from Oscar's own print-on-demand account (also used in the example store), two unedited screenshots of `/example-store/`, and two free stock photos from Pexels (see "Stock photo credits"). Nothing is AI-generated.

The stock photos (the knit stack on the About page and in the share image) show plain, unbranded products with no faces, logos or watermarks. They are never captioned as Merchendice work, products or clients, and they are kept out of the homepage hero, which shows only pieces that carry a design.

The hero mosaic is six crops of example-store mockups (`images/store/`), all shot on the same white backdrop, so the tiles sit on a plain white `--tile` background. Each crop is the 560 × 700 middle of the 900 × 900 mockup (from x 170, y 90), scaled down only; nothing is retouched. Phones show the first two tiles, the crewneck and the swallow tee, two to a row.

| File | Size (px) | Shape | Where it shows |
| --- | --- | --- | --- |
| `photo-jewellery-720.webp`, `photo-jewellery-360.webp` | 720 × 900, 360 × 450 | 4:5 | Not used on any page now (kept in the repo, not deleted). Stock photo: gold jewellery on cream cloth. |
| `about-knit-800.webp`, `-1200`, `-1900` | 800 × 400, 1200 × 600, 1900 × 950 | 2:1 | About band (listed in `srcset`, shown about 944 px wide on desktop, so 1900 is sharp at 2×). Folded knit sweaters, cropped to 2:1 from the 3500 px original and scaled down only; `object-position` 45% (class `band-knit`). |
| `hero-crewneck-sand-560.webp`, `-360` | 560 × 700, 360 × 450 | 4:5 | Homepage mosaic (also on phones), preloaded as the first photo. Songbird crewneck in sand (`store/crewneck-25456`). |
| `hero-swallow-tee-560.webp`, `-360` | 560 × 700, 360 × 450 | 4:5 | Homepage mosaic (also on phones). Vintage Swallow Tee in natural (`store/vintage-swallow-91227`). |
| `hero-tote-natural-560.webp`, `-360` | 560 × 700, 360 × 450 | 4:5 | Homepage mosaic (desktop only). Songbird Canvas Tote (`store/canvas-tote-101409`). |
| `hero-dove-tee-560.webp`, `-360` | 560 × 700, 360 × 450 | 4:5 | Homepage mosaic (desktop only). Dove Line Tee in sand (`store/dove-tee-22009`). |
| `hero-hoodie-sand-560.webp`, `-360` | 560 × 700, 360 × 450 | 4:5 | Homepage mosaic (desktop only). Finch Hoodie in sand (`store/bird-hoodie-42166`). |
| `hero-songbird-tee-560.webp`, `-360` | 560 × 700, 360 × 450 | 4:5 | Homepage mosaic (desktop only). Branch Tee in cream (`store/songbird-tee-18390`). |
| `tote-natural.webp` | 720 × 960 | 3:4 | Enquiry page (desktop), share image. Songbird Canvas Tote, unedited. |
| `knit-stack.webp` | 640 × 800 | 4:5 | Not used on any page now (the About band uses `about-knit-*`; kept in the repo, not deleted). Folded knit sweaters, photo by Arina Krasnikova on Pexels (Pexels licence): https://www.pexels.com/photo/a-close-up-shot-of-stack-of-folded-knitted-fabrics-5710046/ |
| `feature-hoodie-black-640.webp`, `-400` | 640 × 800, 400 × 500 | 4:5 | "A few good products" (shown at most 460 px wide). Chest of the black Finch Hoodie with the songbird print (`store/bird-hoodie-32920`, the 640 × 800 area from x 130, y 60), scaled down only. |
| `store-phone-780.webp`, `store-phone-520.webp` | 780 × 1158, 520 × 772 | about 2:3 | Homepage example-store section (shown at most 380 px wide). Unedited 2× phone screenshot of `/example-store/`. |
| `store-desktop-1440.webp`, `store-desktop-960.webp` | 1440 × 900, 960 × 600 | 16:10 | `/examples/` card (shown at most about 720 px wide). Unedited 1440 × 900 desktop screenshot of the current `/example-store/` (960 is the same capture scaled down). |
| `store/<product>-<colour>.webp` | 900 × 900 | 1:1 | Example store product cards and quick view |

### Stock photo credits

Both the knit stack and the jewellery photo are under the [Pexels License](https://www.pexels.com/license/) (checked 18 November 2026): free to use and modify, attribution not required. They are credited here anyway. Don't sell them unaltered or suggest the photographers endorse Merchendice. Each was downloaded from Pexels' own image server at 1400 px wide, cropped and scaled down only. (The plain tote and crewneck stock photos that used to sit in the hero were removed on 20 November 2026.)

| File | Photo page | Photographer | Licence |
| --- | --- | --- | --- |
| `about-knit-*.webp`, `knit-stack.webp` | https://www.pexels.com/photo/a-close-up-shot-of-stack-of-folded-knitted-fabrics-5710046/ | Arina Krasnikova | Pexels License |
| `photo-jewellery-*.webp` (unused) | https://www.pexels.com/photo/golden-jewelry-on-white-background-26791734/ | Zerin Takı | Pexels License |

Keep the subject near the middle of each photo, because tiles are cropped a little at different screen sizes. `og.png` (1200 × 630) is the picture shown when the site is shared (linked as `/og.png?v=2`; bump the number when the file changes). It is a white canvas with the dark wordmark bar, the headline and six 192 × 240 tiles taken from the `hero-*-560.webp` pieces, downscaled only. No photos, no faces, nothing AI-generated.

## Icons

The site icon is a cream M on a charcoal (#2B2A28) rounded tile. `favicon.svg` is the source. `favicon.ico` holds 16, 32 and 48 px frames and `apple-touch-icon.png` is 180 px. Pages link them with `?v=3`; bump that number on every page when the icon changes, because browsers cache icons hard. The example store links `/favicon.ico` without a version and only picks up a new icon when the cache expires.

## Search and AI discovery

Each public page has its own title, description, canonical address on the apex domain (never www), Open Graph and Twitter tags and a robots tag that allows rich snippets. The home page carries Organization, WebSite and FAQPage data (the FAQ text is copied word for word from the visible answers, and `tests/seo.test.mjs` fails if they drift apart). The About page names the co-founders in its data and the other subpages carry a breadcrumb trail. No prices, ratings, reviews, addresses or phone numbers go into structured data.

`robots.txt` allows every crawler, the AI ones by name, and points at `sitemap.xml`. `llms.txt` is a short plain-text summary for AI assistants, written only from copy that is already on the site. When a page is added or its copy changes, update the sitemap date, `llms.txt` if the facts change, and the page list in `tests/helpers.mjs`. The example store stays `noindex` and out of the sitemap.

Needs the live site: verifying the domain in Google Search Console and Bing Webmaster Tools, submitting `sitemap.xml` to both, and the `www` host redirecting to the apex.
