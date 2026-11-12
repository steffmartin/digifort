# Guia de continuidade da interface

## Estrutura e aparência

| Área | Comportamento |
| --- | --- |
| Barra superior | Mostra o servidor ativo, o estado de conexão e o fuso. |
| Painel lateral | Filtra e lista câmeras com nome, estado e ações de abertura. |
| Controles do monitor | Alternam **Ao vivo** e **Revisão**, organizam mosaico, áudio, exibição e vigilância. |
| Grade de vídeo | Mantém foco por câmera e estados de carregamento, disponibilidade e gravação por quadro. |
| Timeline e miniaturas | A timeline reúne as câmeras abertas; miniaturas usam a câmera escolhida no menu de contexto. |

A estrutura fica em [index.html](../public/index.html), os estilos em [styles.css](../public/styles.css) e as interações em [app.js](../public/app.js). A interface usa fundo escuro, verde-água no modo ao vivo e âmbar na revisão. As variáveis em `:root` concentram a paleta. O instalador acompanha o tema do Windows e tem arte própria gerada por [Artwork.cs](../installer/Artwork.cs).

## Fluxos e estados a preservar

- A interface abre no modo ao vivo, com áudio desativado e sem sobreposições. A timeline fica disponível na revisão e pode ser ocultada. Miniaturas são abertas sob demanda no menu da câmera, começam no tamanho grande e substituem temporariamente a grade.
- O mosaico automático se adapta à quantidade de câmeras abertas. Ao escolher uma grade fixa menor que a quantidade atual, a interface informa quantas câmeras estão abertas. **Restaurar grade configurada** reconecta o servidor e restaura as câmeras e o mosaico iniciais.
- A câmera em foco determina a fonte do áudio; a timeline mostra todas as câmeras abertas. O seletor **Em foco:** e a seleção do quadro alteram a mesma câmera. Trocar quadros de posição também reordena as faixas existentes sem recarregá-las. Preserve a navegação por clique, o zoom por duplo clique ou `F` e a saída por `Esc`. Teste a ordem de saída quando houver uma câmera ampliada no modo vigilância.
- A lista lateral aceita setas e `Enter`; o ícone no rodapé abre a lista de atalhos. Os submenus de contexto exibem títulos e os atalhos das ações disponíveis. As opções de exibição mantêm os rótulos **Mostrar dados** e **Mostrar timeline**, com marcação indicando o estado. O fundo dos diálogos usa o mesmo fechamento que seus controles.
- Os comandos de foco, perfil e fechamento da câmera ficam no menu de contexto. O calendário de revisão permite escolher data e hora no fuso do servidor, restringe intervalos invertidos e mantém a validação de fim posterior ao reproduzir.
- Ao iniciar, uma versão mais recente pode abrir um diálogo com opções para cancelar, ignorar a versão ou abrir a página da release. Falhas de consulta não mostram erro na interface.
- O diálogo de configurações permite criar, editar e excluir servidores. Ele esmaece o fundo e interrompe as transmissões enquanto está aberto; ao fechar, retoma as transmissões ou reconecta o servidor alterado. A senha existente permanece no servidor e é preservada quando o campo fica vazio. Sem uma configuração utilizável, **Fechar** encerra a janela e o servidor quando o aplicativo foi iniciado pelo inicializador gráfico.
- No assistente, as câmeras iniciais ficam abaixo do mosaico em **Preferências do servidor**. O seletor **Perfil de reprodução** oferece `Visualization` e `Recording`. O usuário pode adicionar e remover entradas da lista.
- Os menus de captura devem indicar formatos indisponíveis antes do início e distinguir gravações em andamento, pausadas e concluídas.

## Linguagem e validação

Use português do Brasil para rótulos, instruções e erros. Mantenha `Visualization` e `Recording` quando forem valores do perfil da API. Controles só com ícone precisam de nome acessível. Verifique contraste, foco, fechamento de menus pelo teclado e legibilidade nos estados desabilitados.

Para alterações na interface, siga [AGENTS.md](../AGENTS.md) e valide o fluxo em uma janela estreita e em tela cheia quando o layout for afetado. Para o assistente Windows, confira a página modificada no tema do sistema e verifique se rótulos, campos e botões permanecem visíveis.

### Janelas de desktop

- Em janelas menores, os controles de revisão passam para outra linha; cada rótulo permanece junto ao respectivo campo e botão de calendário. Os controles continuam disponíveis.
- A timeline usa no máximo 30% da altura da área de monitoramento e oferece rolagem vertical quando há muitas câmeras, preservando espaço para a grade. Os diálogos também rolam quando a altura da janela é insuficiente.
- A revisão desta disposição usou conteúdo sintético nas dimensões 1920×1080, 1366×768, 1280×720, 1024×768, 900×600, 800×600 e 768×480, incluindo revisão com 32 faixas. Conferiram-se os limites dos controles e os diálogos de configuração, atalhos, gravação e atualização; não houve conexão com um servidor Digifort.
