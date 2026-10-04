const $ = selector => document.querySelector(selector)

const form = $('#register-form')
const button = $('#submit-btn')
const message = $('#form-message')

function setMessage(text, type = '') {
  message.textContent = text
  message.className = `form-message${type ? ` ${type}` : ''}`
}

function formatNumber(value) {
  return new Intl.NumberFormat('fr-FR').format(Number(value || 0))
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Unavailable')
    $('#capacity-text').textContent = `${formatNumber(data.total)} / ${formatNumber(data.max)}`
    $('#capacity-progress').style.width = `${Math.min(100, (data.total / data.max) * 100)}%`
    $('#capacity-note').textContent = `${formatNumber(data.remaining)} places restantes`
    $('#prefix-note').textContent = `PREFIX ${data.prefix}`
    if (data.remaining <= 0) {
      button.disabled = true
      setMessage('BX FOLDER est complet.', 'error')
    }
  } catch {
    $('#capacity-note').textContent = 'Capacité : 50 000 contacts'
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault()
  const payload = {
    surname: $('#surname').value,
    phone: $('#phone').value,
    sex: form.elements.sex.value,
    country: $('#country').value
  }

  if (!payload.surname.trim() || !payload.phone.trim() || !payload.sex || !payload.country) {
    setMessage('Complète tous les champs.', 'error')
    return
  }

  button.disabled = true
  setMessage('Enregistrement en cours…')

  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Inscription impossible')

    setMessage(`Bienvenue ${data.registration.display_name}. Redirection vers le groupe…`, 'success')
    form.reset()
    await loadConfig()

    if (data.groupUrl) {
      setTimeout(() => { window.location.href = data.groupUrl }, 1400)
    } else {
      setMessage(`Bienvenue ${data.registration.display_name}. Inscription terminée.`, 'success')
      button.disabled = false
    }
  } catch (error) {
    setMessage(error.message, 'error')
    button.disabled = false
  }
})

loadConfig()
