// WinConcept Industry - API formulaire de contact
// - Stocke chaque soumission dans Vercel Postgres
// - Envoie un message de bienvenue WhatsApp au numero saisi (Meta Cloud API)
// - Notifie l'equipe WinConcept (numero proprietaire) si configure
//
// Variables d'environnement attendues :
//   POSTGRES_URL          (injecte automatiquement par Vercel Postgres)
//   WA_TOKEN              token d'acces permanent Meta WhatsApp Cloud API
//   WA_PHONE_ID          ID du numero expediteur WhatsApp Business
//   WA_TEMPLATE          nom du template de bienvenue approuve (def: hello_world)
//   WA_LANG              code langue du template (def: en_US)
//   WA_OWNER             numero WhatsApp de l'equipe pour recevoir les leads (optionnel, format E.164 sans +)

const { sql } = require('@vercel/postgres')

// --- utilitaires ---
function toE164(raw) {
  if (!raw) return ''
  let d = String(raw).replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  // Si numero local camerounais (9 chiffres commencant par 6), prefixer 237
  if (d.length === 9 && d.startsWith('6')) d = '237' + d
  return d
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || ''))
}

async function sendWhatsApp(to, templateName, lang, params) {
  const token = process.env.WA_TOKEN
  const phoneId = process.env.WA_PHONE_ID
  if (!token || !phoneId || !to) return { sent: false, reason: 'whatsapp_not_configured' }

  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: lang },
    },
  }
  // Injecte les variables du template si fournies (corps {{1}}, {{2}}, ...)
  if (params && params.length) {
    body.template.components = [
      { type: 'body', parameters: params.map(p => ({ type: 'text', text: String(p) })) },
    ]
  }

  const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await r.json().catch(() => ({}))
  return { sent: r.ok, status: r.status, response: json }
}

module.exports = async function handler(req, res) {
  // CORS / methode
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' })

  // Parse body (Vercel parse deja le JSON, fallback au cas ou)
  let data = req.body
  if (typeof data === 'string') { try { data = JSON.parse(data) } catch { data = {} } }
  data = data || {}

  const firstname = String(data.firstname || '').trim().slice(0, 120)
  const lastname  = String(data.lastname  || '').trim().slice(0, 120)
  const email     = String(data.email     || '').trim().slice(0, 200)
  const phoneRaw  = String(data.phone     || '').trim().slice(0, 40)
  const service   = String(data.service   || '').trim().slice(0, 120)
  const message   = String(data.message   || '').trim().slice(0, 4000)
  const phone     = toE164(phoneRaw)

  // Validation minimale
  if (!firstname || !lastname || !message) {
    return res.status(400).json({ ok: false, error: 'champs_requis_manquants' })
  }
  if (email && !isEmail(email)) {
    return res.status(400).json({ ok: false, error: 'email_invalide' })
  }

  // --- 1. Stockage Postgres ---
  let stored = false
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS contacts (
        id          BIGSERIAL PRIMARY KEY,
        firstname   TEXT NOT NULL,
        lastname    TEXT NOT NULL,
        email       TEXT,
        phone       TEXT,
        service     TEXT,
        message     TEXT NOT NULL,
        ip          TEXT,
        user_agent  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null
    const ua = req.headers['user-agent'] || null
    await sql`
      INSERT INTO contacts (firstname, lastname, email, phone, service, message, ip, user_agent)
      VALUES (${firstname}, ${lastname}, ${email || null}, ${phone || null}, ${service || null}, ${message}, ${ip}, ${ua})
    `
    stored = true
  } catch (e) {
    console.error('Postgres error:', e?.message || e)
    // On continue meme si le stockage echoue (ex: DB pas encore provisionnee)
  }

  // --- 2. Message de bienvenue WhatsApp a l'utilisateur ---
  let welcome = { sent: false }
  try {
    if (phone) {
      welcome = await sendWhatsApp(
        phone,
        process.env.WA_TEMPLATE || 'hello_world',
        process.env.WA_LANG || 'en_US',
        // Variables du template (si ton template contient {{1}} = prenom)
        [firstname]
      )
    }
  } catch (e) {
    console.error('WhatsApp (user) error:', e?.message || e)
  }

  // --- 3. Notification lead a l'equipe WinConcept (optionnel) ---
  try {
    if (process.env.WA_OWNER) {
      await sendWhatsApp(
        process.env.WA_OWNER,
        process.env.WA_LEAD_TEMPLATE || process.env.WA_TEMPLATE || 'hello_world',
        process.env.WA_LANG || 'en_US',
        [`${firstname} ${lastname} | ${service || 'service ?'} | ${phone || email}`]
      )
    }
  } catch (e) {
    console.error('WhatsApp (owner) error:', e?.message || e)
  }

  return res.status(200).json({ ok: true, stored, welcome: welcome.sent })
}
