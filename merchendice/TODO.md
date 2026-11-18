# Open items for Oscar (not served by the site)

These used to be HTML comments in the pages. They are kept here so they never reach visitors.

- **About photos:** the homepage About section names Oscar Thomas and Oscar Rodhelius, words only. Add photos when you have them (README "Image slots" explains the markup); nothing is invented meanwhile. Approve the wording: "Who we are" / "Merchendice is run by co-founders Oscar Thomas and Oscar Rodhelius." / "They draw the designs and build and run each store together with the creator."
- **Real sample photos:** replace the supplier mockups in `/images/` (see README "Image slots").
- **Product range copy:** the homepage strip is gone; the goods section says "Bags, apparel, and small extras, chosen for your audience." Confirm, and say if mugs, prints or posters should be named.
- **Bird artwork:** the example-store designs (the colorful songbird now appears once on the homepage, on the crewneck in the example-store screenshot) came from the original example shop in commit b302e50. The Dove Line Tee in the hero is a different drawing from the same shop. The supplier mockup filenames describe them, but git does not record who drew them or whether they can be used live.
- **Deploy step, log retention:** production access logs live in Nginx Proxy Manager, whose logrotate config is not in this repo. Set it to keep 30 days (see DEPLOY.md "Log retention") so it matches the Privacy Policy.
- **Closing call to action:** approve the heading "Let’s make your first drop." above the last Start a project button on the homepage.
- **Privacy Policy, new lines:** approve the form-draft sentence ("While you fill in the form, your browser keeps a draft of it in local storage…"), the controller paragraph ("Oscar Thomas, co-founder of Merchendice, is the data controller… use the message form.") and the 30-day log lines.
