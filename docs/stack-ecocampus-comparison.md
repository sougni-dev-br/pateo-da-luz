# Comparativo de Stack - CMV Loja x EcoCampus

## Stack encontrada no CMV Loja

- Frontend web: React, TypeScript, Vite, React Hooks, componentes locais e Context API para sessao.
- Backend: Node.js, Express.js, TypeScript, Prisma.
- Banco: PostgreSQL via Docker Compose.
- Autenticacao: JWT para sessao, Bcrypt para novas senhas, compatibilidade com hashes legados em scrypt, controle de perfis e AuditLog.
- Arquivos/planilhas: ExcelJS e Multer para importacoes.
- Relatorios: geracao simples de PDF no backend.
- Ferramentas de apoio: scripts npm, Prisma migrations, documentacao em Markdown.

## Tecnologias EcoCampus ja existentes

- Node.js
- Express.js
- PostgreSQL
- React Hooks
- JWT
- Bcrypt
- Git/GitHub preparado por estrutura de projeto, embora o comando `git` nao esteja disponivel neste notebook
- Word/Excel como apoio documental, via docs e importacao de planilhas
- Visual Studio Code compativel pela estrutura padrao de projeto
- Postman preparado com collection em `docs/postman/cmv-loja.postman_collection.json`

## Existentes parcialmente ou equivalentes

- Context API: agora ha `SessionContext`; a aplicacao ainda passa algumas props historicas, mas a base global de sessao/permissao esta pronta.
- Render: backend e frontend sao compativeis com deploy, mas ainda exigem configurar variaveis, build/start commands e banco PostgreSQL externo.
- DBeaver/pgAdmin: compatibilidade natural por usar PostgreSQL; nao ha dependencia de codigo.

## Nao incorporadas nesta etapa

- React Native
- Expo
- Expo Image Picker
- Async Storage

Motivo: o sistema atual e uma aplicacao web administrativa para notebook/desktop. Criar mobile agora adicionaria uma segunda aplicacao e duplicaria fluxo de login, formularios, upload e armazenamento sem necessidade imediata. Para futura versao mobile de contagem de estoque, a recomendacao e criar um app separado em Expo consumindo a mesma API.

## Melhorias incorporadas

- Sessao JWT com `jsonwebtoken`.
- Hash de senhas novas com Bcrypt via `bcryptjs`.
- Compatibilidade com senhas antigas em scrypt para nao forcar reset imediato.
- `JWT_SECRET` documentado em `.env.example`.
- Context API de sessao no frontend.
- Collection Postman para testes dos endpoints principais.

## Proximos passos recomendados

- Migrar hashes legados para Bcrypt no primeiro login bem-sucedido, se quiser padronizacao total.
- Criar ambiente Render separado para backend e frontend com `JWT_SECRET` forte.
- Criar app Expo somente quando houver fluxo mobile real, principalmente contagem de estoque com camera/imagem.
- Adicionar testes automatizados de API para rotas criticas.
