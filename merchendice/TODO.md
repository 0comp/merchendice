# Open items for Oscar (not served by the site)

These used to be HTML comments in the pages. They are kept here so they never reach visitors.

- **About photos:** the homepage "Who we are" section has Oscar's approved line and the two names, no photos. Say if you want photos added.
- **Real product photos:** replace the supplier mockups and the three Pexels stock photos in `/images/` with your own when you have them (see README "Image slots"). The stock photos show plain, unbranded products, not Merchendice work.
- **Product range copy:** the homepage strip lists totes and bags, stickers, apparel and jewellery (jewellery added at Oscar's request; the hero shows a stock jewellery photo). Confirm these, and say if mugs, prints or posters should be added back.
- **Bird artwork:** the example-store designs (and the colourful-songbird photo on the homepage: the natural tote in the hero mosaic) came from the original example shop in commit b302e50. The Dove Line Tee in the hero and the designs in the store screenshots are different drawings from the same shop. The supplier mockup filenames describe them, but git does not record who drew them or whether they can be used live.
- **Deploy step, log retention:** the Privacy notice says server and proxy logs are kept for 30 days. Production access logs live in Nginx Proxy Manager, whose logrotate config is not in this repo. Set it to keep 30 days (`daily`, `rotate 30`, `maxage 30`, inside the NPM container) or turn access logging off for the merchendice.com proxy host. The Caddy overlay and `deploy/logrotate-merchendice` in this repo already keep 30 days.
- **Sent popup:** "Thanks, your message is sent. We’ll answer by email, usually within one or two days." Confirm the reply time is one you can keep.
- **Demo-store line:** the homepage says "A demo store, so you can see the finished standard." Confirm the wording.
