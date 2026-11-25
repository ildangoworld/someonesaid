const form = document.querySelector('form');
const status = document.querySelector('#setup-status');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = form.querySelector('button');
  submit.disabled = true;
  status.textContent = '';
  try {
    const response = await fetch('/api/admin/claim', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({key:form.querySelector('input').value}),
    });
    if (!response.ok) throw new Error((await response.json()).error);
    location.assign('/admin');
  } catch (error) {
    status.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
