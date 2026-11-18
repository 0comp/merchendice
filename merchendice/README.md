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

Every photo on the marketing pages is a plain file in `images/`. To use your own photos, save them as WebP with the same file name and the same shape (the sizes below), then rebuild. Nothing else needs to change. Today they are product mockups from the example store, cropped or composited from those files. The bird artwork's origin still needs confirming, so the homepage shows it on at most two photos (the shirt and the sticker).

The tote photos on the marketing pages have the small chest print retouched out, using canvas from the same mockup (not a generated texture). `canvas-natural.webp` and `canvas-black.webp` are unretouched close-ups of the lower bag, below the print. `goods-flatlay.webp` and `store-banner.webp` are still-lifes of those blank totes on a sand ground. Nothing here is AI-generated or stock.

| File | Size (px) | Shape | Where it shows |
| --- | --- | --- | --- |
| `hero-tee.webp` | 720 × 900 | 4:5 | Homepage photo mosaic (the only clothing on the marketing pages) |
| `tote-natural.webp` | 720 × 960 | 3:4 | Homepage mosaic, enquiry page (desktop), share image |
| `tote-black.webp` | 720 × 900 | 4:5 | Homepage mosaic (desktop only) |
| `canvas-natural.webp` | 720 × 900 | 4:5 | Homepage mosaic (desktop only) |
| `canvas-black.webp` | 720 × 900 | 4:5 | Homepage mosaic (desktop only), share image |
| `sticker.webp` | 640 × 800 | 4:5 | Homepage mosaic, share image |
| `goods-flatlay.webp` | 960 × 1200 | 4:5 | "A few good products" section |
| `store-banner.webp` | 2400 × 1200 | 2:1 (shown cropped to 12:5) | Example store section and `/examples/` |
| `store/<product>-<colour>.webp` | 900 × 900 | 1:1 | Example store product cards and quick view |

Keep the subject near the middle of each photo, because tiles are cropped a little at different screen sizes. `og.png` (1200 × 630) is the picture shown when the site is shared and is a separate file.
