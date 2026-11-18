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

Every photo on the marketing pages is a plain file in `images/`. To use your own photos, save them as WebP with the same file name and the same shape (the sizes below), then rebuild. Nothing else needs to change. Today they are unedited product mockups from the example store, cropped or placed on a solid colour from the site palette. Nothing is AI-generated or stock.

The colourful songbird (the small chest print on the tote and the matching sticker) appears on at most three homepage photos: the natural tote in the mosaic, the sticker, and the black tote in "A few good products". The hero shirt is a different design, the Dove Line Tee. The example-store card uses a third design, the Vintage Swallow Tee. `canvas-natural.webp`, `canvas-black.webp` and `canvas-sand.webp` are close-ups of bag canvas, taken below the print. The bird artwork's origin still needs confirming before these photos go live.

| File | Size (px) | Shape | Where it shows |
| --- | --- | --- | --- |
| `hero-tee.webp` | 720 × 900 | 4:5 | Homepage photo mosaic (the one tee in the hero). Dove Line Tee, unedited. |
| `tote-natural.webp` | 720 × 960 | 3:4 | Homepage mosaic, enquiry page (desktop), share image. Songbird Canvas Tote, unedited. |
| `canvas-sand.webp` | 720 × 900 | 4:5 | Homepage mosaic (desktop only), canvas close-up |
| `canvas-natural.webp` | 720 × 900 | 4:5 | Homepage mosaic (desktop only) |
| `canvas-black.webp` | 720 × 900 | 4:5 | Homepage mosaic (desktop only), share image |
| `sticker.webp` | 640 × 800 | 4:5 | Homepage mosaic, share image. Songbird Sticker, unedited. |
| `goods-flatlay.webp` | 960 × 1200 | 4:5 | "A few good products" section. Songbird Canvas Tote in black, unedited. |
| `store-banner.webp` | 2400 × 1200 | 2:1 (shown cropped to 12:5 or 8:7) | Example store section and `/examples/`. Vintage Swallow Tee in coyote brown, unedited. |
| `store/<product>-<colour>.webp` | 900 × 900 | 1:1 | Example store product cards and quick view |

Keep the subject near the middle of each photo, because tiles are cropped a little at different screen sizes. `og.png` (1200 × 630) is the picture shown when the site is shared and is a separate file.
