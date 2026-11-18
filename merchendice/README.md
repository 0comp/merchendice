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

Every photo on the marketing pages is a plain file in `images/`. File names end in the pixel width, and pages list the sizes in `srcset`, so a browser never draws a photo larger than its file. To use your own photos, export WebP files at the sizes below (or larger, then update the names, `width`/`height` and `srcset`), and rebuild. Today they are crops of the example store's supplier mockups at their native resolution (1200 × 1200 sources, never enlarged), with the white studio backdrop swapped for a site colour, two unedited screenshots of `/example-store/`, and three free stock mood photos from Pexels (see "Stock photo credits"). Nothing is AI-generated. Stock photos are only used as mood (packaging and fabric), carry `alt=""`, show no products, people, brands or logos, and are never captioned as Merchendice work, products or clients. A test checks that every `width`/`height` and `srcset` width matches the real file.

On the homepage the swallow tee is the only tee, and the colorful songbird appears once, on the crewneck inside the example-store screenshot. The black hoodie in the goods section is a close detail of a store product cropped clear of the print. The bird artwork's origin still needs confirming before these photos go live.

| File | Size (px) | Where it shows |
| --- | --- | --- |
| `hero-tee-1040.webp`, `hero-tee-640.webp` | 1040 × 1100, 640 × 677 | Homepage hero, first photo; the only photo in the hero on phones. Dove Line Tee (sand). |
| `packaging-bag-448.webp`, `packaging-bag-224.webp` | 448 × 608, 224 × 304 | Homepage hero (desktop). Stock mood photo: kraft paper bag with tissue (Pexels). |
| `fabric-folds-624.webp`, `fabric-folds-312.webp` | 624 × 404, 312 × 202 | Homepage hero (desktop). Stock mood photo: beige fabric folds (Pexels). |
| `fabric-edge-448.webp`, `fabric-edge-224.webp` | 448 × 404, 224 × 202 | Homepage hero (desktop). Stock mood photo: undyed fabric with a seam (Pexels). |
| `about-*.webp` (not yet added) | 4:5 portrait, about 640 × 800 | Homepage About section: photos of Oscar Thomas and Oscar Rodhelius, when supplied. Add `<div class="about-photos"><figure><img src="/images/about-oscar-thomas-640.webp" alt="Oscar Thomas" width="640" height="800" loading="lazy" decoding="async"></figure>…</div>` after `.about-copy` in `index.html`; the layout switches to words beside photos on its own. Until then the section is words only, with no placeholder box. |
| `hoodie-black-496.webp` | 496 × 620 | "A few good products" (shown at most 460 px wide). Sleeve and pocket of the black hoodie. |
| `store-phone-780.webp`, `store-phone-520.webp` | 780 × 1158, 520 × 772 | Homepage example-store section (shown at most 380 px wide). Unedited 2× phone screenshot of `/example-store/`. |
| `store-desktop-1440.webp`, `store-desktop-960.webp` | 1440 × 900, 960 × 600 | `/examples/` card (shown at most about 720 px wide). Unedited 1440 × 900 desktop screenshot of `/example-store/`, re-shot after the round 13 copy changes (960 is the same capture scaled down). |
| `tote-natural.webp`, `tote-natural-360.webp` | 720 × 960, 360 × 480 | Message page (desktop, shown at most 340 px wide). Songbird Canvas Tote. |
| `store/<product>-<colour>.webp` | 900 × 900 | 1:1 | Example store product cards and quick view |

### Stock photo credits

All three are under the [Pexels License](https://www.pexels.com/license/) (checked November 18, 2026): free to use and modify, attribution not required. They are credited here anyway. Each was downloaded from Pexels' own image server at 1400 px wide, cropped, and scaled down only.

| File | Photo page | Photographer | Licence |
| --- | --- | --- | --- |
| `packaging-bag-*.webp` | https://www.pexels.com/photo/close-up-photo-of-a-brown-paper-bag-9218541/ | PNW Production | Pexels License |
| `fabric-folds-*.webp` | https://www.pexels.com/photo/beige-textile-in-close-up-photography-4862912/ | Karolina Grabowska (Kaboompics, @karola-g) | Pexels License |
| `fabric-edge-*.webp` | https://www.pexels.com/photo/close-up-of-white-fabric-7533977/ | amanda cavalcante | Pexels License |

Keep the subject near the middle of each photo, because hero tiles are cropped a little at different screen sizes. `og.png` (1200 × 630) is the picture shown when the site is shared and is a separate file.
