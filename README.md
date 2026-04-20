# Volta ao Lago - Rastreamento GPS 🚣‍♂️

Sistema de rastreamento em tempo real para regatas de longa distância, otimizado para navegadores mobile.

## Estrutura do Projeto

- `/server`: Backend Node.js com Socket.io e PostgreSQL.
- `/client`: Frontend React com Leaflet e rádio GPS otimizado.

## Configuração Rápida (Deploy no Render)

1. **Banco de Dados:**
   - Crie um PostgreSQL no Render.
   - Guarde a `Internal Database URL`.

2. **Backend (Web Service):**
   - Pasta: `server`
   - Build: `npm install`
   - Start: `node index.js`
   - Env Var: `DATABASE_URL`

3. **Frontend (Static Site):**
   - Pasta: `client`
   - Build: `npm install && npm run build`
   - Publish: `dist`
   - **IMPORTANTE:** No arquivo `client/src/App.jsx`, atualize a constante `API_URL` com a URL do seu backend.

## Dicas para os Atletas (Amanhã)

- **Acesso:** Use sempre **HTTPS** (o GPS não funciona em HTTP).
- **iOS/Safari:** Não bloqueie a tela manualmente. Deixe a página aberta, diminua o brilho ao mínimo e coloque o celular no estanque.
- **Bateria:** Comece com 100%. O app envia a posição a cada 1 minuto para poupar energia.
- **Handover:** Se trocar de remador, basta o novo remador abrir a mesma página e selecionar o mesmo barco para continuar a transmissão.

Boa sorte na regata! 🌊
