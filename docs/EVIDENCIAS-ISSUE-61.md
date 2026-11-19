# Issue 61 — baseline e matriz de regressão

Baseline obtida no commit `a90de8c` (Node.js v26.13.0):

- `node --check server.mjs`: aprovado.
- `node --check public/app.js`: aprovado.
- `npm test`: 70 testes aprovados, nenhum reprovado ou ignorado.
- Dados de validação: `.validation/issue-61/`, com diretórios isolados para configuração e mídia; não usar dados ou credenciais reais.
- Navegador das capturas parciais: Chromium, user agent Chrome/157.0.0.0, Windows 64 bits.
- Capturas parciais: `.validation/issue-61/configuracao-<largura>x<altura>.png`, diálogo inicial sem configuração, nas sete dimensões previstas.
- Capturas exploratórias adicionais: `ao-vivo-sintetico-<largura>x<altura>.png` e `revisao-vazia-<largura>x<altura>.png`. Usaram respostas HTTP interceptadas e dois quadros JPEG sintéticos. A transmissão simulada termina após um quadro, portanto não substitui uma baseline estável de reprodução contínua nem valida reconexão.
- Por autorização do usuário, a validação visual também usou o servidor configurado, sem leitura do arquivo de configuração ou inspeção do tráfego de autenticação. As imagens reais ficam somente na pasta local de validação e não devem ser adicionadas ao Git.
- Capturas `real-ao-vivo-*` (grade fixa), `real-revisao-vazia-*`, `real-revisao-*`, `real-miniaturas-*`, `real-gravacao-*` e `real-atualizacao-*` foram feitas nas sete dimensões. O diálogo de configuração foi capturado separadamente com configuração vazia. A gravação usou vídeo real, com o destino local interceptado; o diálogo de atualização usou uma resposta fictícia. As capturas chamadas `real-vigilancia-*` e `real-tela-cheia-*` não comprovam esses estados: a automação usada não confirmou a entrada em tela cheia e elas precisam ser refeitas.
- A reprodução real, a disponibilidade na timeline, uma página de miniaturas e o início da gravação foram observados na interface. Relógio, imagens e outros dados dinâmicos não são adequados à comparação literal pixel a pixel; devem ser mascarados ou avaliados separadamente na comparação posterior.
- Após a extração do shell, o navegador integrado exibiu a grade de vigilância, ampliou uma câmera e restaurou a grade e a interface com `V`. O navegador recusou o bloqueio de `Esc`; o fluxo completo com essa tecla ainda precisa de validação em uma janela que conceda o bloqueio.

## Matriz de funcionalidades

Levantamento de `docs/UI.md` e `docs/NOTAS-DE-VERSAO.md`; todos os itens devem ser comparados antes e depois da extração.

| Área | Estados e operações a preservar |
| --- | --- |
| Servidores e configuração | Criar, editar, excluir, trocar, restaurar, conexão, sessão, falhas e retomada após diálogo. |
| Câmeras e mosaico | Listar, filtrar, abrir, fechar, foco, perfis, status, ordem, grades automáticas e fixas, limites, salvar e restaurar. |
| Ao vivo e áudio | Reprodução dos codecs suportados, reconexão, fonte em foco, ativação e pausa do áudio. |
| Presença | Desativada, foco e todas as câmeras; sinais, ausência, intervalo, suspensão, falha e retomada. |
| Revisão | Datas, horários, fuso, limites, inversão, reprodução, saltos sincronizados e mudança de dia. |
| Timeline | Faixas, zoom, arraste, clique, reordenação, rolagem, ocultação e restauração. |
| Miniaturas | Abertura, tamanho, intervalo, páginas, cancelamento, cache e prévia intermediária. |
| Captura | PNG, MP4, indisponibilidade, início, pausa, retomada, finalização, áudio e escopo multicâmera. |
| Vigilância e tela cheia | Entrada, ampliação, restauração, saída em dois níveis, menu de contexto e atalhos. |
| Interface | Barra flutuante, teclado, foco, menus, diálogos, rótulos, janelas estreitas e tela cheia. |
| Atualização e distribuição | Consulta, ignorar, progresso, SHA-256, falha, instalação e desinstalação isoladas. |
| Segurança e transporte | Loopback, origem, sessão e renovação, canais temporários, caminhos de mídia e diagnóstico sem dados privados. |

## Comparação posterior

Repetir os fluxos e as dimensões, comparando regiões estáveis e registrando diferenças. A validação real complementa, mas não substitui, os testes sintéticos automatizados de falhas e estados raros.
