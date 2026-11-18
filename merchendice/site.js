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

const form = document.querySelector('#enquiryForm');

if (form) {
  const status = document.querySelector('#formStatus');
  const submitButton = form.querySelector('button[type="submit"]');
  const nameField = form.elements.namedItem('name');
  const emailField = form.elements.namedItem('email');
  const descriptionField = form.elements.namedItem('description');

  for (const field of [nameField, emailField, descriptionField]) {
    field.addEventListener('input', () => field.setCustomValidity(''));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitButton.disabled) return;
    status.textContent = '';
    status.removeAttribute('data-state');

    const values = new FormData(form);
    const enquiry = {
      name: String(values.get('name') || '').trim(),
      email: String(values.get('email') || '').trim(),
      channels: String(values.get('channels') || '').trim(),
      website: String(values.get('website') || '').trim(),
      description: String(values.get('description') || '').trim(),
    };

    nameField.value = enquiry.name;
    emailField.value = enquiry.email;
    descriptionField.value = enquiry.description;
    nameField.setCustomValidity(enquiry.name ? '' : 'Please enter your name.');
    emailField.setCustomValidity(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(enquiry.email) ? '' : 'Please enter a valid email address.');
    descriptionField.setCustomValidity(enquiry.description ? '' : 'Please describe your merch idea.');
    if (!form.reportValidity()) {
      status.dataset.state = 'error';
      status.textContent = !enquiry.name
        ? 'Please enter your name.'
        : !emailField.validity.valid
          ? 'Please enter a valid email address.'
          : 'Please describe your merch idea.';
      return;
    }

    submitButton.disabled = true;
    submitButton.querySelector('span:first-child').textContent = 'Sending…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch('/api/enquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enquiry),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.message || 'We couldn’t send your enquiry right now. Please try again.');
      if (result?.ok !== true) throw new Error('We couldn’t confirm that your enquiry was sent. Please refresh the page and try again.');
      form.reset();
      status.dataset.state = 'success';
      status.textContent = 'Your enquiry has been sent. We’ll reply to the email you provided.';
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = error.name === 'AbortError'
        ? 'We couldn’t confirm whether your enquiry was sent. Please try again later.'
        : error instanceof TypeError
        ? 'We couldn’t connect just now. Please check your connection and try again.'
        : error.message;
    } finally {
      clearTimeout(timeout);
      submitButton.disabled = false;
      submitButton.querySelector('span:first-child').textContent = 'Start a project';
      status.focus();
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
  if (typeof window !== 'undefined') window.matchMedia?.('(min-width: 761px)').addEventListener?.('change', (event) => { if (event.matches) closeNav(); });
}
