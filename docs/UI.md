# Guia de continuidade da interface

## Estrutura e aparência

| Área | Comportamento |
| --- | --- |
| Barra superior | Mostra o servidor ativo, o estado de conexão e o fuso. |
| Painel lateral | Filtra e lista câmeras com nome, estado e ações de abertura. |
| Controles do monitor | Alternam **Ao vivo** e **Revisão**, organizam mosaico, áudio, exibição e vigilância. |
| Grade de vídeo | Mantém foco por câmera e estados de carregamento, disponibilidade e gravação por quadro. |
| Timeline e miniaturas | Seguem a câmera em foco durante a revisão. |

A estrutura fica em [index.html](../public/index.html), os estilos em [styles.css](../public/styles.css) e as interações em [app.js](../public/app.js). A interface usa fundo escuro, verde-água no modo ao vivo e âmbar na revisão. As variáveis em `:root` concentram a paleta. O instalador acompanha o tema do Windows e tem arte própria gerada por [Artwork.cs](../installer/Artwork.cs).

## Fluxos e estados a preservar

- A interface abre no modo ao vivo, com áudio desativado e sem sobreposições. Timeline e miniaturas ficam disponíveis na revisão, começam visíveis e podem ser ocultadas individualmente. O tamanho inicial das miniaturas é médio. Painéis ocultos deixam de solicitar dados às APIs correspondentes.
- O mosaico automático se adapta à quantidade de câmeras abertas. Ao escolher uma grade fixa menor que a quantidade atual, a interface informa quantas câmeras estão abertas.
- O foco do quadro controla a timeline e as miniaturas. Preserve a navegação por clique, o zoom por duplo clique ou `F` e a saída por `Esc`. Teste a ordem de saída quando houver uma câmera ampliada no modo vigilância.
- Sem servidor utilizável, o diálogo de configuração esmaece o fundo e mostra a pasta exata. Diferencie ausência de arquivo e arquivo inválido. **Verificar novamente** atualiza a lista. **Fechar** encerra a janela e o servidor quando o aplicativo foi iniciado pelo inicializador gráfico.
- No assistente, as câmeras iniciais ficam abaixo do mosaico em **Preferências do servidor**. O seletor **Perfil de reprodução** oferece `Visualization` e `Recording`. O usuário pode adicionar e remover entradas da lista.
- Os menus de captura devem indicar formatos indisponíveis antes do início e distinguir gravações em andamento, pausadas e concluídas.

## Linguagem e validação

Use português do Brasil para rótulos, instruções e erros. Mantenha `Visualization` e `Recording` quando forem valores do perfil da API. Controles só com ícone precisam de nome acessível. Verifique contraste, foco, fechamento de menus pelo teclado e legibilidade nos estados desabilitados.

Para alterações na interface, siga [AGENTS.md](../AGENTS.md) e valide o fluxo em uma janela estreita e em tela cheia quando o layout for afetado. Para o assistente Windows, confira a página modificada no tema do sistema e verifique se rótulos, campos e botões permanecem visíveis.
