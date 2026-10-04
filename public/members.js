const $ = selector => document.querySelector(selector)
let token = sessionStorage.getItem('bx-folder-admin-session') || ''
let page = 1
let total = 0
const limit = 25

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))
}
function num(value) { return new Intl.NumberFormat('fr-FR').format(Number(value || 0)) }
function toast(text) {
  const box = $('#toast')
  box.textContent = text
  box.classList.add('show')
  clearTimeout(box._timer)
  box._timer = setTimeout(() => box.classList.remove('show'), 2600)
}
async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401) {
      sessionStorage.removeItem('bx-folder-admin-session')
      token = ''
      $('#login-gate').classList.remove('hidden')
    }
    throw new Error(data.error || `Erreur ${response.status}`)
  }
  return data
}
function renderTableSkeleton() {
  $('#rows').innerHTML = Array.from({ length: 6 }).map(() => `
    <tr>
      <td><div class="table-skeleton"></div></td>
      <td><div class="table-skeleton"></div></td>
      <td><div class="table-skeleton"></div></td>
      <td><div class="table-skeleton"></div></td>
      <td><div class="table-skeleton"></div></td>
      <td><div class="table-skeleton"></div></td>
    </tr>`).join('')
}

function renderRows(rows) {
  $('#rows').innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td>${row.id}</td>
      <td><strong>${esc(row.display_name)}</strong></td>
      <td>+${esc(row.phone)}</td>
      <td>${row.sex === 'female' ? 'Fille' : 'Garçon'}</td>
      <td>${esc(row.country)}</td>
      <td>${new Date(row.created_at).toLocaleString('fr-FR')}</td>
    </tr>`).join('') : '<tr><td colspan="6">Aucun membre trouvé.</td></tr>'
}
async function loadMembers() {
  renderTableSkeleton()
  const q = encodeURIComponent($('#member-search').value.trim())
  const sex = encodeURIComponent($('#member-sex').value)
  const data = await request(`/api/admin/members?page=${page}&limit=${limit}&q=${q}&sex=${sex}`)
  total = Number(data.total || 0)
  renderRows(data.rows || [])
  $('#member-count').textContent = num(total) + ' membres'
  $('#page-info').textContent = `Page ${data.page} · ${num(total)} résultats`
  $('#prev-page').disabled = page <= 1
  $('#next-page').disabled = page * limit >= total
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault()
  $('#login-error').textContent = ''
  try {
    const response = await fetch('/api/admin/login', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        email:$('#admin-email').value.trim(),
        password:$('#admin-password').value
      })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Connexion impossible')
    token = data.token
    sessionStorage.setItem('bx-folder-admin-session', token)
    $('#login-gate').classList.add('hidden')
    page = 1
    await loadMembers()
  } catch (error) {
    $('#login-error').textContent = error.message
  }
})
$('#logout').addEventListener('click', () => {
  sessionStorage.removeItem('bx-folder-admin-session')
  token = ''
  $('#login-gate').classList.remove('hidden')
})
$('#member-search-btn').addEventListener('click', () => { page = 1; loadMembers().catch(e => toast(e.message)) })
$('#member-search').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); page = 1; loadMembers().catch(err => toast(err.message)) }
})
$('#member-sex').addEventListener('change', () => { page = 1; loadMembers().catch(e => toast(e.message)) })
$('#prev-page').addEventListener('click', () => { if (page > 1) { page--; loadMembers().catch(e => toast(e.message)) } })
$('#next-page').addEventListener('click', () => { if (page * limit < total) { page++; loadMembers().catch(e => toast(e.message)) } })

if (token) {
  loadMembers().then(() => $('#login-gate').classList.add('hidden')).catch(() => {
    sessionStorage.removeItem('bx-folder-admin-session')
    token = ''
  })
}
