const $ = selector => document.querySelector(selector)

const form = $('#register-form')
const button = $('#submit-btn')
const message = $('#form-message')
const successPanel = $('#success-panel')
const maintenanceBanner = $('#maintenance-banner')

function setMessage(text, type = '') {
  message.textContent = text
  message.className = `form-message${type ? ` ${type}` : ''}`
}

function formatNumber(value) {
  return new Intl.NumberFormat('fr-FR').format(Number(value || 0))
}

function showSuccess(data) {
  form.hidden = true
  successPanel.hidden = false
  $('#success-name').textContent = `Bienvenue ${data.registration.display_name}`
  const link = $('#success-group')
  if (data.group?.url) {
    link.href = data.group.url
    link.textContent = data.group?.name ? `REJOINDRE ${String(data.group.name).toUpperCase()} →` : 'REJOINDRE LE GROUPE →'
    link.hidden = false
  } else {
    link.hidden = true
  }
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

    if (data.maintenance?.enabled) {
      maintenanceBanner.hidden = false
      maintenanceBanner.textContent = data.maintenance.message || 'BX FOLDER est temporairement en maintenance.'
      button.disabled = true
    } else {
      maintenanceBanner.hidden = true
      if (data.remaining > 0) button.disabled = false
    }

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
    country: $('#country').value,
    consentVcf: $('#consent-vcf').checked
  }

  if (!payload.surname.trim() || !payload.phone.trim() || !payload.sex || !payload.country) {
    setMessage('Complète tous les champs.', 'error')
    return
  }

  if (!payload.consentVcf) {
    setMessage('Accepte le partage VCF pour continuer.', 'error')
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

    setMessage('', '')
    form.reset()
    showSuccess(data)
    await loadConfig()
  } catch (error) {
    setMessage(error.message, 'error')
    button.disabled = false
  }
})

$('#success-reset').addEventListener('click', () => {
  successPanel.hidden = true
  form.hidden = false
  setMessage('')
  window.scrollTo({ top: 0, behavior: 'smooth' })
})

loadConfig()
