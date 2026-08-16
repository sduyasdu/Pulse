// Conteúdo de ajuda em português — Help-Spec.md §3.
//
// Mesmas regras editoriais de en.ts: não repetir a UI (para isso existem os
// tooltips), duas frases por ideia, nomear as coisas como a interface as nomeia
// e documentar apenas o que está no ar (HL9).
//
// `keywords` são termos de busca, não traduções: entram as palavras que um leitor
// realmente digitaria — incluindo anglicismos correntes ("gantt", "kanban") e
// variantes ("salário", "folha de pagamento").
import type { HelpDoc } from "./types";

export const help: HelpDoc = {
  reviewedAgainst: "2026-07",
  sections: [
    {
      id: "canvas",
      title: "O canvas",
      body:
        "Seu roadmap é um canvas 2D: o tempo corre da esquerda para a direita e cada caixa é uma tarefa. " +
        "As faixas horizontais são epics — os grupos em que você organiza o trabalho.",
      keywords: ["gantt", "linha do tempo", "cronograma", "diagrama", "roadmap", "quadro", "grade", "raias"],
      bullets: [
        { term: "Mover uma tarefa", text: "Arraste pelo meio. Solte na faixa de outro epic para movê-la para lá." },
        { term: "Mudar datas", text: "Arraste a borda esquerda ou direita." },
        { term: "Abrir uma tarefa", text: "Clique nela e use a aba Detalhes à direita." },
        { term: "Adicionar uma tarefa", text: "Duplo clique no canvas vazio, ou + Tarefa na barra de ferramentas." },
      ],
    },
    {
      id: "effort",
      title: "A altura da caixa é trabalho",
      body:
        "Esta é a parte que surpreende: a altura de uma caixa não é decoração. É quanto esforço paralelo " +
        "a tarefa exige por dia, então uma caixa alta é trabalho mais pesado que uma baixa do mesmo comprimento.",
      keywords: ["alta", "baixa", "tamanho", "redimensionar", "esforco", "homem-dia", "estimativa", "capacidade", "carga"],
      bullets: [
        { term: "Esforço do gráfico", text: "Dias úteis × trabalho por dia. Arraste a borda inferior para mudar a altura." },
        { term: "Esforço estimado", text: "Acompanha o formato da caixa até você travá-lo com 🔒; ↺ destrava de novo." },
        { term: "Esforço atribuído", text: "O que as pessoas atribuídas realmente somam, conforme sua % de alocação." },
        { term: "O ponto colorido", text: "Verde: a equipe bate com a estimativa; vermelho: falta gente; âmbar: sobra." },
        { term: "⇥ ajustar duração", text: "Redimensiona a tarefa para que a equipe atual entregue exatamente a estimativa." },
        { term: "Fins de semana", text: "Ficam fora do esforço e do custo, a menos que você ative essa opção na tarefa." },
      ],
    },
    {
      id: "navigation",
      title: "Circular pela tela",
      body:
        "Há dois zooms diferentes, e vale saber antes de sair procurando: um escala a imagem inteira, o " +
        "outro estica o próprio tempo.",
      keywords: ["zoom", "aproximar", "afastar", "rolar", "arrastar", "ajustar", "hoje", "semana", "mes", "densidade"],
      bullets: [
        { term: "Arrastar a tela", text: "Arraste o canvas vazio para percorrer o tempo ou subir e descer." },
        { term: "Zoom de visualização", text: "⌘/Ctrl + rolagem, ou os botões +/−. Escala tudo." },
        { term: "Largura do dia", text: "Estica ou comprime o eixo do tempo sem redimensionar as caixas." },
        { term: "Dia / semana / mês", text: "Muda a densidade com que o tempo é desenhado e o que a régua mostra." },
        { term: "ajustar", text: "Afasta até o roadmap inteiro caber na tela." },
        { term: "compactar", text: "Reorganiza os epics para que tarefas que não se sobrepõem dividam a mesma linha." },
      ],
    },
    {
      id: "people",
      title: "Pessoas e carga",
      body:
        "A aba Equipe lista todos no Pulse. Arraste uma pessoa até uma tarefa para atribuí-la e depois " +
        "defina que parte do tempo dela isso consome.",
      keywords: ["atribuir", "recurso", "equipe", "quem", "alocacao", "utilizacao", "sobrecarga", "ocupado"],
      bullets: [
        { term: "Atribuir", text: "Arraste um chip da aba Equipe até a tarefa — por padrão são 100% do tempo da pessoa." },
        { term: "% de alocação", text: "Por pessoa e por tarefa, na aba Detalhes. 50% é meio expediente." },
        { term: "Capacidade", text: "O limite de ocupação da pessoa, definido na aba Capacidade. Acima disso aparece em vermelho." },
        { term: "Painel de atribuição", text: "O painel inferior: uma linha por pessoa, alinhada no tempo com o canvas." },
        { term: "★ líder", text: "Marca quem lidera a tarefa. Um Líder de Tarefa pode editar as tarefas que lidera." },
      ],
    },
    {
      id: "costs",
      title: "Custos",
      body:
        "Mude o painel inferior para Custos e veja quanto o roadmap custa ao longo do tempo. O gasto com " +
        "IA é registrado por tarefa; o custo de pessoas vem das atribuições e das taxas por hora.",
      keywords: ["dinheiro", "orcamento", "preco", "salario", "folha de pagamento", "taxa", "por hora", "tokens", "ia", "gasto", "horas", "usd", "dolares"],
      bullets: [
        { term: "Custos de IA", text: "Adicione na tarefa, na aba Detalhes: tokens e o que foi gasto." },
        { term: "Custo unitário", text: "Calculado a partir do que você lançou, não de uma tabela de preços — é a sua taxa real." },
        { term: "Custos de pessoas", text: "Horas × custo por hora, com as horas vindo da atribuição e da duração da tarefa." },
        { term: "Taxas por hora", text: "Definidas na aba Capacidade. Visíveis apenas para administradores do Pulse, como os custos derivados delas." },
        { term: "A visão de Custos", text: "Agrupe por modelo, pessoa ou tarefa; alterne entre $ e quantidade; os totais são de todo o período." },
        { term: "Uma ressalva", text: "Os números de IA são o que foi gasto; os de pessoas são o que o plano implica. É estimativa, não contabilidade." },
      ],
    },
    {
      id: "plan",
      title: "Plano x realizado",
      body:
        "Congele o que você prometeu no início e depois acompanhe a realidade se afastando disso.",
      keywords: ["linha de base", "baseline", "atraso", "atrasado", "desvio", "original", "prometido", "prazo"],
      bullets: [
        { term: "📌 definir plano", text: "Salva as datas atuais da tarefa como sua linha de base." },
        { term: "Atrasos", text: "Desenha a linha de base como uma barra tracejada sob cada tarefa, com a diferença em dias." },
        { term: "Recuperado", text: "Aparece quando um início atrasado é recuperado até a data de entrega." },
      ],
    },
    {
      id: "collab",
      title: "Trabalhar em conjunto",
      body:
        "Compartilhe um Pulse com um link e todos veem as mudanças conforme elas acontecem.",
      keywords: ["convidar", "compartilhar", "permissao", "papel", "leitor", "editor", "proprietario", "comentario", "mencao", "historico", "quem mudou", "ocultar", "arquivar", "somente leitura", "concluido"],
      bullets: [
        { term: "Convidar", text: "Crie um link e envie. O papel que você escolhe é o que quem entra recebe." },
        { term: "Proprietário / Editor", text: "O proprietário gerencia pessoas e configurações; o editor muda todo o resto." },
        { term: "Leitor completo", text: "Lê o Pulse inteiro e pode comentar, mas não pode mudar nada." },
        { term: "Leitor do próprio beat", text: "Vê apenas as tarefas às quais o próprio recurso está atribuído." },
        { term: "Líder de Tarefa", text: "Edita só as tarefas que lidera e lê o restante." },
        { term: "Comentários", text: "Em qualquer tarefa, com @ para mencionar uma pessoa ou vincular uma tarefa." },
        { term: "Atividade", text: "Um registro durável de quem mudou o quê, e quando." },
        { term: "Ocultar", text: "Tira um Pulse do seu próprio painel. Ninguém mais percebe e nada mais muda." },
        { term: "Arquivar", text: "Só o proprietário. Deixa um Pulse concluído somente leitura para todos até que um proprietário desarquive. Nada é excluído e não libera vaga no plano." },
      ],
    },
    {
      id: "board",
      title: "Quadro, filtros e desfazer",
      body:
        "As mesmas tarefas vistas como quadro em vez de linha do tempo — mais as ferramentas para achar " +
        "coisas e voltar atrás nos erros.",
      keywords: ["kanban", "status", "coluna", "buscar", "filtro", "desfazer", "refazer", "erro", "ctrl z"],
      bullets: [
        { term: "Visão de quadro", text: "Colunas kanban por status. Arraste uma tarefa entre elas para mudar o status." },
        { term: "Status", text: "Editáveis por Pulse. Concluído é sempre o último e trava a tarefa." },
        { term: "Filtros", text: "Por texto, status ou epic. Tarefas que não batem ficam esmaecidas em vez de sumir." },
        { term: "Meu beat", text: "Reduz tudo às tarefas em que você está." },
        { term: "Desfazer / refazer", text: "⌘Z e ⇧⌘Z (Ctrl no Windows). Cobre edições, movimentos e exclusões." },
      ],
    },
  ],
};
