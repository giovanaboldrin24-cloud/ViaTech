# Rotina

App web (PWA) de rotina e combate à procrastinação para quem concilia **SDR** e **criação de conteúdo para Instagram**. Funciona no celular (instalável no iPhone) e no computador, sincroniza com o **Google Agenda** nos dois sentidos e manda **notificações push**.

> Este repositório antes continha a loja ViaTech. Ela continua no histórico do git (commit `bce9a4d`).

## O que o app faz

| Aba | Para que serve |
|---|---|
| **Hoje** | Linha do tempo do dia com suas rotinas, tarefas, posts e compromissos do Google Agenda. Cartão "Agora/Próximo" com botões **Feito** e **Pular**, barra de progresso, tarefas atrasadas (com "trazer para hoje"), tarefa rápida (`14:30 ligar para lead`), filtros por área e hábitos do dia. |
| **Rotinas** | Blocos que se repetem (ex.: prospecção seg–sex 9h). Cada rotina vira um **evento recorrente no Google Agenda**, com a cor da área. Inclui sugestões prontas para SDR e para conteúdo. |
| **Conteúdo** | Funil do Instagram: Ideia → Roteiro → Gravação → Edição → Agendado → Postado. Com data de publicação, o post vai para o Agenda e você recebe alerta na hora de postar. |
| **Hábitos** | Check-in diário com sequência 🔥 (conta só os dias programados). |
| **Revisão** | Fechamento do dia em 2 minutos (o que deu certo, o que travou, energia, top 3 de amanhã, que vira tarefa) e **relatório semanal**: % de blocos feitos, horas por trabalho (SDR × Instagram × Pessoal), hábitos e posts publicados. |
| **Ajustes** | Ativar notificações por aparelho, conectar o Google, horários do plano da manhã e da revisão, lembrete padrão. |

**Alertas (push):** X minutos antes de cada bloco, na hora de começar (com botões Feito/Pular no Android e no computador), plano do dia de manhã, lembrete de revisão à noite, e também para os compromissos do Google Agenda (dá para desligar).

## Rodar no computador

Precisa de Node.js 20 ou mais novo.

```bash
npm install
ROTINA_PASSWORD=uma-senha npm start
# abra http://localhost:8787
```

Sem Google configurado, o login é por senha (`ROTINA_PASSWORD`). As notificações push precisam de HTTPS (ou `localhost`).

## Publicar no Render (recomendado)

1. No [Render](https://render.com), crie um **Blueprint** apontando para este repositório. O `render.yaml` já configura o serviço, o disco persistente (`/var/data`) e o health check.
2. Use o plano **Starter** (pago). No plano gratuito o servidor "dorme" e os alertas atrasam ou não chegam.
3. Preencha as variáveis de ambiente:

| Variável | Valor |
|---|---|
| `APP_URL` | A URL do app, ex.: `https://rotina-xxxx.onrender.com` |
| `ALLOWED_EMAIL` | O seu e-mail do Google. Só ele consegue entrar. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Veja a seção abaixo. |
| `ROTINA_PASSWORD` | Opcional: login por senha como alternativa ao Google. |

Os dados ficam em `/var/data/rotina.json`, e as chaves de notificação (VAPID) são geradas e salvas ali na primeira execução.

## Configurar o Google (login + Agenda)

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/) e crie um projeto (ex.: "Rotina").
2. Em **APIs e serviços → Biblioteca**, ative a **Google Calendar API**.
3. Em **APIs e serviços → Tela de consentimento OAuth** (ou "Google Auth Platform"):
   - Tipo de usuário: **Externo**.
   - Adicione o escopo `.../auth/calendar.events`.
   - Em **Usuários de teste**, adicione o seu e-mail.
   - Para o acesso não expirar a cada 7 dias, depois de testar clique em **Publicar app** (para uso pessoal não é preciso passar pela verificação do Google; ele só mostra um aviso de "app não verificado" no login, e basta clicar em "Avançado → continuar").
4. Em **Credenciais → Criar credenciais → ID do cliente OAuth**:
   - Tipo: **Aplicativo da Web**.
   - URI de redirecionamento autorizado: `https://SEU-APP.onrender.com/auth/google/callback` (e `http://localhost:8787/auth/google/callback` para testar localmente).
5. Copie o Client ID e o Client Secret para as variáveis do Render.

Ao entrar com o Google, o app já sincroniza tudo com a sua agenda principal. Os eventos criados pelo app são marcados internamente e não aparecem duplicados no "Hoje".

## Instalar no iPhone e ativar os alertas

1. Abra a URL do app no **Safari**.
2. Toque em **Compartilhar → Adicionar à Tela de Início**.
3. Abra o **Rotina pelo ícone** (não pelo Safari), vá em **Ajustes → Ativar notificações** e permita.
4. Toque em **Enviar teste** para confirmar.

Requer iOS 16.4 ou mais novo. No computador, basta abrir no Chrome/Edge/Safari e ativar em Ajustes. Faça isso em cada aparelho.

## Como a sincronização funciona

- **App → Agenda:** rotinas viram eventos recorrentes; tarefas com data viram eventos (com horário ou de dia inteiro); posts com data viram "📱 Postar …". Editar ou excluir no app atualiza a Agenda.
- **Agenda → App:** seus compromissos (reuniões de SDR, consultas etc.) aparecem na aba Hoje em cinza, com link do Meet, e geram alertas. Eventos recusados são ignorados.
- O app é a "fonte da verdade" dos itens que ele cria: se você mover um desses eventos direto no Google Agenda, a próxima edição no app sobrescreve.

## Estrutura

```
server.mjs              servidor HTTP, API, OAuth Google, Agenda, agendador de alertas
public/index.html       casca do app
public/app.js           interface (JavaScript puro, sem build)
public/app.css          estilos (claro/escuro)
public/sw.js            service worker: push e cache offline
public/manifest.webmanifest
scripts/gerar-icones.mjs gera os ícones PNG (npm run icons)
render.yaml             deploy no Render
```
