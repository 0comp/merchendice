if (typeof document !== 'undefined' && document.documentElement && document.documentElement.classList) {
  document.documentElement.classList.add('js');
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  if (!reduceMotion && typeof IntersectionObserver === 'function') {
    document.documentElement.classList.add('js-io');
    const io = new IntersectionObserver((entries, obs) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          obs.unobserve(entry.target);
        }
      }
    }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
    for (const el of document.querySelectorAll('.rise')) io.observe(el);
  }
}

// An empty passive touchstart listener lets iOS Safari apply :active styles on touch-down, so buttons respond at once.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('touchstart', () => {}, { passive: true });
}

// Phones: a Start a project bar slides up once the hero button has scrolled away, and steps aside
// when the closing call to action comes into view. The bar only exists in the homepage markup.
const mobileCta = typeof document.querySelector === 'function' ? document.querySelector('[data-mobile-cta]') : null;
const heroCta = mobileCta ? document.querySelector('[data-hero-cta]') : null;
const closingCta = mobileCta ? document.querySelector('[data-closing-cta]') : null;
if (mobileCta && heroCta && typeof IntersectionObserver === 'function' && !location.pathname.startsWith('/enquiry')) {
  let heroGone = false;
  let closingReached = false;
  const update = () => {
    const show = heroGone && !closingReached;
    mobileCta.classList.toggle('is-shown', show);
    mobileCta.inert = !show;
  };
  new IntersectionObserver(([entry]) => {
    heroGone = !entry.isIntersecting && entry.boundingClientRect.bottom < 0;
    update();
  }).observe(heroCta);
  if (closingCta) {
    new IntersectionObserver(([entry]) => {
      closingReached = entry.isIntersecting || entry.boundingClientRect.top < 0;
      update();
    }).observe(closingCta);
  }
}

const form = document.querySelector('#enquiryForm');

if (form) {
  const DRAFT_KEY = 'merchendice-message-draft';
  const status = document.querySelector('#formStatus');
  const submitButton = form.querySelector('button[type="submit"]');
  const submitLabel = submitButton.querySelector('span');
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const rules = {
    name: (value) => (value ? '' : 'Please enter your name.'),
    email: (value) => (!value ? 'Please enter your email address.' : emailPattern.test(value) ? '' : 'Please enter a full email address, with an @ and a domain.'),
    description: (value) => (value ? '' : 'Please tell us your idea, even in a few words.'),
  };
  const draftFields = ['name', 'email', 'channels', 'description'];

  const storage = (() => {
    try { return window.localStorage; } catch { return null; }
  })();
  const readDraft = () => {
    try { return JSON.parse(storage?.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
  };
  const saveDraft = () => {
    const draft = {};
    for (const name of draftFields) draft[name] = form.elements.namedItem(name).value;
    try {
      if (draftFields.some((name) => draft[name].trim())) storage?.setItem(DRAFT_KEY, JSON.stringify(draft));
      else storage?.removeItem(DRAFT_KEY);
    } catch { /* Storage can be full or blocked; the form still works without a draft. */ }
  };
  const clearDraft = () => {
    try { storage?.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  };

  // Bring back an unsent draft, without overwriting anything the browser has already filled in.
  const draft = readDraft();
  if (draft && typeof draft === 'object') {
    for (const name of draftFields) {
      const field = form.elements.namedItem(name);
      if (!field.value && typeof draft[name] === 'string') field.value = draft[name].slice(0, Number(field.maxLength) > 0 ? Number(field.maxLength) : 5000);
    }
  }

  const validate = (name) => {
    const field = form.elements.namedItem(name);
    const error = document.getElementById(`${name}Error`);
    const message = rules[name](field.value.trim());
    if (message) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
    if (error) error.textContent = message;
    return !message;
  };

  for (const name of Object.keys(rules)) {
    const field = form.elements.namedItem(name);
    field.addEventListener('blur', () => { if (field.value || field.dataset.touched) validate(name); field.dataset.touched = '1'; });
    field.addEventListener('input', () => { if (field.getAttribute('aria-invalid') === 'true') validate(name); });
  }
  form.addEventListener('input', saveDraft);

  const showThanks = (email) => {
    const panel = document.createElement('div');
    panel.className = 'form-thanks';
    panel.tabIndex = -1;
    const heading = document.createElement('h2');
    heading.textContent = 'Thanks.';
    const note = document.createElement('p');
    // The address is the visitor's own input, so it is only ever inserted as text.
    note.textContent = `We’ve got your note and will reply to ${email}.`;
    const link = document.createElement('a');
    link.className = 'button';
    link.href = '/example-store/';
    link.textContent = 'See the example store';
    panel.append(heading, note, link);
    form.replaceWith(panel);
    // Keep the form's anchor so the header's Start a project link still lands here.
    panel.id = 'enquiryForm';
    panel.focus();
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitButton.disabled) return;
    status.textContent = '';
    status.removeAttribute('data-state');

    // Check every required field at once, then take the visitor to the first problem.
    const invalid = Object.keys(rules).filter((name) => !validate(name));
    if (invalid.length) {
      form.elements.namedItem(invalid[0]).focus();
      return;
    }

    const values = new FormData(form);
    const message = {
      name: String(values.get('name') || '').trim(),
      email: String(values.get('email') || '').trim(),
      channels: String(values.get('channels') || '').trim(),
      website: String(values.get('website') || '').trim(),
      description: String(values.get('description') || '').trim(),
    };

    submitButton.disabled = true;
    submitLabel.textContent = 'Sending…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    let sent = false;
    try {
      const response = await fetch('/api/enquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.message || 'We couldn’t send your message right now. Please try again.');
      if (result?.ok !== true) throw new Error('We couldn’t confirm that your message was sent. Please refresh the page and try again.');
      sent = true;
      clearDraft();
      submitLabel.textContent = 'Sent';
      setTimeout(() => showThanks(message.email), 600);
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = error.name === 'AbortError'
        ? 'We couldn’t confirm whether your message was sent. Please try again later.'
        : error instanceof TypeError
        ? 'We couldn’t connect just now. Please check your connection and try again.'
        : error.message;
      status.focus();
    } finally {
      clearTimeout(timeout);
      if (!sent) {
        submitButton.disabled = false;
        submitLabel.textContent = 'Send message';
      }
    }
  });
}

const navToggle = document.querySelector('[data-nav-toggle]');
const siteNav = document.querySelector('#site-nav');
if (navToggle && siteNav && typeof navToggle.addEventListener === 'function' && siteNav.classList) {
  // On small screens the open menu dims the page behind it and stops it scrolling.
  const backdrop = typeof document.createElement === 'function' ? document.createElement('div') : null;
  if (backdrop) {
    backdrop.className = 'nav-backdrop';
    backdrop.hidden = true;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', () => closeNav());
  }
  const setOpen = (open) => {
    siteNav.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    if (backdrop) backdrop.hidden = !open;
    document.body?.classList?.toggle('nav-open', open);
  };
  const closeNav = () => setOpen(false);
  navToggle.addEventListener('click', () => setOpen(!siteNav.classList.contains('is-open')));
  siteNav.addEventListener('click', (event) => {
    if (event.target.closest && event.target.closest('a')) closeNav();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNav();
  });
  if (typeof window !== 'undefined') window.matchMedia?.('(min-width: 901px)').addEventListener?.('change', (event) => { if (event.matches) closeNav(); });
}
