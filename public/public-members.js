const $ = selector => document.querySelector(selector)

let page = 1
let total = 0
const limit = 24

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]))
}

function formatNumber(value) {
  return new Intl.NumberFormat('fr-FR').format(Number(value || 0))
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).format(new Date(value))
  } catch {
    return ''
  }
}

function renderSkeleton() {
  $('#public-member-grid').innerHTML = Array.from({ length: 6 }).map(() => `
    <article class="public-member-card skeleton skeleton-card">
      <div class="member-avatar"></div>
      <div class="member-card-copy">
        <span class="skeleton-line long"></span>
        <span class="skeleton-line medium"></span>
      </div>
      <div class="member-card-meta">
        <span class="skeleton-line short"></span>
        <span class="skeleton-line medium"></span>
      </div>
    </article>
  `).join('')
}

function render(rows) {
  const grid = $('#public-member-grid')

  if (!rows.length) {
    grid.innerHTML = '<div class="directory-empty">Aucun membre trouvé.</div>'
    return
  }

  grid.innerHTML = rows.map(row => {
    const female = row.sex === 'female'
    const initial = String(row.display_name || 'BX').replace(/^BX\s+/i, '').charAt(0) || 'B'
    return `
      <article class="public-member-card">
        <div class="member-avatar">${esc(initial.toUpperCase())}</div>
        <div class="member-card-copy">
          <strong>${esc(row.display_name)}</strong>
          <span>${esc(row.country || '—')}</span>
        </div>
        <div class="member-card-meta">
          <span class="member-sex ${female ? 'female' : 'male'}">${female ? 'Fille' : 'Garçon'}</span>
          <small>#${esc(row.id)} · ${esc(formatDate(row.created_at))}</small>
        </div>
      </article>
    `
  }).join('')
}

async function loadMembers() {
  renderSkeleton()
  const sex = encodeURIComponent($('#public-member-sex').value)
  const response = await fetch(`/api/members?page=${page}&limit=${limit}&sex=${sex}`, { cache: 'no-store' })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) throw new Error(data.error || 'Impossible de charger les membres.')

  total = Number(data.total || 0)
  render(data.rows || [])
  $('#public-member-total').textContent = formatNumber(total)
  $('#public-page-info').textContent = `Page ${data.page} · ${formatNumber(total)} membres`
  $('#public-prev-page').disabled = page <= 1
  $('#public-next-page').disabled = page * limit >= total
}

function showError(error) {
  $('#public-member-grid').innerHTML = `<div class="directory-empty error">${esc(error.message)}</div>`
}

$('#public-member-sex').addEventListener('change', () => {
  page = 1
  loadMembers().catch(showError)
})

$('#public-member-refresh').addEventListener('click', () => {
  loadMembers().catch(showError)
})

$('#public-prev-page').addEventListener('click', () => {
  if (page > 1) {
    page--
    loadMembers().catch(showError)
  }
})

$('#public-next-page').addEventListener('click', () => {
  if (page * limit < total) {
    page++
    loadMembers().catch(showError)
  }
})

loadMembers().catch(showError)
