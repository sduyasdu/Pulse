// Contenido de ayuda en español — Help-Spec.md §3.
//
// Mismas reglas editoriales que en.ts: no repetir la UI (para eso están los
// tooltips), dos frases por idea, nombrar las cosas como las nombra la interfaz
// y documentar sólo lo que está desplegado (HL9).
//
// `keywords` son términos de búsqueda, no traducciones: van las palabras que un
// lector escribiría de verdad — incluidos anglicismos de uso corriente ("gantt",
// "kanban") y variantes regionales ("sueldo", "salario", "nómina").
import type { HelpDoc } from "./types";

export const help: HelpDoc = {
  reviewedAgainst: "2026-07",
  sections: [
    {
      id: "canvas",
      title: "El lienzo",
      body:
        "Tu roadmap es un lienzo en 2D: el tiempo avanza de izquierda a derecha y cada caja es una tarea. " +
        "Las bandas horizontales son epics, los grupos en los que organizás el trabajo.",
      keywords: ["gantt", "linea de tiempo", "cronograma", "diagrama", "roadmap", "tablero", "cuadricula", "carriles"],
      bullets: [
        { term: "Mover una tarea", text: "Arrastrá desde el centro. Soltala sobre la banda de otro epic para moverla ahí." },
        { term: "Cambiar fechas", text: "Arrastrá el borde izquierdo o derecho." },
        { term: "Abrir una tarea", text: "Hacé clic y usá la pestaña Detalles a la derecha." },
        { term: "Agregar una tarea", text: "Doble clic en el lienzo vacío, o + Tarea en la barra de herramientas." },
      ],
    },
    {
      id: "effort",
      title: "La altura de la caja es trabajo",
      body:
        "Esta es la parte que sorprende: la altura de una caja no es decoración. Es cuánto esfuerzo " +
        "paralelo lleva la tarea por día, así que una caja alta es trabajo más pesado que una baja del " +
        "mismo largo.",
      keywords: ["alta", "baja", "tamaño", "redimensionar", "esfuerzo", "dias hombre", "estimacion", "capacidad", "carga"],
      bullets: [
        { term: "Esfuerzo del gráfico", text: "Días hábiles × trabajo por día. Arrastrá el borde inferior para cambiar la altura." },
        { term: "Esfuerzo estimado", text: "Sigue la forma de la caja hasta que lo fijás con 🔒; ↺ vuelve a liberarlo." },
        { term: "Esfuerzo asignado", text: "Lo que realmente suman las personas asignadas, según su % de dedicación." },
        { term: "El punto de color", text: "Verde: el equipo coincide con la estimación; rojo: falta gente; ámbar: sobra." },
        { term: "⇥ ajustar largo", text: "Redimensiona la tarea para que el equipo actual entregue exactamente la estimación." },
        { term: "Fines de semana", text: "Quedan fuera del esfuerzo y del costo salvo que actives esa opción en la tarea." },
      ],
    },
    {
      id: "navigation",
      title: "Moverse",
      body:
        "Hay dos zooms distintos, y conviene saberlo antes de salir a buscar: uno escala toda la imagen, " +
        "el otro estira el tiempo mismo.",
      keywords: ["zoom", "acercar", "alejar", "scroll", "desplazar", "ajustar", "hoy", "semana", "mes", "densidad"],
      bullets: [
        { term: "Desplazar", text: "Arrastrá el lienzo vacío para recorrer el tiempo o moverte hacia arriba y abajo." },
        { term: "Zoom de vista", text: "⌘/Ctrl + scroll, o los botones +/−. Escala todo." },
        { term: "Ancho de día", text: "Estira o comprime el eje del tiempo sin cambiar el tamaño de las cajas." },
        { term: "Día / semana / mes", text: "Cambia con qué densidad se dibuja el tiempo y qué muestra la regla." },
        { term: "ajustar", text: "Aleja hasta que todo el roadmap entra en pantalla." },
        { term: "compactar", text: "Reacomoda los epics para que las tareas que no se solapan compartan fila." },
      ],
    },
    {
      id: "people",
      title: "Personas y carga",
      body:
        "La pestaña Equipo lista a todos los del Pulse. Arrastrá una persona sobre una tarea para " +
        "asignarla y después definí qué parte de su tiempo lleva.",
      keywords: ["asignar", "recurso", "equipo", "quien", "dedicacion", "utilizacion", "sobrecarga", "ocupado"],
      bullets: [
        { term: "Asignar", text: "Arrastrá una ficha desde Equipo a una tarea: por defecto es el 100% de su tiempo." },
        { term: "% de dedicación", text: "Por persona y por tarea, en la pestaña Detalles. 50% es media jornada." },
        { term: "Capacidad", text: "El límite de ocupación de cada persona, en la pestaña Capacidad. Por encima se ve en rojo." },
        { term: "Panel de asignación", text: "El panel inferior: una fila por persona, alineada en el tiempo con el lienzo." },
        { term: "★ líder", text: "Marca quién lidera una tarea. Un Líder de Tarea puede editar las tareas que lidera." },
      ],
    },
    {
      id: "costs",
      title: "Costos",
      body:
        "Cambiá el panel inferior a Costos para ver cuánto cuesta el roadmap a lo largo del tiempo. El " +
        "gasto de IA se registra por tarea; el costo de personas sale de las asignaciones y las tarifas por hora.",
      keywords: ["dinero", "presupuesto", "precio", "sueldo", "salario", "nomina", "tarifa", "por hora", "tokens", "ia", "gasto", "horas", "usd", "dolares"],
      bullets: [
        { term: "Costos de IA", text: "Se agregan en la tarea, en la pestaña Detalles: tokens y lo que se gastó." },
        { term: "Costo unitario", text: "Sale de lo que cargaste, no de una lista de precios, así que es tu tarifa real." },
        { term: "Costos de personas", text: "Horas × costo por hora, donde las horas salen de la asignación y del largo de la tarea." },
        { term: "Tarifas por hora", text: "Se definen en Capacidad. Sólo las ven los administradores del Pulse, igual que los costos derivados." },
        { term: "La vista de Costos", text: "Agrupá por modelo, persona o tarea; cambiá entre $ y cantidad; los totales son históricos." },
        { term: "Una advertencia", text: "Las cifras de IA son lo gastado; las de personas son lo que implica el plan. Es una estimación, no contabilidad." },
      ],
    },
    {
      id: "plan",
      title: "Plan contra realidad",
      body:
        "Congelá lo que prometiste originalmente y después mirá cómo la realidad se aleja de eso.",
      keywords: ["linea base", "baseline", "atraso", "retraso", "demora", "original", "prometido", "fecha limite"],
      bullets: [
        { term: "📌 fijar plan", text: "Guarda las fechas actuales de la tarea como su línea base." },
        { term: "Atrasos", text: "Dibuja la línea base como una barra punteada bajo cada tarea, con la diferencia en días." },
        { term: "Recuperado", text: "Aparece cuando un arranque tardío se recupera para la fecha de entrega." },
      ],
    },
    {
      id: "collab",
      title: "Trabajar en equipo",
      body:
        "Compartí un Pulse con un enlace y todos ven los cambios a medida que ocurren.",
      keywords: ["invitar", "compartir", "permiso", "rol", "lector", "editor", "propietario", "comentario", "mencion", "historial", "quien cambio", "ocultar", "archivar", "solo lectura", "terminado"],
      bullets: [
        { term: "Invitar", text: "Creá un enlace y envialo. El rol que elegís es el que reciben quienes entran." },
        { term: "Propietario / Editor", text: "El propietario gestiona personas y configuración; el editor cambia todo lo demás." },
        { term: "Lector completo", text: "Lee todo el Pulse y puede comentar, pero no puede cambiar nada." },
        { term: "Lector de su beat", text: "Ve sólo las tareas a las que está asignado su propio recurso." },
        { term: "Líder de Tarea", text: "Edita sólo las tareas que lidera y lee el resto." },
        { term: "Comentarios", text: "En cualquier tarea, con @ para mencionar a una persona o enlazar una tarea." },
        { term: "Actividad", text: "Un registro durable de quién cambió qué y cuándo." },
        { term: "Ocultar", text: "Saca un Pulse de tu propio panel. Nadie más lo nota y no cambia nada más." },
        { term: "Archivar", text: "Sólo el propietario. Deja un Pulse terminado en sólo lectura para todos hasta que un propietario lo desarchive. No se borra nada y no libera un lugar del plan." },
      ],
    },
    {
      id: "board",
      title: "Tablero, filtros y deshacer",
      body:
        "Las mismas tareas vistas como tablero en lugar de línea de tiempo, más las herramientas para " +
        "encontrar cosas y volver atrás los errores.",
      keywords: ["kanban", "estado", "columna", "buscar", "filtro", "deshacer", "rehacer", "error", "ctrl z"],
      bullets: [
        { term: "Vista de tablero", text: "Columnas kanban por estado. Arrastrá una tarea entre ellas para cambiarle el estado." },
        { term: "Estados", text: "Editables por Pulse. Listo va siempre último y bloquea la tarea." },
        { term: "Filtros", text: "Por texto, estado o epic. Las tareas que no coinciden se atenúan en vez de desaparecer." },
        { term: "Mi beat", text: "Reduce todo a las tareas en las que estás." },
        { term: "Deshacer / rehacer", text: "⌘Z y ⇧⌘Z (Ctrl en Windows). Cubre ediciones, movimientos y borrados." },
      ],
    },
  ],
};
