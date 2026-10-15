const search = document.querySelector('#exampleSearch');
const filters = [...document.querySelectorAll('.directory-filter')];
const cards = [...document.querySelectorAll('.listing-card')];
const resultCount = document.querySelector('#directoryResultCount');
const resultKind = document.querySelector('#directoryResultKind');
const emptyMessage = document.querySelector('#directoryEmpty');
let examplePrefetchStarted = false;
const creatorImageUrls = [
  'https://images-api.printify.com/mockup/6aa829f98282e23ff70c2186/22073/97933/dove-line-drawing-tee-minimal-bird-chest-print.jpg?camera_label=front',
  'https://images-api.printify.com/mockup/6aa835e25cd33d8be101b8d7/25458/98502/minimal-colorful-bird-crewneck-sweatshirt.jpg?camera_label=front',
  'https://images-api.printify.com/mockup/6aa835e16fe418097a0114c1/32912/98424/bird-on-branch-hoodie-minimal-colorful-finch-graphic-sweatshirt.jpg?camera_label=front',
  'https://images-api.printify.com/mockup/6aa835e18875f83d480655a4/101409/93895/canvas-tote-bag-minimal-colorful-bird-illustration-eco-shopper.jpg?camera_label=front',
  'https://images-api.printify.com/mockup/6aa835e2c492123c6000fc1a/18542/102044/bird-on-branch-tshirt-colorful-minimalist-songbird-tee.jpg?camera_label=front-2',
  'https://images-api.printify.com/mockup/6aa835e1d77e10b4e00e2899/45750/16655/colorful-bird-kiss-cut-sticker-cute-tropical-songbird-laptop-decal.jpg?camera_label=front',
  'https://images-api.printify.com/mockup/6aa82814534b45b40e00300e/83039/108041/vintage-swallow-bird-tee-short-sleeve-shirt.jpg?camera_label=front',
  'https://images-api.printify.com/mockup/6aa8161a82b5d4441d034982/73207/98445/perch-pine-signature-bird-t-shirt-s-4xl.jpg?camera_label=front',
];
const warmedCreatorImages = [];
const filterCookie = 'merchendice_storefront_view';
const validFilters = new Set(['example', 'real']);
const savedFilter = document.cookie.split('; ').find(cookie => cookie.startsWith(`${filterCookie}=`))?.split('=').slice(1).join('=');
let activeFilter = validFilters.has(savedFilter) ? savedFilter : 'example';

function prefetchCreatorExample() {
  if (examplePrefetchStarted || navigator.connection?.saveData) return;
  examplePrefetchStarted = true;
  const hint = document.createElement('link');
  hint.rel = 'prefetch';
  hint.href = '/examplepage.com/';
  hint.referrerPolicy = 'no-referrer';
  document.head.append(hint);
  for (const src of creatorImageUrls) {
    const image = new Image();
    image.decoding = 'async';
    image.fetchPriority = 'low';
    image.referrerPolicy = 'no-referrer';
    image.src = src;
    warmedCreatorImages.push(image);
  }
}

for (const link of document.querySelectorAll('[data-prefetch-example]')) {
  for (const eventName of ['pointerenter', 'focus', 'click']) {
    link.addEventListener(eventName, prefetchCreatorExample, { once: true });
  }
}

function syncFilterButtons() {
  for (const button of filters) {
    const isActive = button.dataset.filter === activeFilter;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
}

function updateDirectory() {
  const terms = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  let visibleCount = 0;
  for (const card of cards) {
    const matchesType = card.dataset.kind === activeFilter;
    const searchable = card.dataset.search.toLocaleLowerCase();
    const matchesQuery = terms.every(term => searchable.includes(term));
    card.hidden = !(matchesType && matchesQuery);
    if (!card.hidden) visibleCount += 1;
  }
  resultCount.textContent = `${visibleCount} ${visibleCount === 1 ? 'storefront' : 'storefronts'}`;
  resultKind.textContent = `${activeFilter === 'example' ? 'EXAMPLE' : 'REAL'} STOREFRONTS`;
  emptyMessage.hidden = false;
  if (visibleCount) {
    emptyMessage.hidden = true;
  } else if (terms.length) {
    emptyMessage.textContent = `No ${activeFilter} storefronts match that search. Try a different name or clear your search.`;
  } else {
    emptyMessage.textContent = activeFilter === 'real'
      ? 'There are no real storefronts listed yet.'
      : 'There are no example storefronts listed yet.';
  }
}

syncFilterButtons();
updateDirectory();
window.addEventListener('pageshow', updateDirectory);

search.addEventListener('input', updateDirectory);
for (const button of filters) {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${filterCookie}=${activeFilter}; Max-Age=31536000; Path=/examples/; SameSite=Lax${secure}`;
    syncFilterButtons();
    updateDirectory();
  });
}
