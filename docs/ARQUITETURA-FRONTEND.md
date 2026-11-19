# Contratos da apresentação do monitor

A interface é um documento estático: `index.html` define o shell persistente, a grade cujo conteúdo é gerado pelo monitor e os overlays. `styles.css` mantém uma única ordem explícita: tokens e base, shell, controles, barra multimídia, grade, timeline e miniaturas, menus e diálogos, estados de vigilância e breakpoints. Uma divisão em folhas independentes não foi adotada: os estados de tela cheia, vigilância e miniaturas atravessam regiões e hoje não há carregador que torne a ordem entre folhas mais clara.

## Mapa de integração

Todos os IDs abaixo pertencem ao documento estático. `shell.js` reúne referências diretas e as fornece aos módulos que precisam delas; os demais IDs também são consultados diretamente pelo shell. Os IDs e a ordem de foco foram preservados.

| Região | IDs | Consumidores e contratos |
| --- | --- | --- |
| Barra superior | `serverSelect`, `connectionState`, `connectionLabel`, `manageConfigs`, `clockTime`, `clockDate` | Shell: servidor, estado `data-state`, configuração e relógio. |
| Fontes | `cameraCount`, `cameraSearch`, `availableCount`, `cameraList`, `cameraListEmpty`, `openShortcuts` | Shell gera `.camera-row`; `is-open`, `is-unavailable`, `aria-disabled` e os controles de teclado são estados funcionais. |
| Comandos | `liveMode`, `reviewMode`, `reviewFields`, `startDateTime`, `endDateTime`, `playReview`, `mosaicPreview`, `mosaicSelect`, `saveGrid`, `resetGrid`, `displayControl`, `overlayToggle`, `displayMenuToggle`, `displayMenu`, `toggleOverlayVisibility`, `toggleTimelineVisibility`, `viewSubtitle` | Shell e revisão: `aria-pressed`, `aria-expanded`, `aria-checked`, `hidden`, valores dos perfis `Visualization` e `Recording` e opções de mosaico. |
| Grade | `viewerGrid`, `emptyMonitor` | Shell cria `.camera-tile` e seus descendentes; `data-mosaic`, `showing-thumbnails`, `is-focused`, `is-enlarged`, `is-dragging`, presença e propriedades `--mosaic-*` são compartilhados com CSS e módulos. |
| Multimídia | `mediaToolbar`, `mediaToolbarHandle`, `surveillanceToggle`, `audioSource`, `seekBackWrap`, `seekBack`, `stopAll`, `seekForwardWrap`, `seekForward`, `audioToggle`, `presenceToggle`, `captureFrame`, `recordToggle`, `finishRecording`, `captureAllSwitch` | Shell, captura e presença; `.media-toolbar-surveillance`, `.media-toolbar-playback` e `.media-toolbar-capture` identificam os grupos. `is-visible`, `data-state`, `data-capture-all`, `data-presence-all`, `aria-pressed`, `aria-checked` e `disabled` controlam apresentação e interação. A barra pode ser reparentada ao tile em tela cheia. |
| Revisão | `reviewPanel`, `timelineNames`, `timelineScroll`, `timelineContent`, `timelineRuler`, `timelineTracks`, `timelineDays`, `timelinePlayhead`, `timelineStatus` | `review/timeline.js` gera faixas, régua e estados de ponteiro; a área rola verticalmente e o conteúdo, horizontalmente. |
| Miniaturas | `thumbnailPanel`, `thumbnailGrid`, `thumbnailPrev`, `thumbnailNext`, `thumbnailStatus` | `review/thumbnails.js` gera cartões e prévias; `hidden`, `showing-thumbnails` e `--thumbnail-card-width` coordenam a troca temporária da grade. |
| Menu contextual | `contextMenu` | Shell gera itens e submenus, preserva papéis e foco e pode reparentar o menu em tela cheia. |
| Atualização | `updateDialog`, `updateTitle`, `updateVersion`, `updateNotes`, `updateProgressArea`, `updateStatus`, `updateProgress`, `updateActions`, `ignoreUpdate`, `downloadUpdate` | Shell controla modal, progresso e ações. |
| Atalhos | `shortcutDialog`, `shortcutDialogTitle` | Shell abre e fecha o diálogo nativo; `.shortcut-list` mantém a relação entre ação e tecla. |
| Configuração | `configDialog`, `configForm`, `configDialogTitle`, `configDialogMessage`, `configChoice`, `toggleConfigPassword`, `passwordHint`, `configMosaic`, `deleteConfig`, `closeConfigApp`, `saveConfig` | Shell usa IDs e nomes dos campos do formulário; senha e configuração permanecem no servidor local. |
| Avisos | `toastRegion` | Shell e captura inserem avisos e botões de acesso à mídia. |

Os estados de cor do tile são declarados em `.camera-tile`: `is-review`, `is-recording` e `is-recording-paused`. A ordem no CSS mantém a precedência de gravação sobre revisão e de pausa sobre gravação. Captura também atualiza os estados correspondentes no `.tile-state`, que controla o indicador visual e sua animação. `presence-alert-once` e `presence-alert-three` continuam pertencendo à presença. O seletor relacional restante na barra serve apenas ao cursor do invólucro de um controle desabilitado, não ao estado do tile.

Os diálogos compartilham `.app-dialog`, `.app-dialog-note` e `.app-dialog-actions`; `config-dialog` define somente sua variante. Essas classes substituem as antigas `record-dialog*`, que eram usadas apenas pelo HTML e CSS. Não há templates carregados dinamicamente: separar a marcação estática geraria um contrato de carregamento adicional sem reduzir os consumidores existentes.

## Validação

A comparação visual sintética usa a versão anterior dos arquivos públicos e a versão alterada, com relógio fixo e animações desativadas para eliminar variação temporal. Foram comparados vazio, câmera, revisão, miniaturas, presença, vigilância, ampliação, gravação, gravação pausada e diálogos de atualização, atalhos e configuração nas sete resoluções do guia de UI e em 560×480, incluindo timeline com 32 faixas sintéticas. As imagens são evidência de apresentação sintética; não substituem validação com mídia real ou tecnologia assistiva. Os testes automatizados de navegação e dos módulos verificam os fluxos e estados independentemente da comparação de pixels.

Após a identificação de uma regressão de cascata nos menus, a comparação foi ampliada para menus de câmera e de todas as câmeras, perfis, submenus de gravação e miniaturas, menu de exibição, calendário, painel e prévia de miniaturas, senha e progresso de atualização. O Chromium também verifica o alinhamento calculado dos itens de perfil e tamanho; esses dois grupos usam a mesma classe funcional.
