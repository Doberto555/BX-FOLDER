const $ = selector => document.querySelector(selector)
let token = sessionStorage.getItem('bx-folder-admin-token') || ''

function toast(text) {
  const box = $('#toast')
  box.textContent = text
  box.classList.add('show')
  clearTimeout(box._timer)
  box._timer = setTimeout(() => box.classList.remove('show'), 2800)
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))
}

function num(value) { return new Intl.NumberFormat('fr-FR').format(Number(value || 0)) }

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`)
  return data
}

async function refresh() {
  const data = await request('/api/admin/overview')
  $('#stat-total').textContent = num(data.stats.total)
  $('#stat-remaining').textContent = num(data.stats.remaining)
  $('#stat-max').textContent = num(data.stats.max)
  $('#group-link').href = data.groupUrl || '#'
  $('#group-link').style.opacity = data.groupUrl ? '1' : '.45'

  $('#rows').innerHTML = data.recent.length ? data.recent.map(row => `
    <tr>
      <td>${row.id}</td><td>${esc(row.display_name)}</td><td>+${esc(row.phone)}</td>
      <td>${row.sex === 'female' ? 'Fille' : 'Garçon'}</td><td>${esc(row.country)}</td>
      <td>${new Date(row.created_at).toLocaleString('fr-FR')}</td>
    </tr>`).join('') : '<tr><td colspan="6">Aucune inscription.</td></tr>'
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault()
  token = $('#admin-token').value.trim()
  try {
    await refresh()
    sessionStorage.setItem('bx-folder-admin-token', token)
    $('#login-gate').classList.add('hidden')
  } catch (error) {
    $('#login-error').textContent = error.message
  }
})

$('#refresh').addEventListener('click', () => refresh().then(() => toast('Panel actualisé.')).catch(error => toast(error.message)))
$('#logout').addEventListener('click', () => {
  sessionStorage.removeItem('bx-folder-admin-token')
  token = ''
  $('#login-gate').classList.remove('hidden')
})

$('#download-vcf').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/admin/download-vcf', { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'Téléchargement impossible')
    }
    const blob = await response.blob()
    const disposition = response.headers.get('content-disposition') || ''
    const match = disposition.match(/filename="([^"]+)"/i)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = match?.[1] || 'BX-FOLDER.vcf'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast('Fichier VCF généré.')
  } catch (error) {
    toast(error.message)
  }
})

if (token) {
  refresh().then(() => $('#login-gate').classList.add('hidden')).catch(() => {
    sessionStorage.removeItem('bx-folder-admin-token')
    token = ''
  })
}
