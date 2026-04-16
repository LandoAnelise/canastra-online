# 🃏 Canastra Online

Jogo de Canastra online para 2 duplas (4 jogadores), em tempo real via WebSocket.

---

## Regras implementadas

- **2 baralhos** (104 cartas), sem joker
- **13 cartas** por jogador
- **Coringas:** todos os 2s (valem 10 pts)
- **Pontuação das cartas:** Ás=15 | 7 a K=10 | 3 a 6=5 | 2=10
- **Canastras:** Limpa=200 pts | Suja=100 pts
- **Primeira baixa:** qualquer combinação válida (mín. 3 cartas do mesmo rank)
- **Pegar o lixo:** sempre permitido, exceto com 1 carta na mão e 1 no lixo
- **Bater:** precisa de ≥1 canastra + bônus de 50 pts
- **Quem não bateu:** perde o valor das cartas na mão (negativo)
- **Vitória:** primeira dupla a atingir **2000 pontos**
- **Ordem:** alternada entre duplas (J1→J2→J3→J4...)

---

## Instalação e uso

### 1. Instalar dependências

```bash
cd canastra
npm install
```

### 2. Iniciar o servidor

```bash
npm start
```

O servidor sobe em `http://localhost:3000`

## Persistência opcional com Redis

Se o Redis estiver disponível, o servidor salva automaticamente salas/lobbies e partidas em andamento,
permitindo retomada após reinício/atualização do container principal.

Se o Redis não estiver configurado ou estiver indisponível, o comportamento continua em memória (como antes).

### Variáveis de ambiente

- `REDIS_URL` (prioridade maior, ex.: `redis://redis:6379/0`)
- ou `REDIS_HOST` + opcionais `REDIS_PORT`, `REDIS_DB`, `REDIS_PASSWORD`
- `REDIS_STATE_KEY` (opcional, padrão: `canastra-online:state:v1`)
- `REDIS_STATE_KEY_INCLUDE_MODE` (opcional, padrão: `true`) adiciona sufixo automático `:dev` ou `:prod`
- `REDIS_SAVE_INTERVAL_MS` (opcional, padrão: `2000`)
- `REDIS_CONNECT_TIMEOUT_MS` (opcional, padrão: `3000`)

Por padrão, os estados ficam isolados por modo:

- DEV_MODE=true salva em `canastra-online:state:v1:dev`
- DEV_MODE=false (ou ausente) salva em `canastra-online:state:v1:prod`

Se você quiser usar uma chave única sem sufixo de modo, defina `REDIS_STATE_KEY_INCLUDE_MODE=false`.

### Exemplo docker-compose

```yaml
services:
  redis:
    image: redis:8-alpine
    container_name: canastra-redis
    restart: unless-stopped
    networks:
      - canastra-net

  canastra-online:
    image: landoanelise/canastra-online:latest
    pull_policy: always
    container_name: canastra-online
    restart: unless-stopped
    tty: true
    stdin_open: true
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - REDIS_DB=0
      - REDIS_SAVE_INTERVAL_MS=2000
    networks:
      - canastra-net

networks:
  canastra-net:
    driver: bridge
```

## Estrutura do projeto

```
canastra/
├── server.js              # Servidor Node.js + Socket.io
├── package.json
├── src/
│   └── GameEngine.js      # Lógica completa do jogo
└── public/
    ├── index.html         # Interface do jogo
    ├── css/
    │   └── style.css      # Estilos
    └── js/
        └── game.js        # Lógica do cliente
pm2 start server.js --name canastra
pm2 save
pm2 startup
```
