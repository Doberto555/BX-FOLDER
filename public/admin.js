const $ = selector => document.querySelector(selector)
let token = sessionStorage.getItem('bx-folder-admin-session') || ''
let exportChunkSize = 5000
let memberPage = 1
let memberTotal = 0

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

function renderExportParts(total, parts) {
  const options = ['<option value="all">Tous les contacts (' + num(total) + ')</option>']
  for (let i = 0; i < Math.max(1, Number(parts || 1)); i += 1) {
    const start = i * exportChunkSize + 1
    const end = Math.min(total, (i + 1) * exportChunkSize)
    if (start > end) break
    options.push('<option value="' + i + '">Partie ' + (i + 1) + ' · ' + num(start) + ' à ' + num(end) + '</option>')
  }
  $('#vcf-part').innerHTML = options.join('')
}

function renderGroups(groups) {
  $('#groups-list').innerHTML = groups.length ? groups.map(g => {
    const pct = Math.min(100, (Number(g.assigned_count || 0) / Math.max(1, Number(g.capacity || 1))) * 100)
    return `
      <article class="group-item" data-id="${g.id}">
        <div class="group-item-head">
          <div><strong>${esc(g.name)}</strong><span>${num(g.assigned_count)} / ${num(g.capacity)}</span></div>
          <label class="switch"><input class="group-toggle" type="checkbox" ${g.enabled ? 'checked' : ''}><span></span></label>
        </div>
        <div class="mini-progress"><span style="width:${pct}%"></span></div>
        <a href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.url)}</a>
        <div class="group-meta"><span>Priorité ${g.priority}</span><button class="btn group-save">Modifier</button></div>
      </article>`
  }).join('') : '<p class="admin-copy">Aucun groupe configuré.</p>'

  document.querySelectorAll('.group-item').forEach(card => {
    const id = card.dataset.id
    card.querySelector('.group-toggle').addEventListener('change', async e => {
      await request('/api/admin/groups/' + id, { method:'PATCH', body:JSON.stringify({ enabled:e.target.checked }) })
      toast('Groupe mis à jour.')
    })
    card.querySelector('.group-save').addEventListener('click', async () => {
      const name = prompt('Nom du groupe', card.querySelector('strong').textContent)
      if (!name) return
      const capacity = prompt('Capacité du groupe', card.querySelector('.group-item-head span').textContent.split('/')[1]?.trim().replace(/\s/g,'') || '1024')
      if (!capacity) return
      await request('/api/admin/groups/' + id, { method:'PATCH', body:JSON.stringify({ name, capacity:Number(capacity) }) })
      await refresh()
      toast('Groupe modifié.')
    })
  })
}

function renderRows(rows) {
  $('#rows').innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td>${row.id}</td><td>${esc(row.display_name)}</td><td>+${esc(row.phone)}</td>
      <td>${row.sex === 'female' ? 'Fille' : 'Garçon'}</td><td>${esc(row.country)}</td>
      <td>${new Date(row.created_at).toLocaleString('fr-FR')}</td>
    </tr>`).join('') : '<tr><td colspan="6">Aucun résultat.</td></tr>'
}

function renderRemovals(rows) {
  $('#removal-list').innerHTML = rows.length ? rows.map(row => `
    <article class="removal-item">
      <div><strong>+${esc(row.phone)}</strong><span>${new Date(row.created_at).toLocaleString('fr-FR')}</span></div>
      <p>${esc(row.reason || 'Aucune raison fournie.')}</p>
      <div class="admin-actions">
        <span class="status-pill">${esc(row.status)}</span>
        ${row.status === 'pending' ? `<button class="btn danger removal-action" data-id="${row.id}" data-status="approved">Retirer le numéro</button><button class="btn removal-action" data-id="${row.id}" data-status="rejected">Refuser</button>` : ''}
      </div>
    </article>`).join('') : '<p class="admin-copy">Aucune demande de retrait.</p>'

  document.querySelectorAll('.removal-action').forEach(btn => btn.addEventListener('click', async () => {
    await request('/api/admin/removal-requests/' + btn.dataset.id, {
      method:'PATCH',
      body:JSON.stringify({ status:btn.dataset.status })
    })
    await loadRemovals()
    await refresh()
    toast('Demande traitée.')
  }))
}

async function loadMembers() {
  const q = encodeURIComponent($('#member-search').value.trim())
  const sex = encodeURIComponent($('#member-sex').value)
  const data = await request(`/api/admin/members?page=${memberPage}&limit=25&q=${q}&sex=${sex}`)
  memberTotal = data.total
  renderRows(data.rows)
  $('#member-count').textContent = num(data.total) + ' contacts'
  $('#page-info').textContent = `Page ${data.page} · ${num(data.total)} résultats`
  $('#prev-page').disabled = memberPage <= 1
  $('#next-page').disabled = memberPage * data.limit >= data.total
}

async function loadRemovals() {
  const data = await request('/api/admin/removal-requests')
  renderRemovals(data.rows)
}

async function refresh() {
  const data = await request('/api/admin/overview')
  $('#stat-total').textContent = num(data.stats.total)
  $('#stat-today').textContent = num(data.stats.today)
  $('#stat-week').textContent = num(data.stats.last7)
  $('#stat-gender').textContent = `${num(data.stats.male)} / ${num(data.stats.female)}`
  $('#stat-remaining').textContent = num(data.stats.remaining)
  $('#maintenance-enabled').checked = !!data.maintenance?.enabled
  $('#maintenance-message').value = data.maintenance?.message || ''
  $('#maintenance-state').textContent = data.maintenance?.enabled ? 'ACTIF' : 'INACTIF'
  $('#maintenance-state').classList.toggle('active', !!data.maintenance?.enabled)
  exportChunkSize = Number(data.exportChunkSize || 5000)
  renderExportParts(data.stats.total, data.exportParts)
  renderGroups(data.groups || [])
  await Promise.all([loadMembers(), loadRemovals()])
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault()
  $('#login-error').textContent = ''
  try {
    const response = await fetch('/api/admin/login', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
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
    await refresh()
  } catch (error) {
    $('#login-error').textContent = error.message
  }
})

$('#refresh').addEventListener('click', () => refresh().then(() => toast('Dashboard actualisé.')).catch(e => toast(e.message)))
$('#logout').addEventListener('click', () => {
  sessionStorage.removeItem('bx-folder-admin-session')
  token = ''
  $('#login-gate').classList.remove('hidden')
})

$('#save-maintenance').addEventListener('click', async () => {
  try {
    await request('/api/admin/maintenance', {
      method:'PATCH',
      body:JSON.stringify({
        enabled:$('#maintenance-enabled').checked,
        message:$('#maintenance-message').value.trim()
      })
    })
    await refresh()
    toast('Maintenance enregistrée.')
  } catch (e) { toast(e.message) }
})

$('#group-form').addEventListener('submit', async event => {
  event.preventDefault()
  try {
    await request('/api/admin/groups', {
      method:'POST',
      body:JSON.stringify({
        name:$('#group-name').value.trim(),
        url:$('#group-url').value.trim(),
        capacity:Number($('#group-capacity').value),
        priority:Number($('#group-priority').value)
      })
    })
    event.target.reset()
    $('#group-capacity').value = '1024'
    $('#group-priority').value = '100'
    await refresh()
    toast('Groupe ajouté.')
  } catch (e) { toast(e.message) }
})

$('#member-search-btn').addEventListener('click', () => { memberPage = 1; loadMembers().catch(e => toast(e.message)) })
$('#member-search').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); memberPage = 1; loadMembers().catch(err => toast(err.message)) }
})
$('#member-sex').addEventListener('change', () => { memberPage = 1; loadMembers().catch(e => toast(e.message)) })
$('#prev-page').addEventListener('click', () => { if (memberPage > 1) { memberPage--; loadMembers().catch(e => toast(e.message)) } })
$('#next-page').addEventListener('click', () => { if (memberPage * 25 < memberTotal) { memberPage++; loadMembers().catch(e => toast(e.message)) } })

async function download(path, fallbackName) {
  const response = await fetch(path, { headers:{ Authorization:`Bearer ${token}` } })
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
  a.download = match?.[1] || fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

$('#download-vcf').addEventListener('click', async () => {
  try {
    const selected = $('#vcf-part').value
    const query = selected === 'all' ? '' : `?offset=${Number(selected) * exportChunkSize}&limit=${exportChunkSize}`
    await download('/api/admin/download-vcf' + query, 'BX-FOLDER.vcf')
    toast('VCF généré.')
  } catch (e) { toast(e.message) }
})

$('#download-csv').addEventListener('click', () => download('/api/admin/download-csv','BX-FOLDER.csv').then(() => toast('CSV généré.')).catch(e => toast(e.message)))

if (token) {
  refresh().then(() => $('#login-gate').classList.add('hidden')).catch(() => {
    sessionStorage.removeItem('bx-folder-admin-session')
    token = ''
  })
}
