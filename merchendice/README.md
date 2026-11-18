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

Every photo on the marketing pages is a plain file in `images/`. File names end in the pixel width, and pages list the sizes in `srcset`, so a browser never draws a photo larger than its file. To use your own photos, export WebP files at the sizes below (or larger, then update the names, `width`/`height` and `srcset`), and rebuild. Today they are crops of the example store's supplier mockups at their native resolution (1200 × 1200 sources, never enlarged), with the white studio backdrop swapped for a site colour, plus two unedited screenshots of `/example-store/`. Nothing is AI-generated or stock. A test checks that every `width`/`height` and `srcset` width matches the real file.

On the homepage the swallow tee is the only tee, and the colourful songbird appears once, on the crewneck inside the example-store screenshot. The other photos are close details of store products cropped clear of the print. The bird artwork's origin still needs confirming before these photos go live.

| File | Size (px) | Where it shows |
| --- | --- | --- |
| `hero-tee-1040.webp`, `hero-tee-640.webp` | 1040 × 1100, 640 × 677 | Homepage hero, first photo; the only photo in the hero on phones. Dove Line Tee (sand). |
| `tote-handles-416.webp` | 416 × 484 | Homepage hero (desktop). Handles of the natural canvas tote. |
| `hoodie-sand-424.webp` | 424 × 248 | Homepage hero (desktop). Hood and drawstrings of the sand hoodie. |
| `crew-grey-400.webp` | 400 × 292 | Homepage hero (desktop). Collar of the grey crewneck. |
| `hoodie-black-496.webp` | 496 × 620 | "A few good products" (shown at most 460 px wide). Sleeve and pocket of the black hoodie. |
| `store-phone-780.webp`, `store-phone-520.webp` | 780 × 1158, 520 × 772 | Homepage example-store section (shown at most 380 px wide). Unedited 2× phone screenshot of `/example-store/`. |
| `store-desktop-1440.webp`, `store-desktop-960.webp` | 1440 × 900, 960 × 600 | `/examples/` card (shown at most about 720 px wide). Unedited 1.75× desktop screenshot of `/example-store/`. |
| `tote-natural.webp` | 720 × 960 | Enquiry page (desktop). Songbird Canvas Tote. |
| `store/<product>-<colour>.webp` | 900 × 900 | 1:1 | Example store product cards and quick view |

Keep the subject near the middle of each photo, because hero tiles are cropped a little at different screen sizes. `og.png` (1200 × 630) is the picture shown when the site is shared and is a separate file.
