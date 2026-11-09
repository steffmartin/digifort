# Digifort HTTP API 1.9.0

Esta pasta contém a especificação OpenAPI transcrita do manual Digifort HTTP API 1.9.0, para Digifort 7.3.0, e o PDF de origem.

- [Especificação OpenAPI](digifort-http-api-1.9.0.openapi.json)
- [Relatório de cobertura e limites](digifort-http-api-1.9.0.openapi.md)
- [Manual Digifort](API%20Reference.pdf)

## Usar no JetBrains IDE

IntelliJ IDEA reconhece especificações OpenAPI em JSON e YAML. Abra `digifort-http-api-1.9.0.openapi.json` no projeto para ver endpoints, completar a edição e acessar o preview. Para gerar uma chamada, use o ícone **Open in HTTP Client** ao lado de uma operação; ou abra **View | Tool Windows | Endpoints**, clique com o botão direito em uma operação e escolha **Generate Request in HTTP Client**. O IDE cria o request em `generated-requests.http`.

O documento usa OpenAPI 3.0.3. No topo da especificação, ajuste `servers[].variables.host` e `servers[].variables.port` para definir o endereço padrão do seu Digifort. Os valores fornecidos são `localhost:8601` para HTTP e `localhost:8401` para HTTPS. Alterar os valores padrão do servidor na especificação é a forma direta de atualizar as URLs geradas a partir dela.

## Reutilizar servidor e autenticação nos requests

Para alternar entre servidores sem editar cada chamada, use os arquivos de ambiente do HTTP Client. Crie `http-client.env.json` na raiz do projeto e defina um ambiente com as variáveis de host e porta:

```json
{
  "digifort-local": {
    "host": "127.0.0.1",
    "port": "8601"
  }
}
```

Nos requests `.http` gerados, use a mesma base com `{{host}}` e `{{port}}`, por exemplo:

```http
GET http://{{host}}:{{port}}/Interface/GetAPIVersion?ResponseFormat=JSON
```

Guarde autenticação em `http-client.private.env.json`, também na raiz, e preencha os valores somente na sua cópia local. Os nomes abaixo correspondem aos esquemas da especificação:

```json
{
  "digifort-local": {
    "username": "",
    "password": "",
    "AuthSession": "",
    "AuthData": ""
  }
}
```

Para HTTP Basic, use as variáveis no cabeçalho do request:

```http
GET http://{{host}}:{{port}}/Interface/GetAPIVersion?ResponseFormat=JSON
Authorization: Basic {{username}} {{password}}
```

Para a autenticação Basic por parâmetros, referencie `AuthUser` e `AuthPass` na query string:

```http
GET http://{{host}}:{{port}}/Interface/GetAPIVersion?AuthUser={{username}}&AuthPass={{password}}&ResponseFormat=JSON
```

Para Safe authentication, `AuthSession` e `AuthData` são obtidos pelo fluxo documentado no manual e expiram com a sessão. Referencie-os nos requests que usam esse método. Se estiver usando outro fluxo de autenticação, mantenha apenas as variáveis necessárias no arquivo privado.

Selecione `digifort-local` na lista **Run with** do HTTP Client. O arquivo privado prevalece sobre o arquivo público quando os dois definem a mesma variável; assim, host/porta podem ficar no ambiente público e usuário/senha/sessão no privado. Cada `.http` deve referenciar as variáveis que usa.

Não coloque credenciais no JSON OpenAPI, no ambiente público ou em requests versionados. O manual de origem explica o formato e os limites dos argumentos e respostas que não puderam ser descritos integralmente no schema.

## Referências JetBrains

- [OpenAPI no IntelliJ IDEA](https://www.jetbrains.com/help/idea/openapi.html): suporte a arquivos OpenAPI e geração de requests no HTTP Client.
- [Variáveis e arquivos de ambiente do HTTP Client](https://www.jetbrains.com/help/idea/http-client-variables.html): `http-client.env.json`, `http-client.private.env.json` e precedência entre eles.
- [Sintaxe de requests HTTP](https://www.jetbrains.com/help/idea/exploring-http-syntax.html): uso de variáveis e autenticação Basic no cabeçalho.
