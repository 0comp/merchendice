# Merchendice for Contabo

Independent deployment of the Merchendice homepage, storefront directory, and enquiry form. Runs on Node 24+ or Docker on your private server. The default deployment uses port 82 behind your existing reverse proxy, matching the reference repository. An optional Caddy overlay handles HTTPS on a fresh server.

Start with [DEPLOY.md](DEPLOY.md). Copy `.env.example` to a private `.env` on the VPS and enter mail settings there. Composio/Gmail is supported, along with the Gmail SMTP approach from the linked reference repository. This package contains no real API keys, app passwords, or OpenAI hosting configuration. The CREATOR storefront example is included and served at `https://merchendice.com/example-store/`.

```sh
npm ci
npm test
npm run build
npm start
```

Tests mock email delivery and never send messages. `/healthz` reports that the web server is running; it does not certify email delivery. Configure the provider and verify one enquiry before accepting visitors.

## Image slots

Every photo on the marketing pages is a plain file in `images/`. To use your own photos, save them as WebP with the same file name and the same shape (the sizes below), then rebuild. Files whose names end in a pixel width are listed in `srcset`, so a browser never draws them larger than the file. Today the photos are unedited product mockups from the example store, two unedited screenshots of `/example-store/`, and three free stock product photos from Pexels (see "Stock photo credits"). Nothing is AI-generated.

The stock photos show plain, unbranded products (jewellery, a blank tote, a crewneck) with no faces, logos or watermarks. They are there to show the kind of product, and are never captioned as Merchendice work, products or clients.

The colourful songbird (the small chest print on the tote and the matching sticker) appears on one homepage photo: the natural tote, a desktop-only tile in the mosaic. It also shows on the crewneck inside the example-store screenshots. The hero shirt is a different design, the Dove Line Tee. The black hoodie in "A few good products" is a close detail of a store product, cropped clear of the print. The bird artwork's origin still needs confirming before these photos go live.

| File | Size (px) | Shape | Where it shows |
| --- | --- | --- | --- |
| `photo-jewellery-720.webp`, `photo-jewellery-360.webp` | 720 × 900, 360 × 450 | 4:5 | Homepage mosaic (also on phones), share image. Stock photo: gold jewellery on cream cloth. |
| `photo-tote-720.webp`, `photo-tote-360.webp` | 720 × 900, 360 × 450 | 4:5 | Homepage mosaic (also on phones), first photo loaded. Stock photo: a hand holding a plain cream tote. |
| `photo-crewneck-720.webp`, `photo-crewneck-360.webp` | 720 × 900, 360 × 450 | 4:5 | Homepage mosaic (desktop only). Stock photo: neckline of an off-white crewneck. |
| `hero-tee.webp` | 720 × 900 | 4:5 | Homepage mosaic (the one tee in the hero, also on phones). Dove Line Tee, unedited. |
| `tote-natural.webp` | 720 × 960 | 3:4 | Homepage mosaic (desktop only), enquiry page (desktop), share image. Songbird Canvas Tote, unedited. |
| `knit-stack.webp` | 640 × 800 | 4:5 | Homepage mosaic (desktop only), share image. Folded knit sweaters, photo by Arina Krasnikova on Pexels (Pexels licence): https://www.pexels.com/photo/a-close-up-shot-of-stack-of-folded-knitted-fabrics-5710046/ |
| `hoodie-black-496.webp` | 496 × 620 | 4:5 | "A few good products" (shown at most 460 px wide). Sleeve and pocket of the black hoodie. |
| `store-phone-780.webp`, `store-phone-520.webp` | 780 × 1158, 520 × 772 | about 2:3 | Homepage example-store section (shown at most 380 px wide). Unedited 2× phone screenshot of `/example-store/`. |
| `store-desktop-1440.webp`, `store-desktop-960.webp` | 1440 × 900, 960 × 600 | 16:10 | `/examples/` card (shown at most about 720 px wide). Unedited 1440 × 900 desktop screenshot of the current `/example-store/` (960 is the same capture scaled down). |
| `store/<product>-<colour>.webp` | 900 × 900 | 1:1 | Example store product cards and quick view |

### Stock photo credits

All three are under the [Pexels License](https://www.pexels.com/license/) (checked 18 November 2026): free to use and modify, attribution not required. They are credited here anyway. Don't sell them unaltered or suggest the photographers endorse Merchendice. Each was downloaded from Pexels' own image server (the tote at 2000 px wide, the others at 1400 px), cropped to 4:5 and scaled down only.

| File | Photo page | Photographer | Licence |
| --- | --- | --- | --- |
| `photo-jewellery-*.webp` | https://www.pexels.com/photo/golden-jewelry-on-white-background-26791734/ | Zerin Takı | Pexels License |
| `photo-tote-*.webp` | https://www.pexels.com/photo/a-person-holding-a-tote-bag-6787035/ | Artem Podrez | Pexels License |
| `photo-crewneck-*.webp` | https://www.pexels.com/photo/white-crew-neck-t-shirt-9594089/ | Ron Lach | Pexels License |

Keep the subject near the middle of each photo, because tiles are cropped a little at different screen sizes. `og.png` (1200 × 630) is the picture shown when the site is shared and is a separate file. It shows the natural tote, the hero tee, the knit stack and the jewellery photo, as four 258 × 258 tiles on the right (no faces, nothing AI-generated). The knit tile is a square crop of `knit-stack.webp` (rows 80 to 720 of the 640 × 800 file), downscaled only. The file is saved as a 256-colour PNG to keep it near 150 KB.
