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
      platforms: values.getAll('platforms').map(String),
      youtube: String(values.get('youtube') || '').trim(),
      instagram: String(values.get('instagram') || '').trim(),
      tiktok: String(values.get('tiktok') || '').trim(),
      otherPlatforms: String(values.get('otherPlatforms') || '').trim(),
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
      submitButton.querySelector('span:first-child').textContent = 'Send an enquiry';
      status.focus();
    }
  });
}

const navToggle = document.querySelector('[data-nav-toggle]');
const siteNav = document.querySelector('#site-nav');
if (navToggle && siteNav && typeof navToggle.addEventListener === 'function' && siteNav.classList) {
  const closeNav = () => {
    siteNav.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
  };
  navToggle.addEventListener('click', () => {
    const open = siteNav.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(open));
  });
  siteNav.addEventListener('click', (event) => {
    if (event.target.closest && event.target.closest('a')) closeNav();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNav();
  });
}

// Presentation only: header state, scroll reveal, and a light parallax on the hero mark.
// Everything is optional, so the page stays fully readable if any of it is unavailable.
(() => {
  if (typeof window === 'undefined' || typeof document.querySelectorAll !== 'function' || !document.documentElement) return;
  const root = document.documentElement;
  const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const header = document.querySelector('[data-header]');
  if (header && header.classList) {
    let ticking = false;
    const update = () => {
      header.classList.toggle('is-scrolled', window.scrollY > 24);
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  const revealItems = Array.from(document.querySelectorAll('.reveal'));
  if (revealItems.length && !reduceMotion && 'IntersectionObserver' in window) {
    const groups = new Map();
    for (const item of revealItems) {
      const parent = item.parentElement;
      const index = groups.get(parent) || 0;
      groups.set(parent, index + 1);
      item.style.setProperty('--delay', `${Math.min(index, 4) * 90}ms`);
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    root.classList.add('js-reveal');
    for (const item of revealItems) {
      const rect = item.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.92) item.classList.add('is-in');
      else observer.observe(item);
    }
  }

  const mark = document.querySelector('.hero-mark-body');
  const hero = document.querySelector('.hero');
  const finePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
  if (mark && hero && finePointer && !reduceMotion) {
    hero.addEventListener('pointermove', (event) => {
      const box = hero.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - 0.5;
      const y = (event.clientY - box.top) / box.height - 0.5;
      mark.style.setProperty('--mx', `${(x * 18).toFixed(1)}px`);
      mark.style.setProperty('--my', `${(y * 14).toFixed(1)}px`);
    });
    hero.addEventListener('pointerleave', () => {
      mark.style.setProperty('--mx', '0px');
      mark.style.setProperty('--my', '0px');
    });
  }
})();
