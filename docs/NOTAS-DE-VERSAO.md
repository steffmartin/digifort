# Notas de versão do Digifort Monitor

## 1.0.0

### Destaques

- Instalador offline para Windows 11 x64, por usuário, com Node.js incluído. O Google Chrome ou Chromium é um pré-requisito. O assistente acompanha o tema do sistema.
- Inicializador gráfico com janela única em modo aplicativo, persistência de posição, tamanho e maximização, aviso de porta ocupada e encerramento do servidor local ao fechar.
- Assistente para importar um `.config`, preencher a configuração inicial ou seguir sem servidor. O diálogo de primeiro acesso permite abrir a pasta, verificar novamente ou fechar o aplicativo.
- Configurações e perfil do navegador ficam na pasta de dados do usuário. A desinstalação preserva as configurações por padrão e mantém as capturas e gravações.
- A versão reúne monitoramento ao vivo, revisão por timeline e miniaturas, mosaicos, áudio, capturas PNG e gravação local.

### Validação e distribuição

O pacote foi compilado e testado no Windows 11 local com dados sintéticos. A validação em máquina limpa e com câmeras reais segue pendente. Consulte [Continuidade](CONTINUIDADE.md#validação-e-limites) para os fluxos exercitados e [Distribuição](DISTRIBUICAO.md) para gerar o instalador sem assinatura e o `SHA256SUMS.txt`.
