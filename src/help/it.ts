// Contenuto della guida in italiano — Help-Spec.md §3.
//
// Stesse regole editoriali di en.ts: non ripetere l'interfaccia (ci pensano i
// tooltip), due frasi per concetto, chiamare le cose come le chiama la UI e
// documentare solo ciò che è effettivamente rilasciato (HL9).
//
// `keywords` sono termini di ricerca, non traduzioni: si mettono le parole che
// un lettore digiterebbe davvero — inclusi gli anglicismi d'uso ("gantt",
// "kanban") e le varianti ("stipendio", "paga").
import type { HelpDoc } from "./types";

export const help: HelpDoc = {
  reviewedAgainst: "2026-07",
  sections: [
    {
      id: "canvas",
      title: "La tela",
      body:
        "La tua roadmap è una tela 2D: il tempo scorre da sinistra a destra e ogni riquadro è un'attività. " +
        "Le fasce orizzontali sono gli epic, i gruppi in cui organizzi il lavoro.",
      keywords: ["gantt", "linea del tempo", "cronoprogramma", "diagramma", "roadmap", "bacheca", "griglia", "corsie"],
      bullets: [
        { term: "Spostare un'attività", text: "Trascinala dal centro. Rilasciala sulla fascia di un altro epic per spostarla lì." },
        { term: "Cambiare le date", text: "Trascina il bordo sinistro o destro." },
        { term: "Aprire un'attività", text: "Cliccala e usa la scheda Dettagli sulla destra." },
        { term: "Aggiungere un'attività", text: "Doppio clic sulla tela vuota, oppure + Attività nella barra degli strumenti." },
      ],
    },
    {
      id: "effort",
      title: "L'altezza del riquadro è lavoro",
      body:
        "È la parte che sorprende: l'altezza di un riquadro non è decorativa. Indica quanto sforzo " +
        "parallelo richiede l'attività al giorno, quindi un riquadro alto è lavoro più pesante di uno basso della stessa lunghezza.",
      keywords: ["alto", "basso", "dimensione", "ridimensionare", "sforzo", "giorni uomo", "stima", "capacita", "carico"],
      bullets: [
        { term: "Sforzo del grafico", text: "Giorni lavorativi × lavoro al giorno. Trascina il bordo inferiore per cambiare l'altezza." },
        { term: "Sforzo stimato", text: "Segue la forma del riquadro finché non lo blocchi con 🔒; ↺ lo sblocca di nuovo." },
        { term: "Sforzo assegnato", text: "Quanto sommano davvero le persone assegnate, in base alla loro % di allocazione." },
        { term: "Il punto colorato", text: "Verde: la squadra corrisponde alla stima; rosso: manca gente; ambra: ce n'è troppa." },
        { term: "⇥ adatta la durata", text: "Ridimensiona l'attività perché la squadra attuale consegni esattamente la stima." },
        { term: "Fine settimana", text: "Esclusi da sforzo e costo, a meno che tu non attivi l'opzione weekend per quell'attività." },
      ],
    },
    {
      id: "navigation",
      title: "Muoversi",
      body:
        "Ci sono due zoom diversi, e conviene saperlo prima di mettersi a cercare: uno scala l'immagine " +
        "intera, l'altro allunga il tempo stesso.",
      keywords: ["zoom", "ingrandire", "rimpicciolire", "scorrere", "spostare", "adatta", "oggi", "settimana", "mese", "densita"],
      bullets: [
        { term: "Spostamento", text: "Trascina la tela vuota per scorrere il tempo o muoverti su e giù." },
        { term: "Zoom della vista", text: "⌘/Ctrl + rotella, oppure i pulsanti +/−. Scala tutto." },
        { term: "Larghezza del giorno", text: "Allunga o comprime l'asse del tempo senza ridimensionare i riquadri." },
        { term: "Giorno / settimana / mese", text: "Cambia la densità con cui è disegnato il tempo e cosa mostra il righello." },
        { term: "adatta", text: "Riduce lo zoom finché tutta la roadmap non entra nello schermo." },
        { term: "compatta", text: "Riorganizza gli epic perché attività che non si sovrappongono condividano la stessa riga." },
      ],
    },
    {
      id: "people",
      title: "Persone e carico",
      body:
        "La scheda Team elenca tutti sul Pulse. Trascina una persona su un'attività per assegnarla, poi " +
        "imposta quanta parte del suo tempo richiede.",
      keywords: ["assegnare", "risorsa", "team", "chi", "allocazione", "utilizzo", "sovraccarico", "occupato"],
      bullets: [
        { term: "Assegnare", text: "Trascina un chip da Team su un'attività: per impostazione predefinita è il 100% del suo tempo." },
        { term: "% di allocazione", text: "Per persona e per attività, nella scheda Dettagli. 50% significa mezza giornata." },
        { term: "Capacità", text: "Il limite di occupazione di una persona, impostato nella scheda Capacità. Oltre quello si vede in rosso." },
        { term: "Pannello di assegnazione", text: "Il pannello in basso: una riga per persona, allineata nel tempo con la tela." },
        { term: "★ responsabile", text: "Indica chi guida un'attività. Un Responsabile di attività può modificare le attività che guida." },
      ],
    },
    {
      id: "costs",
      title: "Costi",
      body:
        "Passa il pannello in basso a Costi per vedere quanto costa la roadmap nel tempo. La spesa di IA " +
        "è registrata per attività; il costo delle persone si ricava da assegnazioni e tariffe orarie.",
      keywords: ["denaro", "budget", "prezzo", "stipendio", "paga", "tariffa", "oraria", "token", "ia", "spesa", "ore", "usd", "dollari"],
      bullets: [
        { term: "Costi di IA", text: "Si aggiungono sull'attività, nella scheda Dettagli: token e quanto è stato speso." },
        { term: "Costo unitario", text: "Ricavato da ciò che hai inserito, non da un listino: è quindi la tua tariffa reale." },
        { term: "Costi delle persone", text: "Ore × costo orario, dove le ore vengono dall'assegnazione e dalla durata dell'attività." },
        { term: "Tariffe orarie", text: "Si impostano nella scheda Capacità. Visibili solo agli amministratori del Pulse, come i costi che ne derivano." },
        { term: "La vista Costi", text: "Raggruppa per modello, persona o attività; passa tra $ e quantità; i totali sono complessivi." },
        { term: "Un'avvertenza", text: "I numeri dell'IA sono quanto è stato speso; quelli delle persone sono quanto implica il piano. È una stima, non contabilità." },
      ],
    },
    {
      id: "plan",
      title: "Piano e realtà",
      body:
        "Congela ciò che avevi promesso all'inizio, poi guarda la realtà allontanarsene.",
      keywords: ["riferimento", "baseline", "ritardo", "slittamento", "originale", "promesso", "scadenza"],
      bullets: [
        { term: "📌 fissa il piano", text: "Salva le date attuali dell'attività come riferimento." },
        { term: "Ritardi", text: "Disegna il riferimento come barra tratteggiata sotto ogni attività, con lo scarto in giorni." },
        { term: "Recuperato", text: "Compare quando una partenza in ritardo viene recuperata entro la data di consegna." },
      ],
    },
    {
      id: "collab",
      title: "Lavorare insieme",
      body:
        "Condividi un Pulse con un link e tutti vedono i cambiamenti mentre avvengono.",
      keywords: ["invitare", "condividere", "permesso", "ruolo", "lettore", "editor", "proprietario", "commento", "menzione", "cronologia", "chi ha cambiato", "nascondi", "archivia", "sola lettura", "completato"],
      bullets: [
        { term: "Invitare", text: "Crea un link e invialo. Il ruolo che scegli è quello che ricevono i nuovi arrivati." },
        { term: "Proprietario / Editor", text: "Il proprietario gestisce persone e impostazioni; l'editor cambia tutto il resto." },
        { term: "Lettore completo", text: "Legge tutto il Pulse e può commentare, ma non può modificare nulla." },
        { term: "Lettore del proprio ambito", text: "Vede solo le attività a cui è assegnata la sua risorsa." },
        { term: "Responsabile di attività", text: "Modifica solo le attività che guida e legge il resto." },
        { term: "Commenti", text: "Su qualunque attività, con @ per menzionare una persona o collegare un'attività." },
        { term: "Attività (log)", text: "Un registro duraturo di chi ha cambiato cosa, e quando." },
        { term: "Nascondi", text: "Toglie un Pulse dalla tua bacheca. Nessun altro se ne accorge e non cambia nient'altro." },
        { term: "Archivia", text: "Solo il proprietario. Rende un Pulse concluso di sola lettura per tutti finché un proprietario non lo ripristina. Non viene eliminato nulla e non libera un posto del piano." },
      ],
    },
    {
      id: "board",
      title: "Bacheca, filtri e annulla",
      body:
        "Le stesse attività viste come bacheca invece che come linea del tempo, più gli strumenti per " +
        "trovare le cose e tornare sui propri errori.",
      keywords: ["kanban", "stato", "colonna", "cerca", "filtro", "annulla", "ripristina", "errore", "ctrl z"],
      bullets: [
        { term: "Vista bacheca", text: "Colonne kanban per stato. Trascina un'attività tra le colonne per cambiarne lo stato." },
        { term: "Stati", text: "Modificabili per ogni Pulse. Fatto è sempre l'ultimo e blocca l'attività." },
        { term: "Filtri", text: "Per testo, stato o epic. Le attività che non corrispondono si attenuano invece di sparire." },
        { term: "Il mio ambito", text: "Restringe tutto alle attività su cui sei." },
        { term: "Annulla / ripristina", text: "⌘Z e ⇧⌘Z (Ctrl su Windows). Copre modifiche, spostamenti ed eliminazioni." },
      ],
    },
  ],
};
