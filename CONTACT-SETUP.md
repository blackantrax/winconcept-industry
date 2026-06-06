# Configuration du formulaire de contact

Le formulaire poste vers `/api/contact` (fonction serverless Vercel) qui :
1. Stocke chaque soumission dans **Vercel Postgres** (table `contacts`)
2. Envoie un **message de bienvenue WhatsApp** au numero saisi (Meta Cloud API)
3. Notifie l'equipe WinConcept (optionnel)

Tant que les variables ci-dessous ne sont pas ajoutees, le formulaire fonctionne
mais renvoie `stored:false` / `welcome:false` (aucune erreur visible cote visiteur).

---

## 1. Stockage : Vercel Postgres

1. Dashboard Vercel -> projet **winconcept-industry** -> onglet **Storage**
2. **Create Database** -> **Postgres** (Neon) -> region proche (ex: Frankfurt)
3. **Connect** la base au projet -> Vercel injecte automatiquement `POSTGRES_URL`
   et les variables associees dans tous les environnements
4. Redeployer (Vercel le propose automatiquement, sinon `vercel deploy --prod`)

La table `contacts` se cree toute seule a la premiere soumission. Colonnes :
`id, firstname, lastname, email, phone, service, message, ip, user_agent, created_at`

Pour consulter les leads : Storage -> Postgres -> onglet **Data** / **Query**, ou :
```sql
SELECT created_at, firstname, lastname, phone, service, message
FROM contacts ORDER BY created_at DESC;
```

---

## 2. Message WhatsApp : Meta WhatsApp Cloud API

> Important : pour ecrire en premier a un utilisateur, WhatsApp impose un
> **template de message pre-approuve par Meta**. On ne peut pas envoyer de texte
> libre tant que l'utilisateur n'a pas repondu.

1. Aller sur https://developers.facebook.com -> creer une app **Business**
2. Ajouter le produit **WhatsApp** -> recuperer :
   - **Phone number ID** (numero expediteur) -> variable `WA_PHONE_ID`
   - **Token d'acces permanent** (System User token) -> variable `WA_TOKEN`
3. Creer un **template de bienvenue** (Meta Business Suite -> Modeles de messages),
   ex. nom `bienvenue_winconcept`, langue `fr`, corps :
   > Bonjour {{1}}, merci d'avoir contacte WinConcept Industry. Notre equipe
   > revient vers vous tres vite. A bientot !
   Attendre l'approbation (quelques minutes a quelques heures).
4. Ajouter les variables d'environnement dans Vercel
   (Settings -> Environment Variables, pour Production) :

| Variable          | Valeur                                  |
|-------------------|-----------------------------------------|
| `WA_TOKEN`        | token permanent Meta                    |
| `WA_PHONE_ID`     | ID du numero expediteur                 |
| `WA_TEMPLATE`     | `bienvenue_winconcept`                  |
| `WA_LANG`         | `fr`                                    |
| `WA_OWNER`        | (optionnel) numero equipe E.164 ex: `14384927278` pour recevoir les leads |
| `WA_LEAD_TEMPLATE`| (optionnel) template pour la notif equipe |

5. Redeployer.

Le code passe le prenom comme variable `{{1}}` du template.

---

## Test rapide

```bash
curl -X POST https://winconcept-industry.vercel.app/api/contact \
  -H "Content-Type: application/json" \
  -d '{"firstname":"Test","lastname":"User","phone":"+237699000000","service":"Studio","message":"Test"}'
```
Reponse attendue une fois tout configure : `{"ok":true,"stored":true,"welcome":true}`

---

## Alternative plus simple (si WhatsApp trop lourd)

Si la mise en place Meta est trop contraignante, on peut basculer en 5 min vers
un **email de bienvenue** (via Gmail de winconceptindustrystudios ou Resend) :
le code de `/api/contact.js` est pret a accueillir cette variante. Me le dire.
