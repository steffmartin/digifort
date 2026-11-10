# Orientações para agentes

## Regras obrigatórias

- Não instale Skills ou MCPs. O Skillshare App gerencia esses recursos. Solicite a instalação ao usuário quando precisar de um recurso ausente.
- Não leia credenciais do usuário. Use [config/example.config](config/example.config) e dados sintéticos em reproduções. Evite abrir configurações reais, arquivos privados de ambiente e logs que possam conter autenticação.
- Não faça commit sem autorização explícita.

## Ambiente e validação

- O servidor requer Node.js 20 ou superior. Use `npm start` para abrir a versão web. Para verificar o ciclo de vida da versão Windows, execute `Iniciar-Digifort.bat --diagnostico` em uma cópia com configurações sintéticas ou use uma instalação isolada.
- Para mudanças no servidor ou no cliente, execute `node --check server.mjs` e `node --check public/app.js`. Valide na interface o fluxo afetado. Use `git diff --check` para verificar whitespace.
- Para mudanças no instalador ou inicializador, consulte [Distribuição](docs/DISTRIBUICAO.md). Teste com pasta de dados isolada e confira os artefatos, o SHA-256 e o fluxo afetado. Use a pasta de trabalho de validação para configurações, perfis e mídia sintéticos.
- Mantenha o Node restrito ao loopback e preserve o contrato de leitura com o Digifort. Dados de autenticação ficam no servidor local. Ao diagnosticar transporte, registre a operação e a categoria do erro sem incluir credenciais, cabeçalhos, URLs de autenticação ou payloads de mídia.
- O WASM versionado faz parte do runtime do player. Recompile quando alterar o wrapper G.726 ou suas dependências, seguindo as [instruções do módulo](wasm/g726/README.md).

## Índice de leitura

| Quando precisar | Documento |
| --- | --- |
| Entender o produto, iniciar o projeto ou localizar o código | [README](README.md) |
| Alterar aparência, controles, diálogos ou estados da interface | [Guia de UI](docs/UI.md) |
| Entender configuração, monitoramento, revisão ou captura | [Uso](docs/USO.md) |
| Retomar manutenção, entender a arquitetura ou conferir lacunas de validação | [Continuidade](docs/CONTINUIDADE.md) |
| Empacotar, instalar, atualizar ou desinstalar | [Distribuição](docs/DISTRIBUICAO.md) |
| Consultar o conteúdo de uma versão | [Notas de versão](docs/NOTAS-DE-VERSAO.md) |
| Conferir parâmetros, exemplos e operações do Digifort | [Referência HTTP API](docs/api/README.md) |
| Consultar decisões da implementação inicial | [Plano inicial arquivado](docs/historico/PLANO-INICIAL.md) |
| Consultar o estado de bugs e propostas | [Issues do GitHub](https://github.com/steffmartin/digifort/issues) |
