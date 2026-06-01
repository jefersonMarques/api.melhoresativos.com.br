# Deployment check — Market Data API

Este pacote contém tolerância a falha individual por ticker e fallback de cotação atual pelo Fundamentus.

## Antes de iniciar

```bash
npm ci
npm run db:migrate
npm test
```

Depois reinicie o serviço.

## Verificação obrigatória do código publicado

```bash
grep -n "Promise.allSettled" src/modules/quotes/quotes.service.js
grep -n "fetchQuote" src/modules/providers/fundamentus.provider.js
curl -s http://localhost:3333/health
```

O health check deve retornar JSON com `service: "market-data-api"` e `status: "ok"`.
