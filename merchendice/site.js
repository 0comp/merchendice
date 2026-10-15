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
