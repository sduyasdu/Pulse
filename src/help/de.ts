// Hilfe-Inhalte auf Deutsch — Help-Spec.md §3.
//
// Dieselben redaktionellen Regeln wie in en.ts: die Oberfläche nicht
// nacherzählen (dafür sind Tooltips da), zwei Sätze pro Gedanke, Dinge so
// benennen wie die UI sie benennt, und nur dokumentieren, was tatsächlich
// ausgeliefert ist (HL9).
//
// `keywords` sind Suchbegriffe, keine Übersetzungen: dort stehen die Wörter, die
// jemand wirklich eintippen würde — inklusive geläufiger Anglizismen ("gantt",
// "kanban") und Varianten ("gehalt", "lohn"). fold() ersetzt ß durch ss, also
// finden beide Schreibweisen.
import type { HelpDoc } from "./types";

export const help: HelpDoc = {
  reviewedAgainst: "2026-08",
  sections: [
    {
      id: "canvas",
      title: "Die Arbeitsfläche",
      body:
        "Deine Roadmap ist eine 2D-Fläche: die Zeit läuft von links nach rechts, und jeder Block ist eine " +
        "Aufgabe. Die waagerechten Bänder sind Epics — die Gruppen, in denen du die Arbeit ordnest.",
      keywords: ["gantt", "zeitstrahl", "zeitplan", "diagramm", "roadmap", "board", "raster", "spuren"],
      bullets: [
        { term: "Aufgabe verschieben", text: "In der Mitte ziehen. Auf das Band eines anderen Epics ziehen, um sie dorthin zu verschieben." },
        { term: "Daten ändern", text: "Den linken oder rechten Rand ziehen." },
        { term: "Aufgabe öffnen", text: "Anklicken und rechts den Reiter Details verwenden." },
        { term: "Aufgabe hinzufügen", text: "Doppelklick auf die leere Fläche, oder + Aufgabe in der Werkzeugleiste." },
      ],
    },
    {
      id: "effort",
      title: "Die Höhe des Blocks ist Arbeit",
      body:
        "Das überrascht die meisten: die Höhe eines Blocks ist keine Dekoration. Sie zeigt, wie viel " +
        "parallelen Aufwand die Aufgabe pro Tag braucht — ein hoher Block ist also schwerer als ein flacher gleicher Länge.",
      keywords: ["hoch", "flach", "grosse", "groesse", "skalieren", "aufwand", "personentage", "schatzung", "kapazitat", "auslastung"],
      bullets: [
        { term: "Graph-Aufwand", text: "Arbeitstage × Arbeit pro Tag. Zieh den unteren Rand, um die Höhe zu ändern." },
        { term: "Geschätzter Aufwand", text: "Folgt der Form des Blocks, bis du ihn mit 🔒 fixierst; ↺ gibt ihn wieder frei." },
        { term: "Zugewiesener Aufwand", text: "Was die zugewiesenen Personen tatsächlich ergeben, gemäß ihrem Anteil in %." },
        { term: "Der farbige Punkt", text: "Grün: Team passt zur Schätzung; rot: zu wenig Leute; bernstein: zu viele." },
        { term: "⇥ Länge anpassen", text: "Ändert die Dauer so, dass das aktuelle Team genau die Schätzung liefert." },
        { term: "Wochenenden", text: "Zählen weder für Aufwand noch Kosten, außer du aktivierst die Wochenend-Option für diese Aufgabe." },
      ],
    },
    {
      id: "navigation",
      title: "Navigieren",
      body:
        "Es gibt zwei verschiedene Zooms, und das sollte man wissen, bevor man sucht: der eine skaliert " +
        "das ganze Bild, der andere dehnt die Zeit selbst.",
      keywords: ["zoom", "vergrossern", "verkleinern", "scrollen", "verschieben", "einpassen", "heute", "woche", "monat", "dichte"],
      bullets: [
        { term: "Verschieben", text: "Zieh die leere Fläche, um durch die Zeit zu fahren oder nach oben und unten zu gehen." },
        { term: "Ansichts-Zoom", text: "⌘/Strg + Scrollen, oder die +/−-Schaltflächen. Skaliert alles." },
        { term: "Tagesbreite", text: "Dehnt oder staucht die Zeitachse, ohne die Blöcke zu verändern." },
        { term: "Tag / Woche / Monat", text: "Ändert, wie dicht die Zeit gezeichnet wird und was das Lineal zeigt." },
        { term: "einpassen", text: "Zoomt heraus, bis die ganze Roadmap auf den Bildschirm passt." },
        { term: "kompaktieren", text: "Packt Epics neu, sodass zeitlich überschneidungsfreie Aufgaben eine Zeile teilen." },
      ],
    },
    {
      id: "people",
      title: "Personen und Auslastung",
      body:
        "Der Reiter Team listet alle im Beat. Zieh eine Person auf eine Aufgabe, um sie zuzuweisen, und " +
        "leg dann fest, welchen Anteil ihrer Zeit das kostet.",
      keywords: ["zuweisen", "ressource", "team", "wer", "zuteilung", "auslastung", "uberlastung", "beschaftigt"],
      bullets: [
        { term: "Zuweisen", text: "Zieh einen Chip aus dem Team auf eine Aufgabe — standardmäßig sind das 100 % ihrer Zeit." },
        { term: "% Zuteilung", text: "Pro Person und Aufgabe, im Reiter Details. 50 % heißt ein halber Arbeitstag." },
        { term: "Kapazität", text: "Die Auslastungsgrenze einer Person, im Reiter Kapazität. Darüber wird es rot." },
        { term: "Zuweisungs-Panel", text: "Das untere Panel: eine Zeile pro Person, zeitlich zur Arbeitsfläche ausgerichtet." },
        { term: "★ Leitung", text: "Markiert, wer eine Aufgabe leitet. Eine Aufgabenleitung darf die von ihr geleiteten Aufgaben bearbeiten." },
      ],
    },
    {
      id: "roster",
      title: "Personen über Beats hinweg",
      body:
        "Personen — von der Übersicht aus — ist die Liste aller Menschen deiner Organisation, getrennt "
        + "von einzelnen Beats. Füge jemanden einmal dort hinzu und hole ihn in beliebig viele Beats.",
      keywords: ["pool", "master", "organisation", "verzeichnis", "team", "rolle", "wiederverwenden", "geteilt", "alle"],
      bullets: [
        { term: "Zu einem Beat hinzufügen", text: "Im Team-Tab eines Beat „aus Personen“ nutzen. Einzelne Personen oder ein ganzes Team." },
        { term: "Es ist eine Kopie", text: "Kapazität und Typ gehören diesem Beat. Name und Rolle folgen der Organisation und ändern sich überall." },
        { term: "Teams", text: "Gruppiere Personen auf dem Personen-Bildschirm. Ziehe jemanden auf eine Teamkarte oder nutze die Schaltflächen auf der Karte." },
        { term: "Rolle und Typ", text: "Die Rolle gehört der Organisation und ist überall gleich. Der Typ ist die Gruppierung des jeweiligen Beat." },
        { term: "Verknüpft / Wartet", text: "Verknüpft: Diese E-Mail gehört einem Mitglied. Wartet: Die Person ist noch nicht beigetreten — sie verknüpft sich dann selbst." },
        { term: "Verknüpfen ist kein Zugriff", text: "Es sagt, wer jemand ist, nicht was er öffnen darf. Zu jedem Beat muss die Person weiterhin eingeladen werden — und das Einladungsformular schlägt genau die vor, die es noch nicht sind." },
        { term: "Wo sie mitarbeitet", text: "Auf ihrer Karte. Listet alle Beats auf, in denen sie ist — auch die, die du nicht öffnen kannst." },
      ],
    },
    {
      id: "costs",
      title: "Kosten",
      body:
        "Schalte das untere Panel auf Kosten, um zu sehen, was die Roadmap über die Zeit kostet. " +
        "KI-Ausgaben werden pro Aufgabe erfasst; Personalkosten ergeben sich aus Zuweisungen und Stundensätzen.",
      keywords: ["geld", "budget", "preis", "gehalt", "lohn", "satz", "stundensatz", "tokens", "ki", "ausgaben", "stunden", "usd", "dollar"],
      bullets: [
        { term: "KI-Kosten", text: "An der Aufgabe im Reiter Details eintragen: Tokens und was ausgegeben wurde." },
        { term: "Stückkosten", text: "Errechnet aus dem, was du eingetragen hast, nicht aus einer Preisliste — also dein echter Satz." },
        { term: "Personalkosten", text: "Stunden × Stundenkosten, wobei die Stunden aus Zuweisung und Aufgabendauer kommen." },
        { term: "Stundensätze", text: "Im Reiter Kapazität. Nur für Beat-Administratoren sichtbar, ebenso die daraus abgeleiteten Kosten." },
        { term: "Die Kostenansicht", text: "Nach Modell, Person oder Aufgabe gruppieren; zwischen $ und Menge wechseln; Summen sind über den gesamten Zeitraum." },
        { term: "Ein Vorbehalt", text: "KI-Zahlen sind tatsächlich ausgegeben; Personenzahlen sind das, was der Plan impliziert. Eine Schätzung, keine Buchhaltung." },
      ],
    },
    {
      id: "plan",
      title: "Plan gegen Realität",
      body:
        "Friere ein, was du ursprünglich zugesagt hast, und sieh dann zu, wie die Realität davon abweicht.",
      keywords: ["basislinie", "baseline", "verzug", "verspatung", "abweichung", "ursprunglich", "zugesagt", "termin"],
      bullets: [
        { term: "📌 Plan fixieren", text: "Speichert die aktuellen Daten der Aufgabe als Basislinie." },
        { term: "Verzüge", text: "Zeichnet die Basislinie als gestrichelten Balken unter jeder Aufgabe, mit der Differenz in Tagen." },
        { term: "Aufgeholt", text: "Erscheint, wenn ein später Start bis zum Liefertermin wieder aufgeholt wurde." },
      ],
    },
    {
      id: "collab",
      title: "Zusammenarbeiten",
      body:
        "Lade eine bestimmte Person ein oder teile einen Link, den jeder nutzen kann. Alle sehen Änderungen, während sie passieren.",
      keywords: ["einladen", "teilen", "berechtigung", "rolle", "leser", "editor", "eigentumer", "kommentar", "erwahnung", "verlauf", "wer hat geandert", "ausblenden", "archivieren", "schreibgeschutzt", "fertig", "e-mail", "bestatigen", "verifizieren", "einladung", "beitreten"],
      bullets: [
        { term: "Eine Person einladen", text: "Nur wer diese Adresse besitzt, kann annehmen — der Link lässt sich also überall einfügen. Wer hier schon mit einer Ressource verknüpft ist, wird in der Liste vorgeschlagen." },
        { term: "Einladungslink", text: "Wer ihn öffnet, tritt mit der gewählten Rolle bei — teile ihn also dort, wo genau das gewollt ist. Jederzeit widerrufbar." },
        { term: "E-Mail bestätigen", text: "Einladungen erreichen dich erst, wenn du deine Adresse bestätigt hast. Das Dashboard weist darauf hin und kann die E-Mail erneut senden." },
        { term: "Eigentümer / Editor", text: "Der Eigentümer verwaltet Personen und Einstellungen; der Editor ändert alles andere." },
        { term: "Voller Leser", text: "Liest den ganzen Beat und darf kommentieren, aber nichts ändern." },
        { term: "Leser des eigenen Bereichs", text: "Sieht nur die Aufgaben, denen die eigene Ressource zugewiesen ist." },
        { term: "Aufgabenleitung", text: "Bearbeitet nur die selbst geleiteten Aufgaben und liest den Rest." },
        { term: "Kommentare", text: "An jeder Aufgabe, mit @ für die Erwähnung einer Person oder die Verknüpfung einer Aufgabe." },
        { term: "Aktivität", text: "Ein dauerhaftes Protokoll, wer was wann geändert hat." },
        { term: "Ausblenden", text: "Nimmt einen Beat von deinem eigenen Dashboard. Niemand sonst merkt es, sonst ändert sich nichts." },
        { term: "Archivieren", text: "Nur Eigentümer. Setzt einen abgeschlossenen Beat für alle auf schreibgeschützt, bis ein Eigentümer ihn wieder aktiviert. Nichts wird gelöscht, und es gibt keinen Tarifplatz frei." },
      ],
    },
    {
      id: "board",
      title: "Board, Filter und Rückgängig",
      body:
        "Dieselben Aufgaben als Board statt als Zeitstrahl — dazu die Werkzeuge zum Finden und zum " +
        "Zurücknehmen von Fehlern.",
      keywords: ["kanban", "status", "spalte", "suche", "filter", "ruckgangig", "wiederherstellen", "fehler", "strg z"],
      bullets: [
        { term: "Board-Ansicht", text: "Kanban-Spalten nach Status. Zieh eine Aufgabe zwischen ihnen, um den Status zu ändern." },
        { term: "Status", text: "Pro Beat bearbeitbar. Fertig steht immer am Ende und sperrt die Aufgabe." },
        { term: "Filter", text: "Nach Text, Status oder Epic. Nicht passende Aufgaben werden blass statt zu verschwinden." },
        { term: "Mein Bereich", text: "Reduziert alles auf die Aufgaben, an denen du beteiligt bist." },
        { term: "Rückgängig / Wiederherstellen", text: "⌘Z und ⇧⌘Z (Strg unter Windows). Umfasst Änderungen, Verschiebungen und Löschungen." },
      ],
    },
  ],
};
