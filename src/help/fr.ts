// Contenu de l'aide en français — Help-Spec.md §3.
//
// Mêmes règles éditoriales que en.ts : ne pas paraphraser l'interface (les
// infobulles s'en chargent), deux phrases par idée, nommer les choses comme
// l'interface les nomme, et ne documenter que ce qui est déployé (HL9).
//
// `keywords` sont des termes de recherche, pas des traductions : on y met les
// mots qu'un lecteur taperait vraiment — y compris les anglicismes courants
// ("gantt", "kanban") et les variantes ("salaire", "paie").
import type { HelpDoc } from "./types";

export const help: HelpDoc = {
  reviewedAgainst: "2026-07",
  sections: [
    {
      id: "canvas",
      title: "Le canevas",
      body:
        "Votre feuille de route est un canevas en 2D : le temps va de gauche à droite et chaque bloc est " +
        "une tâche. Les bandes horizontales sont les epics — les groupes dans lesquels vous organisez le travail.",
      keywords: ["gantt", "chronologie", "planning", "diagramme", "roadmap", "tableau", "grille", "couloirs"],
      bullets: [
        { term: "Déplacer une tâche", text: "Faites glisser depuis le milieu. Déposez-la sur la bande d'un autre epic pour l'y déplacer." },
        { term: "Changer les dates", text: "Faites glisser le bord gauche ou droit." },
        { term: "Ouvrir une tâche", text: "Cliquez dessus, puis utilisez l'onglet Détails à droite." },
        { term: "Ajouter une tâche", text: "Double-cliquez sur le canevas vide, ou + Tâche dans la barre d'outils." },
      ],
    },
    {
      id: "effort",
      title: "La hauteur du bloc, c'est la charge",
      body:
        "C'est ce qui surprend : la hauteur d'un bloc n'est pas décorative. Elle indique l'effort " +
        "parallèle que la tâche demande par jour — un bloc haut est donc plus lourd qu'un bloc bas de même longueur.",
      keywords: ["haut", "bas", "taille", "redimensionner", "effort", "jours-homme", "estimation", "capacite", "charge"],
      bullets: [
        { term: "Effort du graphe", text: "Jours ouvrés × travail par jour. Faites glisser le bord inférieur pour changer la hauteur." },
        { term: "Effort estimé", text: "Suit la forme du bloc jusqu'à ce que vous le verrouilliez avec 🔒 ; ↺ le déverrouille." },
        { term: "Effort affecté", text: "Ce que les personnes affectées totalisent réellement, selon leur % d'allocation." },
        { term: "Le point coloré", text: "Vert : l'équipe correspond à l'estimation ; rouge : sous-effectif ; ambre : sur-effectif." },
        { term: "⇥ ajuster la durée", text: "Redimensionne la tâche pour que l'équipe actuelle livre exactement l'estimation." },
        { term: "Week-ends", text: "Exclus de l'effort et du coût, sauf si vous activez l'option week-end pour cette tâche." },
      ],
    },
    {
      id: "navigation",
      title: "Se déplacer",
      body:
        "Il y a deux zooms différents, et mieux vaut le savoir avant de chercher : l'un met toute l'image " +
        "à l'échelle, l'autre étire le temps lui-même.",
      keywords: ["zoom", "agrandir", "reduire", "defilement", "deplacer", "ajuster", "aujourd hui", "semaine", "mois", "densite"],
      bullets: [
        { term: "Déplacement", text: "Faites glisser le canevas vide pour parcourir le temps ou monter et descendre." },
        { term: "Zoom d'affichage", text: "⌘/Ctrl + molette, ou les boutons +/−. Met tout à l'échelle." },
        { term: "Largeur du jour", text: "Étire ou comprime l'axe du temps sans redimensionner les blocs." },
        { term: "Jour / semaine / mois", text: "Change la densité d'affichage du temps et ce que montre la règle." },
        { term: "ajuster", text: "Dézoome jusqu'à ce que toute la feuille de route tienne à l'écran." },
        { term: "compacter", text: "Réorganise les epics pour que des tâches qui ne se chevauchent pas partagent une ligne." },
      ],
    },
    {
      id: "people",
      title: "Personnes et charge",
      body:
        "L'onglet Équipe liste tout le monde sur le Pulse. Faites glisser une personne sur une tâche pour " +
        "l'affecter, puis indiquez quelle part de son temps cela prend.",
      keywords: ["affecter", "ressource", "equipe", "qui", "allocation", "utilisation", "surcharge", "occupe"],
      bullets: [
        { term: "Affecter", text: "Faites glisser une pastille depuis Équipe sur une tâche — c'est 100 % de son temps par défaut." },
        { term: "% d'allocation", text: "Par personne et par tâche, dans l'onglet Détails. 50 % correspond à une demi-journée." },
        { term: "Capacité", text: "La limite d'occupation d'une personne, définie dans l'onglet Capacité. Au-delà, l'affichage passe au rouge." },
        { term: "Panneau d'affectation", text: "Le panneau du bas : une ligne par personne, alignée dans le temps avec le canevas." },
        { term: "★ référent", text: "Indique qui pilote une tâche. Un Référent de tâche peut modifier les tâches qu'il pilote." },
      ],
    },
    {
      id: "costs",
      title: "Coûts",
      body:
        "Basculez le panneau du bas sur Coûts pour voir ce que coûte la feuille de route dans le temps. " +
        "La dépense d'IA est enregistrée par tâche ; le coût des personnes se déduit des affectations et des taux horaires.",
      keywords: ["argent", "budget", "prix", "salaire", "paie", "taux", "horaire", "tokens", "ia", "depense", "heures", "usd", "dollars"],
      bullets: [
        { term: "Coûts d'IA", text: "À saisir sur une tâche dans l'onglet Détails : tokens et montant dépensé." },
        { term: "Coût unitaire", text: "Calculé à partir de ce que vous avez saisi, pas d'un tarif catalogue — c'est donc votre coût réel." },
        { term: "Coûts des personnes", text: "Heures × coût horaire, les heures venant de l'affectation et de la durée de la tâche." },
        { term: "Taux horaires", text: "Définis dans l'onglet Capacité. Visibles uniquement par les administrateurs du Pulse, comme les coûts qui en découlent." },
        { term: "La vue Coûts", text: "Regroupez par modèle, personne ou tâche ; basculez entre $ et quantité ; les totaux couvrent tout l'historique." },
        { term: "Une réserve", text: "Les chiffres d'IA sont ce qui a été dépensé ; ceux des personnes sont ce qu'implique le plan. C'est une estimation, pas de la comptabilité." },
      ],
    },
    {
      id: "plan",
      title: "Plan et réalité",
      body:
        "Figez ce que vous aviez promis au départ, puis observez la réalité s'en écarter.",
      keywords: ["reference", "baseline", "retard", "derive", "glissement", "initial", "promis", "echeance"],
      bullets: [
        { term: "📌 figer le plan", text: "Enregistre les dates actuelles de la tâche comme référence." },
        { term: "Retards", text: "Dessine la référence en barre pointillée sous chaque tâche, avec l'écart en jours." },
        { term: "Rattrapé", text: "S'affiche quand un démarrage tardif est rattrapé d'ici la date de livraison." },
      ],
    },
    {
      id: "collab",
      title: "Travailler ensemble",
      body:
        "Partagez un Pulse par un lien, et chacun voit les changements au fil de l'eau.",
      keywords: ["inviter", "partager", "permission", "role", "lecteur", "editeur", "proprietaire", "commentaire", "mention", "historique", "qui a modifie", "masquer", "archiver", "lecture seule", "termine"],
      bullets: [
        { term: "Inviter", text: "Créez un lien et envoyez-le. Le rôle que vous choisissez est celui que reçoivent les arrivants." },
        { term: "Propriétaire / Éditeur", text: "Le propriétaire gère les personnes et les réglages ; l'éditeur modifie tout le reste." },
        { term: "Lecteur complet", text: "Lit tout le Pulse et peut commenter, mais ne peut rien modifier." },
        { term: "Lecteur de son périmètre", text: "Ne voit que les tâches auxquelles sa propre ressource est affectée." },
        { term: "Référent de tâche", text: "Modifie uniquement les tâches qu'il pilote et lit le reste." },
        { term: "Commentaires", text: "Sur n'importe quelle tâche, avec @ pour mentionner une personne ou lier une tâche." },
        { term: "Activité", text: "Un journal durable de qui a changé quoi, et quand." },
        { term: "Masquer", text: "Retire un Pulse de votre propre tableau de bord. Personne d'autre ne le remarque et rien d'autre ne change." },
        { term: "Archiver", text: "Propriétaire uniquement. Passe un Pulse terminé en lecture seule pour tout le monde jusqu'à désarchivage par un propriétaire. Rien n'est supprimé et cela ne libère pas de place dans l'offre." },
      ],
    },
    {
      id: "board",
      title: "Tableau, filtres et annulation",
      body:
        "Les mêmes tâches vues comme un tableau plutôt qu'une chronologie — plus les outils pour retrouver " +
        "les choses et revenir sur ses erreurs.",
      keywords: ["kanban", "statut", "colonne", "recherche", "filtre", "annuler", "retablir", "erreur", "ctrl z"],
      bullets: [
        { term: "Vue tableau", text: "Colonnes kanban par statut. Faites glisser une tâche de l'une à l'autre pour changer son statut." },
        { term: "Statuts", text: "Modifiables par Pulse. Terminé est toujours en dernier et verrouille la tâche." },
        { term: "Filtres", text: "Par texte, statut ou epic. Les tâches non concernées s'atténuent au lieu de disparaître." },
        { term: "Mon périmètre", text: "Réduit l'affichage aux tâches sur lesquelles vous êtes." },
        { term: "Annuler / rétablir", text: "⌘Z et ⇧⌘Z (Ctrl sous Windows). Couvre les modifications, déplacements et suppressions." },
      ],
    },
  ],
};
