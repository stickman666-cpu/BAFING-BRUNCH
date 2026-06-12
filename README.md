# Le Brunch du Bafing - Billetterie

Site local de vente de tickets pour Le Brunch du Bafing.

## Lancer le site

```bash
npm install
npm start
```

Ouvrir ensuite :

- Site public : http://localhost:3000
- Espace admin : http://localhost:3000/admin

## Admin

Le mot de passe admin n'est pas affiche sur le site. Mot de passe par defaut en local :

```text
bafing-admin-2026
```

Pour changer le mot de passe au lancement :

```powershell
$env:ADMIN_PASSWORD="ton-nouveau-mot-de-passe"; npm start
```

## Email des tickets

Quand l'admin confirme une commande, le site tente d'envoyer automatiquement le PDF au client.

L'adresse d'envoi est deja preconfiguree sur Gmail :

```text
bafingbrunch@gmail.com
```

Pour rendre l'envoi operationnel, il faut lancer le site avec le mot de passe d'application Gmail :

```powershell
$env:MAIL_PASS="mot-de-passe-application-gmail"
npm start
```

Configuration Gmail utilisee par defaut :

```text
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=bafingbrunch@gmail.com
MAIL_FROM=Le Brunch du Bafing <bafingbrunch@gmail.com>
```

Si le SMTP n'est pas encore configure, l'admin peut toujours confirmer la commande et telecharger le PDF manuellement.

## Parcours de vente

1. Le client cree un compte avec nom, telephone, email et mot de passe.
2. Le client choisit un pack.
3. Le site cree une commande avec un numero unique :
   - `PC-...` pour Pack Classique
   - `PG-...` pour Pack Gourmand
4. Le client clique sur `Payer maintenant`.
5. Le paiement s'ouvre sur Wave avec le montant du pack.
6. Tu verifies la reception du paiement Wave.
7. Dans `/admin`, tu confirmes la commande.
8. Le client recoit son ticket PDF par email si le SMTP est configure.
9. Le client peut aussi telecharger son ticket PDF depuis son lien de suivi.

## Donnees

Les commandes sont stockees dans :

```text
data/orders.json
```

Pour mettre le site en production, garde ce fichier sauvegarde regulierement ou remplace-le par une vraie base de donnees.
