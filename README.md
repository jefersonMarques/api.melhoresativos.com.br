# Market Data API

API Node.js compatível com a rota principal da Brapi para ações e FIIs brasileiros. A API utiliza:

- **Yahoo Finance** para cotação e histórico OHLCV.
- **Fundamentus** para enriquecer `priceEarnings` e `earningsPerShare`, com cache diário.
- **PostgreSQL** para cache, ativos monitorados e snapshots de cotação.
- **Atualização automática** dos ativos monitorados a cada 15 minutos.

> Esta implementação atende uso próprio e homologação. Para redistribuir cotações em um produto comercial para terceiros, substitua os providers por uma fonte licenciada.

## Requisitos

- Node.js 20 ou superior.
- PostgreSQL acessível pela variável `DATABASE_URL`.

## Configuração pronta

O arquivo `.env` já está configurado com a conexão informada:

```env
DATABASE_URL=postgresql://investment:InvestmentLocal_2026_Strong@localhost:5432/investment_agent
DATABASE_SSL=false
AUTO_MIGRATE=true
```

O arquivo `.env` está ignorado pelo Git e não deve ser versionado.

## Instalação e execução

```bash
npm install
npm run db:migrate
npm start
```

Com `AUTO_MIGRATE=true`, o `npm start` também aplica migrations pendentes antes de iniciar o servidor. O comando manual permanece disponível para execução controlada em produção.

API disponível em:

```text
http://localhost:3333
```

## Tabelas criadas

A migration `migrations/0001_create_market_data_tables.sql` cria somente tabelas com prefixo próprio:

| Tabela | Finalidade |
|---|---|
| `market_data_schema_migrations` | Controle de migrations executadas |
| `market_data_monitored_assets` | Ativos atualizados automaticamente |
| `market_data_quote_cache` | Cache das respostas compatíveis com Brapi |
| `market_data_fundamentals` | Indicadores obtidos do Fundamentus |
| `market_data_quote_snapshots` | Série de preços coletados a cada atualização |

As tabelas não alteram a estrutura já existente da carteira do sistema principal.

## Substituição da Brapi no sistema existente

Antes:

```env
BRAPI_BASE_URL=https://brapi.dev
```

Depois:

```env
BRAPI_BASE_URL=http://localhost:3333
```

A rota principal permanece:

```http
GET /api/quote/PETR4,VALE3?range=1mo&interval=1d
```

## Endpoints

### Cotação compatível com Brapi

```http
GET /api/quote/:tickers
```

Parâmetros suportados:

| Parâmetro | Exemplo | Observação |
|---|---|---|
| `range` | `1mo` | `1d`, `5d`, `1mo`, `3mo`, `6mo`, `1y`, `2y`, `5y`, `10y`, `ytd`, `max` |
| `interval` | `1d` | `1m`, `2m`, `5m`, `15m`, `30m`, `60m`, `90m`, `1h`, `1d`, `5d`, `1wk`, `1mo`, `3mo` |
| `startDate` | `2025-01-01` | Deve ser enviado com `endDate` |
| `endDate` | `2026-05-27` | Data final inclusiva |
| `dividends` | `true` | Inclui eventos disponíveis pelo Yahoo |
| `modules` | `summaryProfile` | Aceito por compatibilidade e ignorado nesta versão |

Exemplo:

```bash
curl "http://localhost:3333/api/quote/PETR4,VALE3?range=1mo&interval=1d"
```

### Monitoramento automático

```bash
curl http://localhost:3333/api/monitored

# Adiciona um ou mais ativos sem remover os existentes
curl -X POST http://localhost:3333/api/monitored \
  -H "Content-Type: application/json" \
  -d '{"symbols":["PETR4","VALE3","KNCR11"]}'

# Também aceita cadastro unitário
curl -X POST http://localhost:3333/api/monitored \
  -H "Content-Type: application/json" \
  -d '{"symbol":"ITUB4"}'

# Sincroniza toda a lista: remove os ausentes e mantém somente os enviados
curl -X PUT http://localhost:3333/api/monitored \
  -H "Content-Type: application/json" \
  -d '{"symbols":["PETR4","VALE3"]}'

# Remove um ativo
curl -X DELETE http://localhost:3333/api/monitored/VALE3
```

Os ativos monitorados são cadastrados exclusivamente via endpoint e persistidos na tabela `market_data_monitored_assets`. Reiniciar a API não insere ou remove tickers automaticamente. Para remover todos os ativos, envie `PUT /api/monitored` com `{"symbols":[]}`.

### Snapshots coletados

```bash
curl "http://localhost:3333/api/snapshots/PETR4?limit=100"

# Snapshots de múltiplos ativos informados
curl "http://localhost:3333/api/snapshots?symbols=PETR4,VALE3,ITUB4&limit=100"

# Snapshots de todos os ativos monitorados no banco
curl "http://localhost:3333/api/snapshots?limit=100"
```

### Saúde

```bash
curl http://localhost:3333/health
```

O health check também valida a conexão com o PostgreSQL.

## Regras operacionais

- Cache de cotação: 15 minutos por combinação de ticker e período.
- Cache Fundamentus: 24 horas por ticker.
- Atualização automática: apenas ativos monitorados, a cada 15 minutos.
- Retenção padrão: últimos 10.000 snapshots por ativo.
- Falha de fonte externa com cache existente: retorna o cache antigo com header `X-Market-Data-Stale: true`.
- Rate limit básico em memória por IP; para múltiplas instâncias, utilizar Redis ou gateway externo.

## Estrutura

```text
migrations/
└── 0001_create_market_data_tables.sql
scripts/
└── migrate.js
src/
├── app.js
├── server.js
├── config/
│   └── env.js
├── database/
│   ├── client.js
│   └── migrate.js
├── core/
│   ├── errors.js
│   └── http.js
├── modules/
│   ├── monitoring/
│   │   └── monitor.scheduler.js
│   ├── providers/
│   │   ├── fundamentus.provider.js
│   │   └── yahoo-finance.provider.js
│   ├── quotes/
│   │   ├── brapi-response.adapter.js
│   │   ├── quote-query.js
│   │   └── quotes.service.js
│   └── storage/
│       └── postgres-market.repository.js
└── utils/
    └── values.js
```

## Testes

```bash
npm test
npm run check
```

Os testes unitários utilizam providers simulados e não consomem Yahoo ou Fundamentus.

## REST Client para VS Code

O projeto inclui a coleção pronta em:

```text
requests/market-data-api.http
```

Instale a extensão **REST Client** (`humao.rest-client`) no VS Code, abra esse arquivo e use **Send Request** acima de cada chamada. O arquivo inclui consultas de cotação, cadastro/sincronização/remoção de ativos monitorados, atualização manual e leitura de snapshots.

## Falha parcial por ativo

Consultas com múltiplos tickers não falham integralmente quando apenas uma fonte externa não retorna um dos ativos. A resposta mantém `results` para os tickers obtidos e adiciona `errors` para os tickers sem cotação, permitindo que rotinas autônomas continuem monitorando os demais ativos.

Exemplo:

```json
{
  "results": [{ "symbol": "PETR4", "regularMarketPrice": 40.1 }],
  "errors": [{ "symbol": "INVALID11", "message": "Cotação não encontrada" }]
}
```

### Fallback de preço corrente

Quando o Yahoo Finance não retorna uma cotação corrente e `FUNDAMENTUS_ENABLED=true`, a API tenta obter a cotação atual na página de detalhes do Fundamentus. Esse fallback não cria histórico de preços; consultas históricas continuam dependendo de fonte histórica válida.

## Documentos oficiais de FIIs e fundamentos complementares

A versão 1.4 adiciona a camada documental necessária para o `investment-agent` analisar documentos relevantes sem delegar leitura ao usuário:

- **CVM Dados Abertos**: Informes Mensais, Trimestrais e Anuais Estruturados de FIIs, persistidos como `cvm_open_data`.
- **FundosNet/B3**: PDFs oficiais de Relatórios Gerenciais, Fatos Relevantes, Comunicados ao Mercado, Rendimentos/Amortizações, emissões e assembleias, persistidos como `fundosnet_b3`.
- **Fundamentus**: permanece apenas como fonte complementar de indicadores e descoberta auxiliar de CNPJ; nunca é registrado como documento oficial.

A consulta pública do FundosNet/B3 utiliza captcha para pesquisa. Para não contornar esse controle, a API utiliza um índice público configurável apenas para descobrir IDs de documentos; o arquivo e a evidência armazenada são sempre baixados da URL oficial do FundosNet/B3. O campo `metadata.discoveryProvider` permite auditar essa descoberta.

A API não interpreta documentos e não produz recomendação financeira. Ela persiste metadados, origem oficial e texto bruto extraído para o agente interpretar posteriormente.

### Tabelas documentais

A migration `migrations/0002_create_market_data_documents.sql` adiciona:

| Tabela | Finalidade |
|---|---|
| `market_data_asset_registry` | Identidade do ticker e CNPJ localizado/validado para consulta documental |
| `market_data_documents` | Metadados de informes e PDFs oficiais identificados |
| `market_data_document_contents` | Texto extraído dos ZIP/CSV da CVM e dos PDFs do FundosNet/B3 |
| `market_data_document_sync_state` | Estado e erros por ticker e por fonte |

### Configuração documental

```env
# Informes estruturados oficiais CVM
CVM_FII_ENABLED=true
CVM_OPEN_DATA_BASE_URL=https://dados.cvm.gov.br

# PDFs oficiais FundosNet/B3
FNET_FII_ENABLED=true
FNET_BASE_URL=https://fnet.bmfbovespa.com.br/fnet/publico
FNET_DISCOVERY_ENABLED=true
FNET_DISCOVERY_BASE_URL=https://brfiis.com.br
FNET_MAX_DOCUMENTS_PER_SYMBOL=40

# Leitura textual de PDF
PDF_TEXT_EXTRACTION_ENABLED=true
PDF_TEXT_EXTRACTOR_BINARY=pdftotext

# Scheduler independente de documentos
DOCUMENT_SYNC_ENABLED=false
DOCUMENT_SYNC_INTERVAL_HOURS=6
DOCUMENT_LOOKBACK_YEARS=2
DOCUMENT_MAX_SYMBOLS_PER_RUN=20
DOCUMENT_MAX_RESULTS=100
```

Para extrair o texto dos PDFs do FundosNet/B3, o servidor precisa ter `pdftotext` disponível. Em Debian/Ubuntu:

```bash
sudo apt-get update && sudo apt-get install -y poppler-utils
```

Se o binário não estiver disponível, o documento oficial ainda é persistido com URL e hash, mas o conteúdo ficará com `extractionStatus: "unsupported"` até nova sincronização em ambiente preparado.

Por padrão, a sincronização automática fica desativada durante homologação. Para habilitar o scheduler independente de documentos, use `DOCUMENT_SYNC_ENABLED=true`.

### Endpoints de documentos

#### Sincronizar documentos oficiais de FIIs específicos

```http
POST /api/documents/sync
Content-Type: application/json

{
  "symbols": ["CACR11", "IRDM11"]
}
```

Sem `symbols`, a rota processa somente ativos monitorados terminados em `11`, limitada por `DOCUMENT_MAX_SYMBOLS_PER_RUN`.

#### Listar documentos de um ticker

```http
GET /api/documents/CACR11?limit=20
GET /api/documents/CACR11?limit=20&source=fundosnet_b3
GET /api/documents/CACR11?type=fii_management_report&source=fundosnet_b3
```

Filtros disponíveis: `type`, `source`, `limit` e `since=YYYY-MM-DD`.

#### Abrir conteúdo extraído

```http
GET /api/documents/CACR11/1
```

O conteúdo pode conter linhas estruturadas oficiais da CVM ou texto bruto extraído do PDF oficial B3. Resumo e interpretação pertencem ao `investment-agent`.

#### Consultar documentos recentes de vários ativos

```http
GET /api/documents?symbols=CACR11,IRDM11&limit=20
```

Esta rota é o contrato recomendado para o agente detectar novos relatórios, fatos relevantes e comunicados desde a última análise.

#### Consultar fundamentos complementares

```http
GET /api/fundamentals/CACR11
```

A resposta marca explicitamente `source: "fundamentus"`; esses dados não são tratados como documento oficial.

### Tipos oficiais cobertos

| Tipo normalizado | Fonte principal | Documento |
|---|---|---|
| `fii_monthly_report` | CVM Dados Abertos | Informe Mensal Estruturado |
| `fii_quarterly_report` | CVM Dados Abertos | Informe Trimestral Estruturado |
| `fii_annual_report` | CVM Dados Abertos | Informe Anual Estruturado |
| `fii_management_report` | FundosNet/B3 | Relatório Gerencial PDF |
| `material_fact` | FundosNet/B3 | Fato Relevante PDF |
| `market_announcement` | FundosNet/B3 | Comunicado ao Mercado PDF |
| `income_announcement` | FundosNet/B3 | Rendimentos e Amortizações |
| `subscription_issuance` | FundosNet/B3 | Emissão/Subscrição |
| `shareholder_meeting` | FundosNet/B3 | Assembleia |
| `other_official_document` | FundosNet/B3 | Documento oficial não classificado |

### Limitações operacionais

- A pesquisa oficial do FundosNet/B3 apresenta captcha. Por isso a descoberta automática de IDs depende de um índice público configurável, enquanto a evidência armazenada permanece o PDF original B3.
- PDFs digitalizados sem camada textual não são processados por OCR; ficam disponíveis como documento oficial, mas com extração não suportada.
- A integração com o `investment-agent` ainda deve ser feita para que documentos novos elevem a confiança, gerem resumo e disparem recomendações/alertas.

## Indicadores fundamentalistas ampliados

O endpoint `GET /api/fundamentals/:symbol` agora combina indicadores complementares do Fundamentus com métricas extraídas dos documentos oficiais já sincronizados. A resposta informa `sources`, `officialEvidence` e `officialReferenceDate`, permitindo rastrear de onde vieram os indicadores.

Indicadores complementares capturados quando disponíveis incluem P/L, P/VP, P/EBIT, PSR, EV/EBITDA, EV/EBIT, LPA, VPA, Dividend Yield em 12 meses, margens, ROE, ROIC, liquidez, dívida/patrimônio, dívida líquida/EBITDA, giro de ativos e crescimento de receita.

Para FIIs, documentos oficiais CVM/FundosNet podem fornecer ou permitir extração conservadora de patrimônio líquido, valor patrimonial por cota, cotistas, vacância, LTV, inadimplência, exposição a indexadores e cobertura do rendimento. Métricas extraídas de PDF só são registradas quando o texto contém rótulos explícitos; ausência de campo continua representada como lacuna, sem inferência artificial.
