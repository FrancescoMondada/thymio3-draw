# Thymio · Dessin

Une page web pour **choisir et regarder ce que dessine le Thymio 3**: le mode « dessinateur » du firmware (`main/drawer.c`, le mode bleu + jaune, `E_Mode_Painter`
dans `mode.c`), où le robot trace une figure avec un stylo tenu dans le trou du milieu. On touche une des 16 figures, la feuille montre en pointillé ce que le
robot va tracer depuis l'endroit où il se trouve, on appuie sur **Dessiner**, et le trait se trace en direct. Les menus du robot (flèches pour choisir, main sur les
capteurs arrière pour lancer) marchent toujours et la page les suit.

Même base technique et même architecture que [thymio3-learn](../thymio3-learn) (miroir d'un mode du firmware, réécrit en MicroPython) et
[thymio3-cards](../thymio3-cards) (mode Séquence): React + Vite + `thymio3-ts-api`, le mode tourne **sur le robot**, la page lui parle par les LED du corps, un robot
virtuel jumeau et un faux robot Bluetooth permettent de tout essayer sans matériel.

**Essayé sans robot seulement** (robot virtuel, faux robot Bluetooth, tests). Pas encore sur un vrai Thymio 3: voir « Statut ».

## Le mode du firmware, tel qu'il est reproduit

Deux rangées de huit figures. Les flèches gauche et droite du robot vont d'une figure à l'autre dans la rangée, avant et arrière changent de rangée; les LED Lego comptent
la place de la figure (rangée de devant: polygones, rangée de derrière: formes). Une main passée sur les deux capteurs arrière (≥ 1700 pendant 0,1 s) puis retirée (≤ 1300
pendant 0,5 s) lance le dessin; le bouton du milieu quitte le mode.

| Place | Polygones (avant) | Côtés | Virage | Formes (arrière) | Ce que fait le robot |
| --- | --- | --- | --- | --- | --- |
| 1 | ligne | 1 | – | cercle | une roue à 140, l'autre arrêtée, jusqu'à 360° au gyroscope |
| 2 | angle (2 côtés du triangle) | 2 | 120° | rectangle | côtés 1 · 1,5 · 1 · 1,5, virages de 90° |
| 3 | triangle | 3 | 120° | losange | 4 côtés égaux, virages 120° · 60° · 120° · 60° |
| 4 | carré | 4 | 90° | trapèze | côtés 1 · 1 · 1 · 2,5, virages 42° · 42° · 138° · 138° |
| 5 | pentagone | 5 | 72° | étoile à 5 branches | 5 côtés, virages de 144° |
| 6 | hexagone | 6 | 60° | parallélogramme | côtés 1 · 1,5 · 1 · 1,5, virages 120° · 60° · 120° · 60° |
| 7 | heptagone | 7 | 51° | étoile à 7 branches | 7 côtés, virages de 154° |
| 8 | octogone | 8 | 45° | huit | un cercle autour de la roue droite, puis un autour de la gauche |

- **Un côté**: vitesse 140 pendant 6 000 000 ticks du minuteur matériel (5 ticks par µs: 1,2 s), que le minuteur arrête de lui-même; une boucle de cap sur l'angle brut du
  gyroscope (`straight_controller.c`, non exposé à MicroPython, donc portée) garde la ligne droite. Pause de 0,5 s après un côté (`behavior.c`). **Les côtés de l'hexagone et
  suivants sont de 0,6 s** (le code du firmware dit `StepsIndex >= 5`, son commentaire dit « à partir du pentagone »: c'est le code qui est suivi).
- **Un virage**: le contrôleur d'angle du firmware (`rotate_deg_absolute`, vitesse 100 au plus) vers un **cap absolu qui s'accumule**: la dérive des côtés est annulée à chaque
  virage. 10 ticks (0,2 s) de pause ensuite. Il y a aussi un virage après le dernier côté.
- **La fin**: le cercle de LED clignote trois fois (3 × 0,3 s) et le son `TONE_TYPE_DRAW_END` joue.
- **Le corps du robot s'allume de la couleur que voit le capteur sous lui** (rouge, jaune, vert, bleu, violet, blanc; le cyan, le noir et « rien » l'éteignent, comme
  `HandleBodyColor`).
- Les angles entiers du firmware ne bouclent pas tout à fait: **l'heptagone tourne de 7 × 51 = 357°, l'étoile à 7 branches de 7 × 154 = 1078°** (2° de moins que 3 tours);
  sur le papier la figure finit à 1,4 mm (heptagone) et 0,8 mm (étoile) de son départ, et le trapèze (42° et 138°) à 0,6 mm. La page le dit dans la fiche « Comment il dessine ».

Écarts avec le firmware (voulus):

| Firmware | Ici |
| --- | --- |
| lancer = main sur les capteurs arrière | aussi le bouton **Dessiner** de la page (la main marche toujours) |
| aucun moyen d'arrêter un dessin sauf quitter le mode | bouton **Stop**: les roues, le minuteur et un virage en cours s'arrêtent, le mode reste prêt |
| rien n'est dit | une ligne `@@…` toutes les 100 ms et à chaque événement (voir plus bas) |
| une seule taille | **la taille se règle** (40 à 300 % de celle du firmware, voir « Taille et forme libre ») |
| 16 figures | **une 17ᵉ, « Ma forme »**: un tracé que l'on pose point par point sur la feuille |

## Taille et forme libre (en plus du firmware)

- **La taille.** Un curseur (et un champ en millimètres: le côté, ou le diamètre du cercle) règle le dessin de 40 % à 300 % de celui du firmware. Les côtés durent
  proportionnellement plus ou moins longtemps (à la vitesse 140, la durée est la longueur). Un **cercle** change de rayon par la roue que le firmware arrête: elle tourne vers l'avant pour un
  cercle plus grand, vers l'arrière pour un plus petit (`pivot_speeds` dans le mode: la vitesse de l'autre roue est `140 × (taille − 100) / (taille + 100)`; 100 % donne `(140, 0)`, le cas du
  firmware). La page dit la taille réelle de la figure (« La figure fait 94 × 94 mm ») et prévient quand elle dépasse la feuille A4. Le robot n'accepte une nouvelle taille que s'il
  est au repos; un dessin garde la taille qu'il avait au départ.
- **Ma forme.** Le troisième onglet de « Choisis une figure »: on touche la feuille pour poser des points (calés tous les 5 mm), on tire un point pour le déplacer, on le touche deux fois pour
  l'enlever, et la page écrit la longueur de chaque côté. Le robot relie les points dans l'ordre à partir de son stylo. Des modèles (maison, flèche, zigzag, spirale), « enlever le dernier point » et
  « tout effacer ». Jusqu'à 23 points (24 côtés pour le robot, avec le virage sur place qui peut venir en premier). La forme est dans le **repère du robot** (le stylo à l'origine, le robot face à « en
  haut »): déplacer ou tourner le robot déplace ou tourne la forme avec lui. Elle ne suit pas le curseur de taille: ses dimensions sont celles des points.
  **Répéter la forme X fois** (X de 1 à 50, un pas − / + ou un nombre à taper): le robot refait la liste de côtés X fois sans qu'on la lui renvoie X fois, **chaque fois à partir du point
  où il s'est arrêté et dans le cap où il s'est arrêté**. Une forme qui ne finit pas comme elle a commencé dessine donc un motif: la maison finit tournée d'un quart de tour (son dernier côté va
  vers la gauche), quatre maisons font une rosace autour du point de départ. **Virage à la fin** (−180° à 180°, de 5° en 5°, 0° au départ): le virage que le robot fait après le dernier
  côté, à la fin de chaque fois (donc aussi après la dernière: c'est l'angle d'arrêt). Un seul côté droit avec 72° répété cinq fois est un pentagone; une forme qui finit tournée de −α avec α
  comme angle de fin se retrouve dans son cap de départ, et une forme fermée est alors retracée sur elle-même (ou se prolonge en chaîne si elle est ouverte). La fiche « Comment il dessine » dit
  « Répète 3 fois · 2/3 », la barre « Fois 2 sur 3 », et l'aperçu en pointillé montre toutes les fois.
  Sur la feuille, le **virage à la fin est dessiné** au bout de chaque fois: un petit arc fléché orange avec son angle (« +72° ») et une flèche qui donne le cap dans lequel le robot s'arrête
  (renforcée à la toute fin: c'est l'angle d'arrêt). Même sans virage (0°), la flèche de cap marque l'arrêt.
  Le robot reçoit une liste de côtés: chacun est un temps (en unités de 5 ms, à la vitesse 140, d'après la calibration du robot) et le virage qui le suit; un virage nul continue tout droit, le
  dernier virage est l'angle de fin, un côté de durée nulle est un virage sur place (le premier point qui n'est pas droit devant).
  **Un vrai robot accélère puis freine** (`robotModel` dans `src/spec.js`): un côté dit pour T secondes ne couvre pas `vitesse × T` mais `vitesse × (T − perte)`, et **la perte est la même pour tous les côtés quelle que
  soit leur longueur** (elle grandit avec la vitesse: `TAU300_S × vitesse / 300`, environ 0,054 s soit 2,5 mm à la vitesse 140). C'est pourquoi la correction n'est pas proportionnelle à la taille: 2,5 mm de moins
  sur chaque côté, que le carré fasse 34 ou 92 mm. La calibration « 15 cm » du firmware, faite à 300, contient elle aussi cette perte: la vitesse en mm/s est `150 / (300 × (D − TAU300_S))` et non `150 / (300 × D)`.
  **`TAU300_S = 0,115 s` est ajusté sur deux carrés dessinés par un vrai robot et mesurés sur la feuille (2026-11-01, calibration 8 142 712)**: côtés de 0,78 s (taille 65 %) et 2,04 s (170 %), que la page annonçait à 31 et
  82 mm, et qui font **34 et 92 mm** sur le papier; le modèle donne 33,6 et 91,9. La page s'en sert avec un vrai robot (le robot virtuel n'accélère pas, il garde l'ancien calcul):
  - **le pointillé et la recette d'un polygone** montrent le côté réellement dessiné (`mm × taille − perte`), le champ « Côté » aussi (on y tape une longueur en mm, la taille en pour cent s'en déduit);
  - **« Ma forme »**: le robot reçoit pour chaque côté le temps `(longueur + perte) / vitesse` (`unitsFor`), donc la longueur demandée est celle qui est dessinée, et les proportions sont gardées;
  - **ni l'encre ni le robot ne sont suivis à l'écran** avec un vrai robot (voir « Ce que montre la page »): le modèle sert à ce que le robot dessine la longueur annoncée, pas à la reconstituer.

## Ce que montre la page

- **La feuille** (à gauche): une feuille quadrillée (10 mm, trait plus marqué tous les 50 mm) vue de dessus, **à l'échelle**: le robot (dessiné d'après les photos du Thymio 3, le
  même dessin que dans thymio3-learn, avec le trou du stylo), ce qu'il va dessiner (pointillé, avec le départ en vert et les coins), l'encre qu'il a laissée (trait plein, **avec le robot virtuel seulement**) et une
  échelle de 5 cm. Deux vues: **Zoom** (autour de la figure) et **Feuille A4** (la feuille entière, 297 × 210 mm).
  - **Le robot se pose où l'on veut**: on le tire pour le déplacer et on tourne la poignée (qui s'accroche tous les 15°; au clavier: flèches pour déplacer, `[` et `]` pour tourner).
    Il dessine depuis l'endroit où il se trouve, et l'encre reste: deux figures de suite se superposent sur la même feuille, comme sur une vraie. Tant que la feuille est vierge,
    le robot attend là où la figure choisie est au milieu de la feuille; dès qu'on le déplace (ou qu'il dessine) il reste où il est. **Centrer** remet la figure au milieu,
    **Nouvelle feuille** efface l'encre et remet le robot au départ. Choisir un modèle de « Ma forme » (maison, flèche, zigzag, spirale), changer le nombre de fois ou le virage à la fin **ne déplace pas le robot**
    s'il a déjà dessiné ou si on l'a posé: la forme part de là où il est, par-dessus l'encre. (Seule une feuille vierge, avec un robot que personne n'a posé, le fait attendre là où la forme est au milieu. Lire un code QR, lui, remet
    toujours la figure au milieu et le robot à son départ.)
  - Avec un vrai robot, le **corps** prend la couleur que voit son capteur (comme sur le robot). **La page ne trace pas d'encre avec un vrai robot**: le tracé qui compte est celui du stylo sur le papier,
    et celui qu'on reconstitue à l'écran n'est qu'une approximation. Elle montre le pointillé (ce que le robot va dessiner, accroché là où le dessin a commencé) et l'étape en cours qui s'y allume; **le robot de l'écran n'avance pas non plus** (il reste là où on l'a posé): s'il bougeait, on verrait l'écart avec le vrai.
  - **Les longueurs sont données « environ »** (recette, taille de la figure, longueur de la forme, écart au départ, diamètre): un vrai robot n'est pas parfait, le stylo bouge un peu dans son trou. La recette ne dit
    plus qu'une figure revient « exactement » au départ.
- **Ce que la page retient**: la langue, le thème, la vue, la figure choisie, la taille et le réglage du pseudo restent d'une visite à l'autre (`localStorage`). **La forme libre, le nombre de fois et le virage
  à la fin ne restent que dans l'onglet** (`sessionStorage`): un rechargement les retrouve, une nouvelle visite commence avec une « Ma forme » vide, et sur la figure de départ si la dernière visite
  finissait sur la forme libre. Avant, la forme restait pour de bon: le robot (ou le pointillé) redessinait le lendemain une vieille forme, répétée et tournée comme on l'avait laissée (« un vieux dessin étrange »).
  L'encre, elle, ne reste jamais: elle ne survit pas à un rechargement.
- **Sous la feuille**: **Dessiner** / **Stop**, l'état du robot (prêt, dessine, terminé), l'étape en cours (« Côté 2 sur 4 », « Virage 3 sur 4 ») avec une barre, et pour le robot
  virtuel la **vitesse de sa simulation** (×1, ×2, ×5, ×10); avec un vrai robot, la couleur qu'il voit et « main détectée ». Le robot virtuel n'a pas de capteur de couleur.
- **Choisis une figure** (à droite): les deux rangées du robot, une à la fois (comme avant et arrière changent de rangée), huit vignettes numérotées de 1 à 8 qui dessinent le
  trajet du stylo; en dessous, les LED Lego du robot telles qu'il les allume, puis le réglage de la **taille**. Le troisième onglet, « Ma forme », est la forme libre.
- **Comment il dessine**: la recette de la figure telle que le mode l'exécute, à la taille choisie (« Avance 1,2 s ≈ 47 mm, tourne de 90° à gauche, répète 4 fois »), la somme des virages, si la
  figure revient au départ, sa durée, et l'étape en cours allumée pendant le dessin. Pour « Ma forme », la liste de ses côtés. La longueur du côté vient de la calibration du robot connecté (voir « Statut »).
- **Paramètres** (cliquer **l'icône de l'application**, ou la touche D): la langue (italien, français, allemand, anglais; celle du navigateur si c'est l'une des quatre), le thème
  (auto, clair, sombre), et le diagnostic: la liaison avec le robot, le journal, le test de la liaison, le programme du robot.

Clavier: ← → = figure précédente / suivante, ↑ ↓ = changer de rangée, Espace = dessiner / stop, N = nouvelle feuille, D = paramètres.

## Le code QR de la configuration

Comme dans [thymio3-cards](../thymio3-cards) et [thymio3-learn](../thymio3-learn): deux boutons en haut, à côté de l'aide. Le **bouton blanc** (un code QR) affiche, sur tout l'écran et le plus grand possible,
le code de la configuration; le **bouton bleu** (un œil dans un viseur) ouvre la caméra derrière un viseur et applique d'un coup le code d'un autre appareil (une photo du code, ou une capture d'écran, marche aussi:
bouton « image » en bas, pour une caméra refusée ou absente). Le scan est désactivé pendant qu'un dessin est en cours. La caméra demande https ou localhost; le code ne contient aucune adresse et se
lit sans réseau (jsQR et le générateur sont dans la page).

Le texte du code (`src/share.js`, strict: un champ faux est ignoré, un code qui n'est pas de nous est refusé, rien n'est exécuté):

```
T3D1;l=fr;p=0;f=16;z=100;r=4;e=0;c=0:50,25:75,50:50,50:0,0:0
```

| Champ | Contenu |
| --- | --- |
| `l` | la langue (it, fr, de, en) |
| `p` | le réglage « Afficher le pseudo » sous le code: `1` oui, `0` non (le pseudo lui-même ne voyage pas) |
| `f` | la figure: 0 à 15 celles du robot, 16 la forme libre |
| `z` | la taille, en % (40 à 300) |
| `r` | combien de fois la forme libre est dessinée (1 à 50) |
| `e` | le virage à la fin, en degrés (−180 à 180) |
| `c` | les points de la forme libre, en millimètres entiers, `x:y` dans le repère du robot (le stylo en 0:0, face au haut de la feuille); `c=` seul est une forme sans point; 23 points au plus |

Un champ absent laisse cette partie de la page comme elle est. À la lecture, la page fait comme si on avait tout réglé à la main (la forme, le nombre de fois, l'angle, la taille, la figure) puis remet la figure au
milieu de la feuille et le robot à son départ; la figure et la taille sont dites au robot; le réglage « Afficher le pseudo » est repris tel quel (et enregistré sur l'appareil). **La place du robot sur la feuille et l'encre ne voyagent pas.** Le plus gros code possible (23 points, tous les champs) fait
268 caractères et 65 modules de côté; une maison répétée quatre fois, 60 caractères et 33 modules (un code facile à lire à travers une salle).

**Le lien vers l'application**, tout en haut des paramètres (« Lien vers l'application »): deux boutons, **Code QR générique** et **iOS · Bluefy**, et l'adresse écrite en dessous. Un bouton ferme les paramètres et affiche le code en
plein écran (sans pseudo ni date), pour que les élèves le scannent avec la caméra de leur tablette. Le code générique est l'adresse seule (`APP_LINKS.web`): il ouvre le navigateur de l'appareil (Chrome ou Samsung Internet sur
Android, qui parlent à un robot). Le code iOS est `bluefy://open?url=<adresse>` (`APP_LINKS.ios`): il ouvre Bluefy, le navigateur de l'iPhone et de l'iPad qui sait parler à un robot, à installer d'abord. Pas de code « Chrome sur
Android »: un lien `intent://` n'est pas ouvert par la caméra d'un Samsung (un test l'interdit). Les codes tiennent toujours l'adresse de GitHub Pages `APP_URL` (`src/share.js`), jamais `location`, pour qu'un enseignant sur `localhost`
donne un lien que les tablettes peuvent atteindre. **Cette adresse (le dépôt `thymio3-draw` du même compte que les autres pages) a été confirmée comme la bonne; le dépôt et le site n'existent pas encore (pas de dépôt ni de workflow ici): les codes ne
mèneront nulle part tant que l'app n'est pas publiée à cette adresse.** Le format `bluefy://open?url=` n'est pas confirmé par la documentation de Bluefy: à essayer sur un iPad.

**Pseudo sous le code**, comme dans les autres pages: chaque appareil tire au départ un pseudo au hasard (`src/names.js`: un mot de science ou de vitesse, un animal, deux chiffres: « StealthRaven80 »), qu'on peut remplacer à la
main ou retirer au dé (Paramètres → « Pseudo sur le code QR »). Écrit en grand sous le code avec la date et l'heure, il sert à reconnaître sur une photo l'appareil dont elle vient. Le réglage **« Afficher le pseudo »**
(Oui / Non, **Non** au départ) décide s'il est écrit: la date reste dans tous les cas. Le **réglage** voyage dans le code (champ `p`): un enseignant qui le met sur « Oui » fait afficher aussi les pseudos sur les appareils de ses élèves qui scannent son code (il peut ensuite le remettre sur « Non » chez eux). Le **pseudo lui-même** est du texte écrit sur la page, pas dans le code; il ne voyage pas.

## Comment ça marche avec un vrai robot

```
 page  ──(Bluetooth: commande des actionneurs = les 4 LED du corps)──▶  mode sur le robot (draw_xxxxxxxx.py)
 page  ◀─(stdout: lignes "@@…" de 100 octets)──────────────────────────  il dit ce qu'il fait
```

Comme dans thymio3-learn et thymio3-cards: un script qui tourne ne peut rien recevoir par les services Python et fichiers du Bluetooth. Le seul chemin vers lui est la **commande
des actionneurs**, que le firmware traite toutes les 20 ms et qui écrit les LED du corps; MicroPython **relit** ces LED.

- **Installation**: le mode (16,4 Ko une fois réduit) est envoyé **une seule fois** comme module (`draw_<hash>.py`); un démarrage est ensuite un script de deux lignes,
  `import draw_x; draw_x.run(3, 0, 100)` (la figure de départ, si elle est dessinée tout de suite, la taille; une forme libre y figure aussi, `"206:90,206:0"`, pour qu'une relance en soit capable). Sans module, le mode entier est envoyé.
- **Robot → page** (`parseRobotLine` dans `src/protocol.js`): `@@n ms état figure étape angle gauche droite couleur arrièreG arrièreD` toutes les 100 ms (`angle` en dixièmes de degré
  depuis le début du dessin, les vitesses sont celles **mesurées**); `@@sel f` (figure choisie, 0 à 15, ou 16 pour la forme libre; aussi toutes les 3 s); `@@size n` (la taille en %); `@@draw f` (le dessin commence, le gyroscope vient d'être remis
  à zéro); `@@rep n` (la forme libre commence sa n-ième fois); `@@seg k s|t` (un côté, ou un virage, commence); `@@end f`; `@@stop`; `@@cal fw bw rot90` (la calibration du robot); `@@state idle|draw|blink`; `@@ack n`; `@@exit`, `@@bye`.
- **Page → robot**: un message est une suite d'objets (clé + valeur de 12 bits: la figure 0..16, une commande dessiner / stop / quitter / redire, la taille, et pour la forme libre « oublier », « un côté » (temps en unités de 5 ms), « le virage qui le suit » et « combien de fois »; l'angle de fin est le virage du dernier côté), écrite dans les LED en 1 à 8 trames de
  douze valeurs de 4 bits (numéro de message, marqueur à 15, numéro de trame, huit demi-octets, somme de contrôle). Le mode répond `@@ack n`. Un message sans réponse en 0,8 s est
  renvoyé une fois; sinon le mode est **relancé avec le changement** (la figure, la taille, la forme libre et « dessiner » sont dans les arguments du lanceur: rien ne se perd; un stop arrête le script, donc le robot).
  **Une forme libre se dit en plusieurs messages** (une maison: 12 objets, donc 8 trames, puis le reste), alors qu'un polygone tient en 3 trames. Le mode ne relit les LED qu'une fois par tick (20 ms): la page laisse donc
  **au moins 40 ms entre deux trames** (`frameGapMs`), même sur une liaison qui répond plus vite, pour qu'aucune ne soit recouverte par la suivante. **« Dessiner » part seul, dans un dernier message d'une trame**,
  après la forme (`itemsFor` dans `src/protocol.js`): le départ ne dépend plus de la queue de la forme. Et si la réponse `@@ack` du départ se perd mais que le robot **dessine** (`@@draw`), c'est qu'il l'a entendu:
  la page ne relance pas le mode (sinon elle arrêterait le dessin en cours pour le refaire). Pendant l'envoi du départ (quelques secondes pour une forme), le bouton est grisé et dit « Envoi au robot… »: un
  deuxième clic aurait renvoyé toute la forme par-dessus le dessin.
- **Des lignes se perdent en route** (journal d'un vrai robot, 2026-11-01): au début d'un dessin, le robot dit une dizaine de lignes en quelques dizaines de millisecondes (`@@state draw`, `@@ack`,
  `@@sel`, `@@size`, `@@state`, `@@draw`, `@@seg 0 s`, plus un `@@n`) et **la fin de la rafale n'arrive jamais** à la page: le robot dessinait, mais sans `@@draw` la page n'ouvrait pas de trait, donc ni encre ni
  robot qui bouge sur l'écran (et de temps en temps, sur un polygone aussi: c'est affaire de rafale). Deux remèdes. Le robot **n'ajoute plus `@@sel`, `@@size`, `@@state` à chaque réponse**: il les dit 0,2 s plus tard
  (`LATE_TICKS`; la commande « redire » les dit tout de suite), ce qui allège la rafale du départ. Et la page **ne dépend plus des lignes dites une seule fois**: `@@n`, dite dix fois par seconde, porte l'état, la figure, le
  numéro du pas et la distance, d'où le store (`src/store.js`) tire le début du trait (sans `@@draw`), le retour au premier pas (sans `@@rep`), le début d'un pas (sans `@@seg`), la fin (sans `@@end`, c'est l'état
  `blink`) et l'arrêt (sans `@@stop`, c'est l'état `idle`). Le test `tests/store.test.js` rejoue les lignes du journal réel; `window.fakeRobot.flags.lose` (un motif) laisse perdre des lignes dans le faux robot.
  Le départ est aussi reconnu à `@@state draw` ou à un `@@n` qui dit `draw`, pas seulement à `@@ack` et `@@draw`.
- **Le trait**: rien ne mesure la position du robot sur la feuille. La page la **reconstitue**: le cap vient du gyroscope, la distance est **additionnée par le robot à chaque tick de 20 ms**
  d'après la vitesse mesurée des roues (la fin de `@@n`), comme un odomètre (`Odometer` dans `src/geometry.js`). Un côté commence et finit entre deux lignes `@@n` de 100 ms: calculée à partir
  de ces seules lignes, la distance se trompait de quelques millimètres à chaque côté (et perdait les 100 premières ms), si bien que l'encre passait à côté du tracé prévu, surtout sur une forme à
  petits côtés; `tests/ink.test.js` vérifie qu'elle reste à moins de 1,5 mm du tracé et finit où le robot est. C'est proche du vrai tracé, pas exact; et le robot réel ne sait pas où
  il est sur la feuille: **on le pose comme sur l'écran** avant de lancer. Cette reconstitution ne sert plus qu'au robot virtuel et aux tests: avec un vrai robot, `Telemetry.follow` ne fait rien (ni encre, ni déplacement du robot de l'écran),
  seuls l'étape, le côté ou le virage en cours, l'état et le nombre de dessins sont tenus à jour (par `@@n`, même quand `@@draw`, `@@seg` ou `@@end` se perdent).
- **Moteurs**: la commande des actionneurs règle aussi les roues (`SetMotorTargets` dans `ble_spp.c`): les trames portent les vitesses que le robot vient de dire, et le mode (ou le
  contrôleur d'angle du firmware) les redonne au tick suivant. Un message pendant un dessin ne dérange donc les roues que pendant ≤ 20 ms.
- **Lumières**: le canal de réception est le vert de la LED avant gauche (jamais à 15 dans les lumières du mode). Un message fait clignoter le corps ≤ 20 ms; les LED Lego sont
  redessinées au tick suivant.

## Le robot virtuel

`src/sim/physics.js` (deux roues, le gyroscope en ticks, le minuteur « 15 cm » du firmware, le contrôleur d'angle: **le même modèle, opération par opération, que
`tests/fake_drawer_robot.py`** qui fait tourner le vrai script Python), `src/sim/drawer-mode.js` (le **mode, réécrit en JavaScript**, ligne à ligne),
`src/sim/virtual-robot.js`, `src/sim/sim-backend.js`. Il produit les mêmes événements que le vrai robot et reçoit les mêmes messages (les mêmes trames). **Il n'a pas de capteur de
couleur** (ni de réglage du sol): son corps reste éteint. (Le faux robot Bluetooth `?fakerobot`, qui joue un vrai robot, a `window.fakeRobot.ground('r')` pour essayer la couleur.)

`?fakerobot` dans l'adresse remplace Bluetooth et le robot par un **faux robot** (`src/dev/fake-thymio.js`, même interface que `thymio3-ts-api`): téléversement du module, lanceur,
trames, arrêt… `window.fakeRobot` laisse jouer le côté du robot (`press(bouton)`, `hand(true)`, `ground('r')`, `flags.live = 'drop' | 'garble'`, `step(n)`).

## Lancer, tester, déployer

```bash
npm install          # l'API Thymio vient de GitHub: github:Mobsya/thymio3-ts-api#main
npm run dev          # http://localhost:5173 (Web Bluetooth demande https ou localhost: Chrome, Edge, Bluefy sur iPhone)
npm test             # JavaScript (node --test), liaison, Python
npm run golden       # réécrit tests/golden-drawer.json si le mode Python change
npm run build
```

**Démo en ligne**: https://francescomondada.github.io/thymio3-draw/ (GitHub Pages). Le workflow `.github/workflows/deploy.yml` (le même que dans thymio3-learn et thymio3-cards) construit la page à chaque envoi sur `main` et la publie. Le dépôt est https://github.com/FrancescoMondada/thymio3-draw. C'est cette adresse que les codes QR « Lien vers l'application » contiennent (`APP_URL` dans `src/share.js`).

## Statut — à lire

**Essayé sur un vrai robot le 2026-11-01** (polygones, forme libre, lignes perdues en route, longueurs mesurées sur le papier: voir plus haut); le reste n'a pas été essayé. Vérifié sans robot:

- `tests/test_drawer_mode.py` fait tourner **le vrai script Python** sur un robot virtuel (59 tests): les 16 figures finissent où la table du mode le dit (à 4 mm près, et le cap à quelques degrés); les
  lignes `@@seg`; la durée d'un côté (1,2 s, 0,6 s à partir de l'hexagone) et des pauses; les trois clignotements; le cercle et le huit; un moteur faible de 4 % et une échelle de
  gyroscope différente donnent encore un carré qui se ferme; les flèches (avec le retour à la ligne de chaque rangée), les LED Lego, la main (et ce qui n'en est pas une), le bouton du
  milieu; les messages de la page (figure, dessiner, stop à n'importe quel moment, quitter, figure inconnue, trame fausse, message en plusieurs trames); **la taille** (durée des côtés, cercles et huit de 40 à 300 %, plage, pas de changement en plein dessin); **la forme libre** (un carré qui se ferme, virage sur place d'abord, côtés sans virage, virage à droite, forme vide, 24 côtés au plus, forme figée pendant un dessin, passage par le lanceur); **la forme répétée** (un carré refait sur lui-même avec l'angle de fin, un motif qui repart d'où il s'est arrêté, un côté et un angle qui font un pentagone, l'angle d'arrêt, un stop en plein milieu); jamais 15 sur le canal des
  messages; les couleurs du corps; un robot sans capteur de couleur; la taille du module.
- `tests/drawer.test.js`: le **jumeau JavaScript fait exactement ce que fait le Python**, ligne par ligne et à la milliseconde, sur 20 scénarios (les 16 figures, les flèches et une
  main, les messages de la page, trois tailles, une forme libre et deux formes répétées): mêmes lignes, mêmes sons, même position finale (`tests/golden-drawer.json`). Le robot virtuel, ses LED, son sol coloré, son déplacement.
- `tests/figures.test.js`: la table des figures du mode Python, celle du jumeau et celle de la page sont la même.
- `tests/link.test.js`: la liaison complète (connexion, module installé une fois, lanceur, figure, dessiner, stop, trames perdues → relance avec le changement, l'encre et la position
  dans le store, le départ d'une forme seul dans son message, les trames espacées de 40 ms sur une liaison rapide, une réponse de départ perdue sans relance) contre le faux robot Bluetooth.
- `tests/geometry.test.js`, `tests/protocol.test.js`, `tests/store.test.js`, `tests/i18n.test.js` (aucune clé de langue manquante).
- La page a été regardée dans un navigateur (ordinateur 1100 × 760 clair et sombre, 375 × 812, 360 × 640, 844 × 390; robot virtuel et faux robot; vue Zoom et vue A4).

**Pas vérifié, à regarder avec un vrai robot:**

- **L'échelle d'un autre robot**: le modèle d'accélération est ajusté sur un seul robot (calibration 8 142 712) et deux carrés. Il suppose que la perte vient de l'accélération du firmware (la même sur tous les robots) et que la
  calibration « 15 cm » de chaque robot dit sa vitesse. Un autre robot, ou un côté de 15 à 20 mm, peut s'écarter de quelques dixièmes de millimètre: à mesurer sur une feuille.
- **Les dimensions.** Le côté est « 140 pendant 1,2 s »; en millimètres, c'est la calibration « 15 cm » du robot (faite à la vitesse 300) qui le donne: environ **47 mm** avec celle
  d'usine (0,278 mm/s par unité de vitesse), un carré de 4,7 cm, un cercle de 9,4 cm (l'écartement des roues est pris à 94 mm, comme dans thymio3-cards, mais le dessin du robot
  l'a à 96). **Mesuré sur un vrai robot (2026-11-01)**: ces 47 mm sont trop petits, un carré annoncé à 31 mm en fait 34 et un carré annoncé à 82 mm en fait 92, parce que la calibration « 15 cm » contient l'accélération et le freinage
  (voir plus haut, `robotModel`). Avec un vrai robot la page donne donc, pour la calibration d'usine, un côté de 47,6 mm (49,8 mm sans la perte de 2,2 mm); le robot virtuel garde 46,7 mm.
- que **le stylo est bien au milieu de l'axe des roues** (le trou du milieu du dessin du robot);
- **la taille et la forme libre sur le vrai robot**, qui sont mes ajouts: un cercle plus petit que celui du firmware fait **reculer une roue** (jusqu'à −60 à 40 %), un plus grand roule sur les deux (la
  durée d'un tour grandit avec le rayon: 30 s pour un cercle à 300 %); la proportionnalité de la longueur et de la durée à la vitesse 140; les virages d'une forme libre (additions de degrés entiers,
  jusqu'à ±360°) et sa précision sur une vraie feuille; le temps d'envoi d'une forme de 24 côtés (une dizaine de messages de trames);
- le débit de la sortie (une ligne de 100 octets toutes les 100 ms, comme thymio3-learn, jamais éprouvé), (le trait reconstitué n'est plus montré avec un vrai robot);
- que `imu.rotate_deg(0, 0)` arrête bien un virage en cours (c'est le nettoyage du mode Séquence de thymio3-cards, qui marche sur un robot, mais l'arrêt en plein virage est nouveau);
- le **déplacement du robot au doigt** sur téléphone et tablette (`touch-action: none` sur le robot et sa poignée: la page défile quand on touche ailleurs), Safari, l'iPhone
  (Bluefy), l'iPad;
- la lecture de la couleur à 50 Hz (`COLOR_SENSOR().get_hsv()` à chaque tick; thymio3-cards ne la lit que quelques ticks);
- **la caméra d'un vrai téléphone ou d'une tablette** (le navigateur de développement la bloque): le code affiché a été relu, à partir de son image, par la voie « photo » (`QrScan`), et le code le plus grand relu par jsQR dans les tests;
  les distances d'une vraie classe, et le format d'une photo d'écran, sont à essayer;
- les langues: le français et l'anglais sont écrits avec soin, **l'italien et l'allemand sont de moi, à faire relire**.

## Organisation

| Fichier | Rôle |
| --- | --- |
| `src/py/drawer_mode.py` | Le mode dessinateur en MicroPython, qui tourne sur le robot |
| `src/spec.js` | Les 16 figures (la table du mode), les nombres du firmware, les états, les couleurs |
| `src/geometry.js` | Le trajet du stylo de chaque figure, la recette, la fermeture, la durée; `Odometer` (le trait reconstitué) |
| `src/protocol.js` | Lignes `@@`, trames dans les LED, objets des messages |
| `src/share.js`, `src/qr.js`, `src/names.js` | Le texte du code QR (écrit et lu strictement), le dessin et la lecture d'un code, les pseudos |
| `src/script.js`, `src/script-core.js` | Le mode comme module (réduit, nom à base de hash) |
| `src/robot/robot-backend-core.js`, `robot-backend.js` | Liaison Web Bluetooth: file d'opérations, module, lanceur, messages, acquittement, repli, journal |
| `src/sim/*` | Physique du robot, mode en JavaScript, robot virtuel |
| `src/dev/fake-thymio.js`, `src/api.js` | Faux robot Bluetooth (`?fakerobot`); `api.js` choisit le vrai ou le faux |
| `src/store.js` | Ce que la page sait du robot: figure, position, encre, étape |
| `src/App.jsx` | État, robot virtuel ou réel, clavier, mise en page |
| `src/components/Sheet.jsx`, `RobotBody.jsx` | La feuille (grille, pointillé, encre, robot qu'on tire et qu'on tourne) et le dessin du robot |
| `src/components/Picker.jsx`, `FigureIcon.jsx`, `SizeControl.jsx`, `Recipe.jsx`, `DrawBar.jsx` | Les deux rangées de figures et l'onglet « Ma forme », les vignettes, la taille, la recette, Dessiner / Stop et ce qui est sous la feuille |
| `src/components/QrShow.jsx`, `QrScan.jsx` | Le code en grand avec son pseudo et sa date; le lecteur (caméra derrière un viseur, ou une photo) |
| `src/components/Settings.jsx`, `Help.jsx`, `LinkInfo.jsx`, `ErrorBoundary.jsx` | Paramètres (langue, thème, pseudo, diagnostic), aide, nom et batterie du robot |
| `src/i18n.js`, `src/styles.css` | Textes (FR, EN, IT, DE) et style (couleurs en jetons, clair et sombre) |
| `tests/` | `node --test`, liaison, Python (`test_drawer_mode.py`, `fake_drawer_robot.py`) |
